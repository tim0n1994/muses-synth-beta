import { randomUUID } from "node:crypto";

import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyServerOptions,
} from "fastify";
import { destination as pinoDestination, pino } from "pino";

import type { RuntimeConfig } from "./config.js";
import { installErrorHandling, installNotFoundHandler } from "./errors.js";
import type { V07AccessPolicy } from "./feature-flags.js";
import { healthRoutes } from "./health.js";
import { registerSecurity } from "./security.js";
import { registerStaticFiles } from "./static-files.js";

export interface FoundationModule {
  readonly name: string;
  readonly plugin: FastifyPluginAsync;
}

export interface CreateAppOptions {
  readonly config: RuntimeConfig;
  readonly logger?: FastifyServerOptions["logger"];
  readonly modules?: readonly FoundationModule[];
  /**
   * Who receives the v0.7 client hint in the SPA shell (Round-2 per-user
   * allowlist). buildRuntimeModules derives it from MUSES_V07_USERS and the
   * auth decision; omitted means the single-user local policy (no auth
   * module, no accounts to list) — the pre-allowlist behavior.
   */
  readonly v07Access?: V07AccessPolicy;
}

interface DefaultLoggerResult {
  readonly logger: NonNullable<FastifyServerOptions["logger"]> | false;
  readonly loggerInstance?: ReturnType<typeof pino>;
}

function defaultLogger(config: RuntimeConfig): DefaultLoggerResult {
  if (config.logLevel === "silent") {
    return { logger: false };
  }
  const options = {
    level: config.logLevel,
    redact: {
      censor: "[REDACTED]",
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
    },
  };
  if (config.logPath === null) {
    return { logger: options };
  }
  return {
    logger: false,
    loggerInstance: pino(
      options,
      pinoDestination({ dest: config.logPath, sync: false }),
    ),
  };
}

export async function createApp(
  options: CreateAppOptions,
): Promise<FastifyInstance> {
  const { config } = options;
  const defaultLog =
    options.logger === undefined ? defaultLogger(config) : undefined;
  const app = Fastify({
    bodyLimit: config.bodyLimitBytes,
    genReqId: () => `req_${randomUUID()}`,
    ...(defaultLog?.loggerInstance !== undefined
      ? { loggerInstance: defaultLog.loggerInstance }
      : {
          logger:
            options.logger === undefined
              ? (defaultLog?.logger ?? false)
              : options.logger,
        }),
    trustProxy: false,
  }) as unknown as FastifyInstance;
  // Fastify 5's factory infers Http2SecureServer generics; cast to the standard RawServerDefault shape

  installErrorHandling(app, config.mode === "production");
  // The built module graph is the source of truth: auth may be explicitly
  // supplied or disabled independently of environment variables.
  const hasAuth = (options.modules ?? []).some(
    (module) => module.name === "auth",
  );
  await registerSecurity(app, config, !hasAuth);
  await app.register(healthRoutes, { version: config.appVersion });

  for (const module of options.modules ?? []) {
    app.log.debug({ module: module.name }, "Registering application module");
    await app.register(module.plugin);
  }

  const staticRegistered = await registerStaticFiles(
    app,
    config,
    options.v07Access,
  );
  if (!staticRegistered) {
    installNotFoundHandler(app);
  }

  await app.ready();
  return app;
}
