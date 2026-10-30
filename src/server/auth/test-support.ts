import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";

import { openDatabase, runMigrations, type Clock } from "../db/index.js";
import type { SqliteDatabase } from "../db/types.js";
import { AuthService } from "./auth-service.js";
import { AuthConfig } from "./config.js";
import type { VerificationEmailSender } from "./email-service.js";
import { createAuthModule } from "./module.js";
import type { PublicUser } from "./types.js";

/** Test double emailer: silent success, no console noise. */
export const SILENT_EMAILER: VerificationEmailSender = {
  sendVerificationEmail: () => Promise.resolve(true),
};

/** Capturing emailer for send-behavior assertions. */
export class RecordingEmailer implements VerificationEmailSender {
  public readonly sent: {
    code: string;
    email: string;
    purpose: string;
  }[] = [];

  public sendVerificationEmail(
    email: string,
    code: string,
    purpose: "register" | "reset",
  ): Promise<boolean> {
    this.sent.push({ code, email, purpose });
    return Promise.resolve(true);
  }
}

/** Deterministic clock for expiry/throttle tests. */
export class MutableClock implements Clock {
  private current: Date;

  public constructor(start: Date = new Date()) {
    this.current = start;
  }

  public now(): Date {
    return this.current;
  }

  public advanceMilliseconds(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export function enabledAuthConfig(extra: NodeJS.ProcessEnv = {}): AuthConfig {
  return AuthConfig.fromEnv({
    MUSES_AUTH_ENABLED: "true",
    MUSES_JWT_SECRET: "test-secret",
    ...extra,
  });
}

export interface ServiceFixture {
  readonly service: AuthService;
  readonly database: SqliteDatabase;
  readonly cleanup: () => void;
}

export interface ServiceFixtureOptions {
  readonly config?: AuthConfig;
  readonly clock?: Clock;
  readonly emailer?: VerificationEmailSender;
}

export function createServiceFixture(
  options: ServiceFixtureOptions = {},
): ServiceFixture {
  const directory = mkdtempSync(join(tmpdir(), "muses-auth-svc-test-"));
  const opened = openDatabase(join(directory, "muses.sqlite"));
  runMigrations(opened.connection, { purpose: "test" });
  const config = options.config ?? enabledAuthConfig();
  const service = new AuthService({
    database: opened.connection,
    config,
    emailer: options.emailer ?? SILENT_EMAILER,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  return {
    service,
    database: opened.connection,
    cleanup: () => {
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export interface AuthHarness {
  readonly app: FastifyInstance;
  readonly service: AuthService;
  readonly config: AuthConfig;
  readonly cleanup: () => Promise<void>;
}

/**
 * Full auth module assembly (gate + /api/auth/* + /api/admin/*) on a temp
 * SQLite database, mirroring the production wiring.
 */
export async function createAuthHarness(
  options: ServiceFixtureOptions = {},
): Promise<AuthHarness> {
  const directory = mkdtempSync(join(tmpdir(), "muses-auth-api-test-"));
  const opened = openDatabase(join(directory, "muses.sqlite"));
  runMigrations(opened.connection, { purpose: "test" });
  const config = options.config ?? enabledAuthConfig();
  const service = new AuthService({
    database: opened.connection,
    config,
    emailer: options.emailer ?? SILENT_EMAILER,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const app = Fastify({ logger: false });
  await app.register(createAuthModule({ config, database: opened.connection }));
  return {
    app,
    service,
    config,
    cleanup: async () => {
      await app.close();
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export interface RegisteredSession {
  readonly user: PublicUser;
  readonly token: string;
}

/**
 * Registers a user through the public API using the echoed devCode. Sends a
 * default allowed Origin because the full app's security layer rejects
 * cross-site mutations without one; standalone test apps ignore the header.
 */
export async function registerViaApi(
  app: FastifyInstance,
  email: string,
  password: string,
  displayName?: string,
): Promise<RegisteredSession> {
  const headers = { origin: "http://127.0.0.1:3001" };
  const codeResponse = await app.inject({
    method: "POST",
    url: "/api/auth/send-code",
    headers,
    payload: { email, purpose: "register" },
  });
  const devCode = codeResponse.json<{ devCode?: string }>().devCode;
  if (codeResponse.statusCode !== 200 || devCode === undefined) {
    throw new Error(`send-code failed: ${codeResponse.body}`);
  }
  const registerResponse = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers,
    payload: {
      email,
      code: devCode,
      password,
      ...(displayName === undefined ? {} : { displayName }),
    },
  });
  if (registerResponse.statusCode !== 200) {
    throw new Error(`register failed: ${registerResponse.body}`);
  }
  return registerResponse.json<RegisteredSession>();
}
