import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";

import type { SqliteDatabase } from "../db/types.js";
import { AuthService, type TokenAuthentication } from "./auth-service.js";
import { adminRoutes } from "./admin-routes.js";
import type { AuthConfig } from "./config.js";
import { createEmailSender } from "./email-service.js";
import { authenticationFailure } from "./http.js";
import { RateLimiter } from "./ratelimit.js";
import { authRoutes } from "./routes.js";
import type { PublicUser } from "./types.js";

/**
 * The auth FoundationModule: bearer gate + /api/auth/* + /api/admin/*.
 *
 * Gate semantics (registered when — and only when — auth is enabled, after
 * the foundation origin hook because module plugins register later):
 *   - Every /api/* request must carry a valid Bearer token, except the four
 *     anonymous contract endpoints (send-code / register / login /
 *     reset-password) and /api/health (ops probes cannot carry tokens).
 *   - Non-API paths (the static dashboard) stay public — otherwise the
 *     browser could never load the login screen. A valid token on a
 *     non-API request is still RESOLVED onto request.user (never required,
 *     never rejected) so the SPA-shell layer can make per-user decisions
 *     such as the v0.7 feature hint.
 *   - CORS preflights (OPTIONS) are exempt: browsers never attach
 *     Authorization to preflight requests.
 *   - A valid token on ANY /api request populates request.user for
 *     downstream handlers; an invalid token on an anonymous path is ignored
 *     (a stale token must not break re-login).
 *   - Concealed paths (the v0.7 surface, see AuthGateConcealment): a caller
 *     the concealment policy rejects — anonymous, bad token, or an account
 *     outside MUSES_V07_USERS — receives the routing 404 envelope, never
 *     401/403, so the surface is indistinguishable from "not deployed".
 * Rejections use the Muses error envelope: {error:{code,message,requestId}}
 * with AUTH_REQUIRED / AUTH_INVALID / ACCOUNT_DELETED / ACCOUNT_INACTIVE.
 */

/**
 * Routes that must look nonexistent to callers the policy rejects. Wired
 * by runtime-modules.ts from the v0.7 per-user allowlist; absent means no
 * path is concealed and the gate behaves exactly as v0.6.
 */
export interface AuthGateConcealment {
  readonly isConcealedPath: (decodedApiPath: string) => boolean;
  readonly allowsCaller: (user: PublicUser) => boolean;
}

export interface AuthGateOptions {
  readonly concealment?: AuthGateConcealment;
}

export interface AuthModuleOptions {
  readonly config: AuthConfig;
  readonly database: SqliteDatabase;
  readonly limiter?: RateLimiter;
  readonly concealment?: AuthGateConcealment;
}

const ANONYMOUS_API_PATHS: ReadonlySet<string> = new Set([
  "/api/auth/send-code",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/reset-password",
  "/api/health",
]);

function apiPathOf(url: string): string {
  const raw = url.split("?", 1)[0] ?? url;
  try {
    // find-my-way decodes path segments before matching routes, so the gate
    // must judge the decoded form too — otherwise "/%61pi/settings" reaches
    // an API handler while the raw prefix check sees no "/api/" (gate bypass).
    return decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding never routes to a real handler; fail closed
    // by classifying it as an API path so both hooks still apply.
    return "/api/undecodable";
  }
}

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

function rejectAuthentication(
  reply: FastifyReply,
  request: FastifyRequest,
  code: string,
  message: string,
): FastifyReply {
  return reply.status(401).send({
    error: { code, message, requestId: request.id },
  });
}

/**
 * Byte-for-byte the foundation routing-404 envelope (errors.ts /
 * static-files.ts NOT_FOUND): a concealed route must not be
 * distinguishable from a route that was never registered.
 */
function concealAsNotFound(
  reply: FastifyReply,
  request: FastifyRequest,
): FastifyReply {
  return reply.status(404).send({
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
      requestId: request.id,
    },
  });
}

function extractToken(header: string): string {
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
}

function bearerHeaderOf(request: FastifyRequest): string | undefined {
  // Fastify types header lookups loosely; normalize through unknown.
  const rawAuthorization: unknown = request.headers.authorization;
  return typeof rawAuthorization === "string" && rawAuthorization !== ""
    ? rawAuthorization
    : undefined;
}

export function createAuthGate(
  service: AuthService,
  options: AuthGateOptions = {},
): onRequestHookHandler {
  const concealment = options.concealment;
  return (request, reply, done) => {
    try {
      if (request.method === "OPTIONS") {
        done();
        return;
      }
      const path = apiPathOf(request.url);
      const header = bearerHeaderOf(request);

      if (!isApiPath(path)) {
        // Public surface: resolve an offered identity, never demand one.
        if (header !== undefined) {
          const offered: TokenAuthentication = service.authenticateToken(
            extractToken(header),
          );
          if (offered.status === "active" && offered.user !== undefined) {
            request.user = offered.user;
          }
        }
        done();
        return;
      }

      const concealed =
        concealment !== undefined && concealment.isConcealedPath(path);

      if (header === undefined) {
        if (concealed) {
          concealAsNotFound(reply, request);
          done();
          return;
        }
        if (ANONYMOUS_API_PATHS.has(path)) {
          done();
          return;
        }
        rejectAuthentication(
          reply,
          request,
          "AUTH_REQUIRED",
          "未提供认证信息。",
        );
        done();
        return;
      }

      const authentication: TokenAuthentication = service.authenticateToken(
        extractToken(header),
      );
      if (
        authentication.status === "active" &&
        authentication.user !== undefined
      ) {
        if (
          concealed &&
          concealment !== undefined &&
          !concealment.allowsCaller(authentication.user)
        ) {
          concealAsNotFound(reply, request);
          done();
          return;
        }
        request.user = authentication.user;
        done();
        return;
      }
      if (concealed) {
        // A bad token on a concealed path learns nothing: same 404.
        concealAsNotFound(reply, request);
        done();
        return;
      }
      if (ANONYMOUS_API_PATHS.has(path)) {
        done();
        return;
      }
      const failure = authenticationFailure(authentication.status);
      rejectAuthentication(
        reply,
        request,
        failure?.code ?? "AUTH_INVALID",
        failure?.message ?? "认证信息无效或已过期。",
      );
      done();
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

export function createAuthModule(
  options: AuthModuleOptions,
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (fastify) => {
    const emailer = createEmailSender(options.config, fastify.log);
    const service = new AuthService({
      database: options.database,
      config: options.config,
      emailer,
    });
    const limiter = options.limiter ?? new RateLimiter();

    fastify.addHook(
      "onRequest",
      createAuthGate(
        service,
        options.concealment === undefined
          ? {}
          : { concealment: options.concealment },
      ),
    );
    await fastify.register(authRoutes, {
      service,
      config: options.config,
      limiter,
    });
    await fastify.register(adminRoutes, { service });
  };

  // The gate must cover sibling modules (settings, context, static files,
  // ...), so this plugin opts out of Fastify encapsulation exactly the way
  // fastify-plugin does — via the skip-override symbol. Setting the symbol
  // directly honors the zero-new-dependency constraint; hooks then attach at
  // app scope and run after the foundation origin hook (registered first).
  (plugin as unknown as Record<symbol, boolean>)[Symbol.for("skip-override")] =
    true;
  return plugin;
}
