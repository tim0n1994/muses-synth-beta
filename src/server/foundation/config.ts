import { resolve } from "node:path";
import { isAbsolute } from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import { Ajv, type ErrorObject } from "ajv";

import { readLlmEnvironment } from "../llm/capability.js";
import { v07FeatureFlagsFromEnv } from "./feature-flags.js";

// The LLM_* fields are deliberately unconstrained here (B1): a schema
// failure in loadRuntimeConfig throws ConfigurationError and kills the
// process, and an optional enhancement must never have that power. They are
// forwarded as raw strings; readLlmEnvironment decides validity and returns
// null on any violation.
const RawEnvironmentSchema = Type.Object(
  {
    LLM_API_KEY: Type.Optional(Type.String()),
    LLM_BASE_URL: Type.Optional(Type.String()),
    LLM_MODEL: Type.Optional(Type.String()),
    MUSES_ALLOWED_ORIGINS: Type.Optional(Type.String()),
    MUSES_BODY_LIMIT_BYTES: Type.Optional(Type.String()),
    MUSES_DATABASE_PATH: Type.Optional(Type.String({ maxLength: 512 })),
    MUSES_HOST: Type.Optional(Type.String()),
    MUSES_LOG_LEVEL: Type.Optional(Type.String()),
    MUSES_LOG_PATH: Type.Optional(Type.String({ maxLength: 512 })),
    MUSES_PORT: Type.Optional(Type.String()),
    MUSES_SERVE_STATIC: Type.Optional(Type.String()),
    MUSES_SHUTDOWN_TIMEOUT_MS: Type.Optional(Type.String()),
    MUSES_STATIC_ROOT: Type.Optional(Type.String()),
    MUSES_V07: Type.Optional(Type.String()),
    MUSES_V07_REPLAY: Type.Optional(Type.String()),
    // Comma-separated user ids admitted to the v0.7 surfaces (Round-2
    // per-user release gate). Parsed by feature-flags.parseV07Users at the
    // runtime-modules wiring site, where the auth decision is known.
    MUSES_V07_USERS: Type.Optional(Type.String({ maxLength: 4_096 })),
    NODE_ENV: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

type RawEnvironment = Static<typeof RawEnvironmentSchema>;

// Derived result of readLlmEnvironment: both required factors present and
// already validated. These constraints tighten the *parsed* shape only; the
// raw environment above stays permissive on purpose.
const LlmEnvironmentConfigSchema = Type.Object(
  {
    baseUrl: Type.String({ minLength: 1, maxLength: 512 }),
    apiKey: Type.String({ minLength: 1, maxLength: 512 }),
    model: Type.Union([
      Type.String({ minLength: 1, maxLength: 128 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const RuntimeConfigSchema = Type.Object(
  {
    allowedOrigins: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      uniqueItems: true,
    }),
    appVersion: Type.String({ minLength: 1 }),
    bodyLimitBytes: Type.Integer({ minimum: 1_024, maximum: 10_485_760 }),
    host: Type.String({ minLength: 1 }),
    llm: Type.Union([LlmEnvironmentConfigSchema, Type.Null()]),
    logLevel: Type.Union([
      Type.Literal("silent"),
      Type.Literal("fatal"),
      Type.Literal("error"),
      Type.Literal("warn"),
      Type.Literal("info"),
      Type.Literal("debug"),
      Type.Literal("trace"),
    ]),
    logPath: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    mode: Type.Union([
      Type.Literal("development"),
      Type.Literal("test"),
      Type.Literal("production"),
    ]),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    serveStatic: Type.Boolean(),
    shutdownTimeoutMs: Type.Integer({ minimum: 100, maximum: 60_000 }),
    staticRoot: Type.String({ minLength: 1 }),
    v07Features: Type.Object({
      selfTrack: Type.Boolean(),
      replay: Type.Boolean(),
    }),
  },
  { additionalProperties: false },
);

export type RuntimeConfig = Readonly<Static<typeof RuntimeConfigSchema>>;

const ajv = new Ajv({ allErrors: true, coerceTypes: false, strict: true });
const validateRawEnvironment = ajv.compile(RawEnvironmentSchema);
const validateRuntimeConfig = ajv.compile(RuntimeConfigSchema);

const LOOPBACK_BIND_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const LOOPBACK_ORIGIN_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "[::1]",
  "localhost",
]);
const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

function formatAjvErrors(
  errors: readonly ErrorObject[] | null | undefined,
): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath === "" ? "/" : error.instancePath;
    return `${location} ${error.message ?? "is invalid"}`;
  });
}

function readInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new ConfigurationError(`${name} must be an integer`);
  }

  return Number.parseInt(value, 10);
}

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new ConfigurationError(`${name} must be either "true" or "false"`);
}

