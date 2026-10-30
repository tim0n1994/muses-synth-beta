import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

import type { AuthConfig } from "../../auth/config.js";
import { enabledAuthConfig, registerViaApi } from "../../auth/test-support.js";
import { openDatabase, type OpenDatabaseResult } from "../../db/index.js";
import { SqliteContextEventStore } from "../../context/sqlite-context-event-store.js";
import { loadRuntimeConfig } from "../../foundation/config.js";
import { createApp } from "../../foundation/create-app.js";
import { buildRuntimeModules } from "../../foundation/runtime-modules.js";
import {
  buildJourneyModule,
  JOURNEY_MODULE_NAME,
  SqliteJourneyRepository,
  type SqliteDatabasePort,
} from "../index.js";

/**
 * Batch-2 harness: the full v0.6 production graph (buildRuntimeModules is the
 * shared file stage 3 owns, so it is used read-only here) plus the journey
 * module appended exactly the way runtime-modules.ts will wire it after the
 * parallel batch lands — i.e. only when buildJourneyModule says the
 * MUSES_V07 && MUSES_V07_REPLAY gate is open. A second SQLite connection is
 * opened on the same file for the journey repository/event source, mirroring
 * how the integration pass will hand the already-opened connection over.
 */
export interface JourneyAppOptions {
  readonly auth?: AuthConfig | null;
  readonly v07?: string;
  readonly replay?: string;
}

export interface JourneyTestApp {
  readonly app: FastifyInstance;
  readonly repository: SqliteJourneyRepository;
  readonly databasePath: string;
  readonly moduleNames: readonly string[];
  readonly cleanup: () => Promise<void>;
}

export const buildJourneyApp = async (
  options: JourneyAppOptions = {},
): Promise<JourneyTestApp> => {
  const directory = mkdtempSync(join(tmpdir(), "muses-journey-test-"));
  const databasePath = join(directory, "muses.sqlite");
  const previousDatabasePath = process.env.MUSES_DATABASE_PATH;
  process.env.MUSES_DATABASE_PATH = databasePath;

  // Pin a dummy admin allowlist: v0.6 promotes the FIRST registered user
  // to admin when no allowlist is configured, which would silently make
  // the privilege matrix's attacker an admin. With a non-empty allowlist
  // neither A nor B can be admin.
  const runtime = await buildRuntimeModules({
    auth:
      options.auth === undefined
        ? enabledAuthConfig({ MUSES_ADMIN_EMAILS: "root@example.com" })
        : options.auth,
  });

  const opened: OpenDatabaseResult = openDatabase(databasePath);
  // better-sqlite3's prepare() returns per-statement inferred tuples that
  // satisfy the repo ports at runtime but not under strict tuple types —
  // cast once at the boundary, exactly like runtime-modules.ts does.
  const connection = opened.connection as unknown as SqliteDatabasePort;
  const eventStore = new SqliteContextEventStore(connection);
  // Both batch-2 switches default ON: the standard fixture exercises the
  // gated graph. Gate tests pass explicit values (including "0"/"unset").
  const module = buildJourneyModule(
    {
      MUSES_V07: options.v07 ?? "1",
      MUSES_V07_REPLAY: options.replay ?? "1",
    },
    { database: connection, eventSource: eventStore },
  );
  const modules =
    module === null ? [...runtime.modules] : [...runtime.modules, module];
  const moduleNames = modules.map((candidate) => candidate.name);

  const app = await createApp({
    config: loadRuntimeConfig({ NODE_ENV: "test" }),
    logger: false,
    modules,
  });

  const keepDatabase = process.env.MUSES_JOURNEY_PRIVILEGE_KEEP_DB === "1";
  const cleanup = async (): Promise<void> => {
    await app.close();
    await runtime.close();
    opened.close();
    if (previousDatabasePath === undefined) {
      delete process.env.MUSES_DATABASE_PATH;
    } else {
      process.env.MUSES_DATABASE_PATH = previousDatabasePath;
    }
    if (keepDatabase) {
      // Privilege matrix row #27 shells out to python3 sqlite3 in read-only
      // mode against this file after the run; printing the path is the
      // hand-off. Never enabled in normal runs.
      console.log(`[journey-privilege] database kept at ${databasePath}`);
    } else {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  return {
    app,
    repository: new SqliteJourneyRepository(connection),
    databasePath,
    moduleNames,
    cleanup,
  };
};

export const ORIGIN = "http://127.0.0.1:3001";

export const authedHeaders = (token: string): Record<string, string> => ({
  origin: ORIGIN,
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

export interface RegisteredSession {
  readonly token: string;
  readonly userId: string;
}

export const registerUser = async (
  app: FastifyInstance,
  email: string,
): Promise<RegisteredSession> => {
  const session = await registerViaApi(app, email, "secret1");
  return { token: session.token, userId: session.user.id };
};

export interface TestEventInput {
  readonly id: string;
  readonly type: string;
  readonly secondsAgo: number;
  readonly data?: Record<string, unknown>;
}

export const ingestEvents = async (
  app: FastifyInstance,
  token: string | null,
  events: readonly TestEventInput[],
): Promise<void> => {
  for (const event of events) {
    const headers =
      token === null
        ? { origin: ORIGIN, "content-type": "application/json" }
        : authedHeaders(token);
    const defaultData =
      event.data === undefined && event.type === "muses.editor.activity"
        ? { action: "edit" }
        : undefined;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/context/events",
      headers,
      payload: {
        specversion: "1.0",
        id: event.id,
        source: "urn:muses:journey-test",
        type: event.type,
        subject: "workspace:test",
        time: new Date(Date.now() - event.secondsAgo * 1_000).toISOString(),
        ...(defaultData === undefined && event.data === undefined
          ? {}
          : { data: event.data ?? defaultData }),
      },
    });
    if (response.statusCode !== 202) {
      throw new Error(
        `ingest ${event.id} failed: ${response.statusCode} ${response.body}`,
      );
    }
  }
};

export { JOURNEY_MODULE_NAME };
