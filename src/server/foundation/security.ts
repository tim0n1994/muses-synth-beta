import { isIP } from "node:net";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { RuntimeConfig } from "./config.js";
import { MusesHttpError } from "./errors.js";

const MUTATION_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const JSON_BODY_METHODS = new Set(["PATCH", "POST", "PUT"]);

function hasLoopbackHost(request: FastifyRequest): boolean {
  const rawHeaders = request.raw.rawHeaders;
  let count = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "host") count += 1;
  }
  if (count !== 1 || typeof request.headers.host !== "string") return false;
  const match =
    /^(localhost|127\.0\.0\.1|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?$/i.exec(
      request.headers.host,
    );
  if (!match) return false;
  if (
    match[2] !== undefined &&
    (Number(match[2]) < 1 || Number(match[2]) > 65535)
  ) {
    return false;
  }
  const host = match[1]?.toLowerCase();
  if (host === undefined) return false;
  if (!host.startsWith("[")) return true;
  const address = host.slice(1, -1);
  if (isIP(address) !== 6) return false;
  return new URL(`http://${host}`).hostname === "[::1]";
}

function requestOrigin(request: FastifyRequest): string | undefined {
  const origin: unknown = request.headers.origin;
  if (typeof origin === "string") {
    return origin;
  }
  return Array.isArray(origin) && typeof origin[0] === "string"
    ? origin[0]
    : undefined;
}

function hasJsonContentType(request: FastifyRequest): boolean {
  const contentType: unknown = request.headers["content-type"];
  const value: unknown =
    Array.isArray(contentType) && typeof contentType[0] === "string"
      ? contentType[0]
      : contentType;
  return (
    typeof value === "string" &&
    value.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function isApiRequest(request: FastifyRequest): boolean {
  const raw = request.url.split("?", 1)[0] ?? request.url;
  let path = raw;
  try {
    // Decode before the /api/ prefix check: the router decodes segments, so
    // "/%61pi/settings" would otherwise reach an API mutation handler while
    // this hook (CSRF/origin guard) sees a non-API path and steps aside.
    path = decodeURIComponent(raw);
  } catch {
    return true; // malformed encoding: fail closed, treat as an API request
  }
  return path === "/api" || path.startsWith("/api/");
}

export async function registerSecurity(
  app: FastifyInstance,
  config: RuntimeConfig,
  enforceLoopbackHost: boolean,
): Promise<void> {
  const allowedOrigins = new Set(config.allowedOrigins);

  if (enforceLoopbackHost) {
    // Check all requests before CORS can answer preflight or static fallback.
    // A forged Host can otherwise expose unauthenticated local GET responses
    // to a browser after DNS rebinding, even if mutation Origins are checked.
    // eslint-disable-next-line @typescript-eslint/require-await -- Fastify hook registration preserves its async contract.
    app.addHook("onRequest", async (request) => {
      if (!hasLoopbackHost(request)) {
        throw new MusesHttpError({
          code: "HOST_NOT_ALLOWED",
          message: "Host is not a loopback address",
          statusCode: 403,
        });
      }
    });
  }

  await app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        defaultSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
  });

  await app.register(cors, {
    credentials: false,
    methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
    origin(origin, callback) {
      if (origin === undefined || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    strictPreflight: true,
  });

  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify hook registration preserves its async contract.
  app.addHook("onRequest", async (request) => {
    if (!isApiRequest(request) || !MUTATION_METHODS.has(request.method)) {
      return;
    }

    const origin = requestOrigin(request);
    if (origin === undefined || !allowedOrigins.has(origin)) {
      throw new MusesHttpError({
        code: "ORIGIN_NOT_ALLOWED",
        message: "Mutation origin is not allowed",
        statusCode: 403,
      });
    }

    if (JSON_BODY_METHODS.has(request.method) && !hasJsonContentType(request)) {
      throw new MusesHttpError({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json",
        statusCode: 415,
      });
    }
  });
}