function normalizeMode(value: string | undefined): RuntimeConfig["mode"] {
  if (value === undefined || value === "development") {
    return "development";
  }

  if (value === "test" || value === "production") {
    return value;
  }

  throw new ConfigurationError(
    "NODE_ENV must be development, test or production",
  );
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`Invalid allowed origin: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigurationError(
      `Allowed origin must use http or https: ${value}`,
    );
  }

  // Public mode: when authentication is explicitly enabled the service is
  // intentionally exposed beyond loopback (e.g. muses.udify.fun behind the
  // tunnel), so non-loopback origins are allowed to enter the allowlist.
  // Without auth the original loopback-only contract stays untouched.
  const authEnabled =
    (process.env.MUSES_AUTH_ENABLED ?? "").trim().toLowerCase() === "true";
  if (!authEnabled && !LOOPBACK_ORIGIN_HOSTS.has(url.hostname)) {
    throw new ConfigurationError(
      `Allowed origin must be loopback-only (non-loopback origins require MUSES_AUTH_ENABLED=true): ${value}`,
    );
  }

  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ConfigurationError(
      `Allowed origin must not include credentials, path, query or fragment: ${value}`,
    );
  }

  return url.origin;
}

function readLogPath(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const resolved = resolve(value.trim());
  if (!isAbsolute(resolved)) {
    throw new ConfigurationError(
      "MUSES_LOG_PATH must resolve to an absolute path",
    );
  }
  return resolved;
}

function defaultOrigins(port: number): string[] {
  return [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ];
}

function selectEnvironment(source: NodeJS.ProcessEnv): RawEnvironment {
  return {
    ...(source.LLM_API_KEY === undefined
      ? {}
      : { LLM_API_KEY: source.LLM_API_KEY }),
    ...(source.LLM_BASE_URL === undefined
      ? {}
      : { LLM_BASE_URL: source.LLM_BASE_URL }),
    ...(source.LLM_MODEL === undefined ? {} : { LLM_MODEL: source.LLM_MODEL }),
    ...(source.MUSES_ALLOWED_ORIGINS === undefined
      ? {}
      : { MUSES_ALLOWED_ORIGINS: source.MUSES_ALLOWED_ORIGINS }),
    ...(source.MUSES_BODY_LIMIT_BYTES === undefined
      ? {}
      : { MUSES_BODY_LIMIT_BYTES: source.MUSES_BODY_LIMIT_BYTES }),
    ...(source.MUSES_HOST === undefined
      ? {}
      : { MUSES_HOST: source.MUSES_HOST }),
    ...(source.MUSES_LOG_LEVEL === undefined
      ? {}
      : { MUSES_LOG_LEVEL: source.MUSES_LOG_LEVEL }),
    ...(source.MUSES_LOG_PATH === undefined
      ? {}
      : { MUSES_LOG_PATH: source.MUSES_LOG_PATH }),
    ...(source.MUSES_PORT === undefined
      ? {}
      : { MUSES_PORT: source.MUSES_PORT }),
    ...(source.MUSES_SERVE_STATIC === undefined
      ? {}
      : { MUSES_SERVE_STATIC: source.MUSES_SERVE_STATIC }),
    ...(source.MUSES_SHUTDOWN_TIMEOUT_MS === undefined
      ? {}
      : { MUSES_SHUTDOWN_TIMEOUT_MS: source.MUSES_SHUTDOWN_TIMEOUT_MS }),
    ...(source.MUSES_STATIC_ROOT === undefined
      ? {}
      : { MUSES_STATIC_ROOT: source.MUSES_STATIC_ROOT }),
    ...(source.MUSES_V07 === undefined ? {} : { MUSES_V07: source.MUSES_V07 }),
    ...(source.MUSES_V07_REPLAY === undefined
      ? {}
      : { MUSES_V07_REPLAY: source.MUSES_V07_REPLAY }),
    ...(source.MUSES_V07_USERS === undefined
      ? {}
      : { MUSES_V07_USERS: source.MUSES_V07_USERS }),
    ...(source.NODE_ENV === undefined ? {} : { NODE_ENV: source.NODE_ENV }),
  };
}

export function loadRuntimeConfig(
  source: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const raw = selectEnvironment(source);
  if (!validateRawEnvironment(raw)) {
    throw new ConfigurationError(
      "Environment configuration is invalid",
      formatAjvErrors(validateRawEnvironment.errors),
    );
  }

  const mode = normalizeMode(raw.NODE_ENV);
  const port = readInteger(raw.MUSES_PORT, 3001, "MUSES_PORT");
  const host = raw.MUSES_HOST?.trim() || "127.0.0.1";
  if (!LOOPBACK_BIND_HOSTS.has(host)) {
    throw new ConfigurationError("MUSES_HOST must resolve to a loopback host");
  }

  const origins = raw.MUSES_ALLOWED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const allowedOrigins = [
    ...new Set((origins ?? defaultOrigins(port)).map(normalizeOrigin)),
  ];

  const candidate = {
    allowedOrigins,
    appVersion: "0.3.3-beta.1",
    bodyLimitBytes: readInteger(
      raw.MUSES_BODY_LIMIT_BYTES,
      DEFAULT_BODY_LIMIT_BYTES,
      "MUSES_BODY_LIMIT_BYTES",
    ),
    host,
    // Optional enhancement: unlike host/CORS above there is no loopback
    // enforcement to do here — violations resolve to null (the layer reports
    // "unconfigured") and never to a boot failure.
    llm: readLlmEnvironment(raw),
    logLevel: (raw.MUSES_LOG_LEVEL?.trim() ||
      (mode === "test" ? "silent" : "info")) as
      "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace",
    logPath: readLogPath(raw.MUSES_LOG_PATH),
    mode,
    port,
    serveStatic: readBoolean(
      raw.MUSES_SERVE_STATIC,
      mode === "production",
      "MUSES_SERVE_STATIC",
    ),
    shutdownTimeoutMs: readInteger(
      raw.MUSES_SHUTDOWN_TIMEOUT_MS,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
      "MUSES_SHUTDOWN_TIMEOUT_MS",
    ),
    staticRoot: resolve(raw.MUSES_STATIC_ROOT?.trim() || "dist/web"),
    // v0.7 switches parsed by the shared fail-closed parser; the SPA-serving
    // layer injects them into the HTML shell ONLY while enabled, so a
    // flag-off process serves the byte-identical v0.6 shell (V11).
    v07Features: v07FeatureFlagsFromEnv(raw),
  };

  if (!validateRuntimeConfig(candidate)) {
    throw new ConfigurationError(
      "Runtime configuration is invalid",
      formatAjvErrors(validateRuntimeConfig.errors),
    );
  }

  return Object.freeze(candidate);
}
