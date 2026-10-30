import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, runMigrations, migrations } from "./index.js";
import type { SqliteDatabase } from "./types.js";
import { SqliteContextEventStore } from "../context/sqlite-context-event-store.js";
import { SqliteDecisionRepository } from "../policy/sqlite-decision-repository.js";
import { SqliteEffectRepository } from "../effects/sqlite-effect-repository.js";
import {
  migration004UserAttribution,
  prepareUserAttribution,
} from "./migrations/004_user_attribution.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const makeDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "muses-migration-test-"));
  directories.push(directory);
  return join(directory, "muses.sqlite");
};

interface TableInfoRow {
  readonly name: string;
}

const columnsOf = (
  database: SqliteDatabase,
  table: string,
): readonly string[] =>
  (
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as readonly TableInfoRow[]
  ).map((row) => row.name);

const hasColumn = (
  database: SqliteDatabase,
  table: string,
  column: string,
): boolean => columnsOf(database, table).includes(column);

const indexExists = (database: SqliteDatabase, name: string): boolean => {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'index' AND name = ?`,
    )
    .get(name) as { count: number };
  return row.count === 1;
};

const checksumOf = (sql: string): string =>
  createHash("sha256").update(sql, "utf8").digest("hex");

/**
 * Builds a database in the exact shape a v0.5 deployment would have left
 * behind: the migration ledger stops at 003, and the repository-owned tables
 * exist in their pre-user_id form with rows in them. The bundled 001-003
 * definitions are ledgered with their true checksums so the runner accepts
 * the prefix and applies only 004.
 */
const makeLegacyDatabase = (): SqliteDatabase => {
  const opened = openDatabase(makeDatabasePath());
  const database = opened.connection;

  database.exec(`
    CREATE TABLE muses_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    INSERT INTO muses_metadata (key, value) VALUES
      ('database_kind', 'muses-v0.1');

    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const insertLedger = database.prepare(
    `INSERT INTO schema_migrations (version, name, checksum, applied_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const definition of migrations.slice(0, 3)) {
    insertLedger.run(
      definition.version,
      definition.name,
      checksumOf(definition.sql),
      "2026-10-01T00:00:00.000Z",
    );
  }

  // Pre-v0.6 repository tables (no user_id), each with a legacy row.
  database.exec(`
    CREATE TABLE context_event_store (
      server_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      out_of_order INTEGER NOT NULL CHECK (out_of_order IN (0, 1)),
      content_hash TEXT NOT NULL,
      candidate_json TEXT NOT NULL,
      UNIQUE (source, id)
    ) STRICT;

    CREATE TABLE policy_decisions (
      decision_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      decision_json TEXT NOT NULL
    );

    CREATE TABLE effect_requests (
      effect_id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      request_json TEXT NOT NULL
    );

    CREATE TABLE effect_outcomes (
      outcome_id TEXT PRIMARY KEY,
      effect_id TEXT NOT NULL,
      status TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      outcome_json TEXT NOT NULL
    );

    CREATE TABLE decisions (id TEXT PRIMARY KEY);
    CREATE TABLE belief_snapshots (id TEXT PRIMARY KEY);
  `);
  database
    .prepare(
      `INSERT INTO context_event_store (
         id, source, type, subject, occurred_at, received_at,
         expires_at, out_of_order, content_hash, candidate_json
       ) VALUES ('legacy-evt-1', 'urn:muses:legacy', 'muses.editor.activity',
         'workspace:legacy', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
         '2099-01-01T00:00:00.000Z', 0, 'hash-legacy', '{}')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO policy_decisions (decision_id, created_at, kind, decision_json)
       VALUES ('decision-legacy', '2026-10-01T00:00:00.000Z', 'NO_ACTION', '{}')`,
    )
    .run();

  return database;
};

describe("migration 004 — user attribution", () => {
  it("applies to a legacy v0.5 database in place and preserves rows", () => {
    const database = makeLegacyDatabase();

    const result = runMigrations(database, { purpose: "test" });

    // v0.7 additive migrations (005 pulse, 006 library, 007 journey) also
    // apply to an upgraded legacy database; 004 remains the one under test.
    expect(result.appliedVersions).toEqual([4, 5, 6, 7]);
    expect(result.currentVersion).toBe(migrations.at(-1)?.version ?? 0);

    for (const table of [
      "context_event_store",
      "policy_decisions",
      "decisions",
      "effect_requests",
      "effect_outcomes",
      "belief_snapshots",
    ]) {
      expect(hasColumn(database, table, "user_id")).toBe(true);
    }
    expect(indexExists(database, "idx_context_events_user")).toBe(true);

    // Legacy rows survive with user_id NULL — the legacy global stream.
    const legacyEvent = database
      .prepare(
        `SELECT user_id FROM context_event_store WHERE id = 'legacy-evt-1'`,
      )
      .get() as { user_id: string | null };
    expect(legacyEvent.user_id).toBeNull();
    const legacyDecision = database
      .prepare(
        `SELECT user_id FROM policy_decisions WHERE decision_id = 'decision-legacy'`,
      )
      .get() as { user_id: string | null };
    expect(legacyDecision.user_id).toBeNull();
  });

  it("is idempotent: running the migrations and the prepare hook again is a no-op", () => {
    const database = makeLegacyDatabase();
    runMigrations(database, { purpose: "test" });

    const second = runMigrations(database, { purpose: "test" });
    expect(second.appliedVersions).toEqual([]);
    expect(second.currentVersion).toBe(7);

    // The PRAGMA-guarded hook itself also tolerates a direct re-run.
    expect(() => prepareUserAttribution(database)).not.toThrow();
    expect(() => prepareUserAttribution(database)).not.toThrow();
    const columns = columnsOf(database, "context_event_store").filter(
      (name) => name === "user_id",
    );
    expect(columns).toEqual(["user_id"]);
  });

  it("skips repository-owned tables on a fresh database; constructors create them attributed", () => {
    const opened = openDatabase(makeDatabasePath());
    const database = opened.connection;

    const result = runMigrations(database, { purpose: "test" });
    expect(result.appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // The repository-owned tables do not exist yet at migration time; 004
    // must skip them rather than fail. The legacy 001 tables do exist.
    expect(hasColumn(database, "decisions", "user_id")).toBe(true);
    expect(hasColumn(database, "belief_snapshots", "user_id")).toBe(true);

    // better-sqlite3 statements structurally satisfy the repos' own port
    // types at runtime; cast once like buildRuntimeModules does.
    void new SqliteContextEventStore(
      database as unknown as ConstructorParameters<
        typeof SqliteContextEventStore
      >[0],
    );
    void new SqliteDecisionRepository(
      database as unknown as ConstructorParameters<
        typeof SqliteDecisionRepository
      >[0],
    );
    void new SqliteEffectRepository(
      database as unknown as ConstructorParameters<
        typeof SqliteEffectRepository
      >[0],
    );

    expect(hasColumn(database, "context_event_store", "user_id")).toBe(true);
    expect(hasColumn(database, "policy_decisions", "user_id")).toBe(true);
    expect(hasColumn(database, "effect_requests", "user_id")).toBe(true);
    expect(hasColumn(database, "effect_outcomes", "user_id")).toBe(true);
    expect(indexExists(database, "idx_context_events_user")).toBe(true);
  });

  it("carries version 4 with a prepare hook and no raw SQL", () => {
    expect(migration004UserAttribution.version).toBe(4);
    expect(migration004UserAttribution.prepare).toBeTypeOf("function");
    expect(migrations.map((definition) => definition.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});
