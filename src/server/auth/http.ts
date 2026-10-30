import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { MusesHttpError } from "../foundation/errors.js";
import {
  AuthServiceError,
  type AuthService,
  type TokenAuthenticationStatus,
} from "./auth-service.js";
import type { PublicUser } from "./types.js";

/**
 * Shared HTTP plumbing for the auth route plugins: bearer extraction,
 * contract-faithful 401/403 mapping, and an envelope-compatible error
 * handler so the plugins behave identically standalone (unit tests) and
 * inside the full app (where foundation's handler would produce the same
 * {error:{code,message,requestId}} shape anyway).
 */

export interface AuthenticationFailure {
  readonly code: string;
  readonly message: string;
}

/** Contract error mapping for token authentication states. */
export function authenticationFailure(
  status: TokenAuthenticationStatus,
): AuthenticationFailure | null {
  switch (status) {
    case "active":
      return null;
    case "deleted":
      return { code: "ACCOUNT_DELETED", message: "账号不存在或已删除。" };
    case "inactive":
      return {
        code: "ACCOUNT_INACTIVE",
        message: "账号已停用，请重新确认账号状态。",
      };
    default:
      return { code: "AUTH_INVALID", message: "认证信息无效或已过期。" };
  }
}

/** Reads the Authorization header, tolerating Fastify's loose header types. */
function authorizationHeader(request: FastifyRequest): string | undefined {
  const raw: unknown = request.headers.authorization;
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    const first = (raw as readonly unknown[])[0];
    if (typeof first === "string") {
      return first;
    }
  }
  return undefined;
}

export function bearerToken(request: FastifyRequest): string | null {
  const value = authorizationHeader(request);
  if (value === undefined || value === "") {
    return null;
  }
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : value;
}

export function requireUser(
  request: FastifyRequest,
  service: AuthService,
): PublicUser {
  const token = bearerToken(request);
  if (token === null) {
    throw new MusesHttpError({
      code: "AUTH_REQUIRED",
      message: "未提供认证信息。",
      statusCode: 401,
    });
  }
  const authentication = service.authenticateToken(token);
  if (authentication.status === "active" && authentication.user !== undefined) {
    request.user = authentication.user;
    return authentication.user;
  }
  const failure = authenticationFailure(authentication.status);
  throw new MusesHttpError({
    code: failure?.code ?? "AUTH_INVALID",
    message: failure?.message ?? "认证信息无效或已过期。",
    statusCode: 401,
  });
}

export function requireAdmin(
  request: FastifyRequest,
  service: AuthService,
): PublicUser {
  const user = requireUser(request, service);
  if (user.role !== "admin") {
    throw new MusesHttpError({
      code: "AUTH_FORBIDDEN",
      message: "权限不足，需要管理员账号",
      statusCode: 403,
    });
  }
  return user;
}

function sendAuthError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: MusesHttpError,
): FastifyReply {
  const message =
    error.expose && error.statusCode < 500
      ? error.message
      : "An unexpected error occurred";
  return reply.status(error.statusCode).send({
    error: {
      code: error.code,
      message,
      requestId: request.id,
    },
  });
}

function validationIssuesFrom(rawValidation: unknown): {
  message: string;
  path: string;
}[] {
  const issues = rawValidation as readonly unknown[];
  return issues.map((raw: unknown) => {
    const issue = raw as { instancePath?: unknown; message?: unknown };
    const instancePath =
      typeof issue.instancePath === "string" ? issue.instancePath : "";
    return {
      message:
        typeof issue.message === "string" ? issue.message : "Value is invalid",
      path: instancePath === "" ? "/" : instancePath,
    };
  });
}

export function installAuthErrorHandling(fastify: FastifyInstance): void {
  fastify.setErrorHandler((rawError, request, reply) => {
    if (rawError instanceof MusesHttpError) {
      return sendAuthError(reply, request, rawError);
    }
    if (rawError instanceof AuthServiceError) {
      // Service-layer business failures (bad code, throttled resend, wrong
      // password, ...) map straight onto the error envelope.
      return sendAuthError(
        reply,
        request,
        new MusesHttpError({
          code: rawError.errorCode,
          message: rawError.message,
          statusCode: rawError.statusCode,
        }),
      );
    }
    if (rawError instanceof Error) {
      const fastifyError = rawError as {
        message: string;
        statusCode?: unknown;
        validation?: unknown;
      };
      if (Array.isArray(fastifyError.validation)) {
        return sendAuthError(
          reply,
          request,
          new MusesHttpError({
            code: "VALIDATION_FAILED",
            issues: validationIssuesFrom(fastifyError.validation),
            message: "Request validation failed",
            statusCode: 400,
          }),
        );
      }
      const fastifyCode = (rawError as { code?: unknown }).code;
      if (
        typeof fastifyCode === "string" &&
        fastifyCode.startsWith("FST_ERR_")
      ) {
        // Body-parser/content-type failures (e.g. empty JSON body) are client
        // errors; classify them as such instead of INTERNAL_ERROR.
        return sendAuthError(
          reply,
          request,
          new MusesHttpError({
            code: "INVALID_REQUEST",
            message: "Malformed request body",
            statusCode:
              typeof fastifyError.statusCode === "number" &&
              fastifyError.statusCode >= 400 &&
              fastifyError.statusCode < 500
                ? fastifyError.statusCode
                : 400,
          }),
        );
      }
      request.log.error(
        { err: rawError, requestId: request.id },
        "auth request failed",
      );
      return sendAuthError(
        reply,
        request,
        new MusesHttpError({
          code: "INTERNAL_ERROR",
          expose: false,
          message: rawError.message,
          statusCode:
            typeof fastifyError.statusCode === "number"
              ? fastifyError.statusCode
              : 500,
        }),
      );
    }
    return sendAuthError(
      reply,
      request,
      new MusesHttpError({
        code: "INTERNAL_ERROR",
        expose: false,
        message: "Unknown error",
        statusCode: 500,
      }),
    );
  });
}
