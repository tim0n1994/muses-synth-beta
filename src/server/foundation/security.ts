import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { RuntimeConfig } from "./config.js";
import { MusesHttpError } from "./errors.js";

const MUTATION_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const JSON_BODY_METHODS = new Set(["PATCH", "POST", "PUT"]);

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
): Promise<void> {
  const allowedOrigins = new Set(config.allowedOrigins);

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
