import { createHash } from "node:crypto";

import type { SqliteDatabase } from "./types.js";
import { migration001Initial } from "./migrations/001_initial.js";
import { migration002IntegrityTriggers } from "./migrations/002_integrity_triggers.js";
import { migration003Auth } from "./migrations/003_auth.js";
import { migration004UserAttribution } from "./migrations/004_user_attribution.js";
import { migration005PulseReadings } from "./migrations/005_pulse_readings.js";
import { migration006LibraryTracks } from "./migrations/006_library_tracks.js";
import { migration007JourneyReplay } from "./migrations/007_journey_replay.js";

const DATABASE_KIND = "muses-v0.1";

export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  /**
   * Optional TypeScript step run inside the same immediate transaction as
   * `sql`, before it. Reserved for migrations that cannot be expressed as a
   * static SQL string — SQLite has no `ADD COLUMN IF NOT EXISTS`, and a
   * guarded ALTER needs a PRAGMA round-trip (see migration 004). The
   * migration checksum still covers only `sql`, so a `prepare` hook must be
   * deterministic in effect: re-running it on a migrated database must be a
   * no-op.
   */
  readonly prepare?: (database: SqliteDatabase) => void;
}

export interface MigrationResult {
  readonly appliedVersions: readonly number[];
  readonly currentVersion: number;
}

export type MigrationPurpose = "application-startup" | "test";

export interface RunMigrationsOptions {
  readonly purpose: MigrationPurpose;
}

export class MigrationSafetyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MigrationSafetyError";
  }
}

export const migrations: readonly MigrationDefinition[] = [
  migration001Initial,
  migration002IntegrityTriggers,
  migration003Auth,
  migration004UserAttribution,
  // v0.7 (all additive, all reversible - see each migration header for the
  // drop-statement rollback; MUSES_V07 off never reads or writes these
  // tables, matching V10/V11):
  migration005PulseReadings,
  migration006LibraryTracks,
  migration007JourneyReplay,
];

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
}

interface CountRow {
  count: number;
}

interface MetadataRow {
  value: string;
}

function checksumSql(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function listUserTables(database: SqliteDatabase): readonly string[] {
  const rows = database
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as readonly { name: string }[];
  return rows.map((row) => row.name);
}

function tableExists(database: SqliteDatabase, tableName: string): boolean {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_schema
       WHERE type = 'table' AND name = ?`,
    )
    .get(tableName) as CountRow;
  return row.count === 1;
}

function assertKnownDatabaseOrEmpty(database: SqliteDatabase): void {
  const tables = listUserTables(database);
  if (tables.length === 0) {
    return;
  }

  if (tables.length === 1 && tables[0] === "schema_migrations") {
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM schema_migrations`)
      .get() as CountRow;
    if (row.count === 0) {
      return;
    }
  }

  if (
    !tables.includes("muses_metadata") ||
    !tables.includes("schema_migrations")
  ) {
    throw new MigrationSafetyError(
      "Refusing to migrate a non-empty SQLite database without Muses identity metadata",
    );
  }

  const row = database
    .prepare(`SELECT value FROM muses_metadata WHERE key = 'database_kind'`)
    .get() as MetadataRow | undefined;
  if (row?.value !== DATABASE_KIND) {
    throw new MigrationSafetyError(
      "Refusing to migrate a SQLite database with an unknown identity",
    );
  }
}

function ensureMigrationLedger(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function validateDefinitions(
  definitions: readonly MigrationDefinition[],
): void {
  let previousVersion = 0;
  const names = new Set<string>();
  for (const migration of definitions) {
    if (
      !Number.isInteger(migration.version) ||
      migration.version !== previousVersion + 1
    ) {
      throw new MigrationSafetyError(
        "Migration versions must be contiguous positive integers",
      );
    }
    if (migration.name.trim().length === 0 || names.has(migration.name)) {
      throw new MigrationSafetyError(
        "Migration names must be non-empty and unique",
      );
    }
    if (migration.sql.trim().length === 0 && migration.prepare === undefined) {
      throw new MigrationSafetyError(
        `Migration ${migration.version} has empty SQL`,
      );
    }
    previousVersion = migration.version;
    names.add(migration.name);
  }
}

export function runMigrations(
  database: SqliteDatabase,
  options: RunMigrationsOptions,
): MigrationResult {
  if (options.purpose !== "application-startup" && options.purpose !== "test") {
    throw new MigrationSafetyError("Migration purpose must be explicit");
  }

  validateDefinitions(migrations);
  assertKnownDatabaseOrEmpty(database);
  ensureMigrationLedger(database);

  const appliedRows = database
    .prepare(
      `SELECT version, name, checksum FROM schema_migrations ORDER BY version`,
    )
    .all() as readonly AppliedMigrationRow[];
  const knownByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );

  for (const [index, applied] of appliedRows.entries()) {
    const expectedVersion = index + 1;
    if (applied.version !== expectedVersion) {
      throw new MigrationSafetyError(
        `Applied migrations are not a contiguous prefix; expected ${expectedVersion}, received ${applied.version}`,
      );
    }
    const definition = knownByVersion.get(applied.version);
    if (definition === undefined) {
      throw new MigrationSafetyError(
        `Database migration ${applied.version} is newer than this application`,
      );
    }
    if (
      definition.name !== applied.name ||
      checksumSql(definition.sql) !== applied.checksum
    ) {
      throw new MigrationSafetyError(
        `Applied migration ${applied.version} does not match the bundled migration`,
      );
    }
  }

  const appliedVersions: number[] = [];
  const appliedSet = new Set(appliedRows.map((row) => row.version));
  const applyOne = database.transaction(
    (migration: MigrationDefinition): void => {
      migration.prepare?.(database);
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at)
         VALUES (?, ?, ?, ?)`,
        )
        .run(
          migration.version,
          migration.name,
          checksumSql(migration.sql),
          new Date().toISOString(),
        );
    },
  );

  for (const migration of migrations) {
    if (appliedSet.has(migration.version)) {
      continue;
    }
    applyOne.immediate(migration);
    appliedVersions.push(migration.version);
  }

  const currentVersion = migrations.at(-1)?.version ?? 0;
  if (tableExists(database, "muses_metadata")) {
    const identity = database
      .prepare(`SELECT value FROM muses_metadata WHERE key = 'database_kind'`)
      .get() as MetadataRow | undefined;
    if (identity?.value !== DATABASE_KIND) {
      throw new MigrationSafetyError(
        "Database identity is missing after migration",
      );
    }
  }

  return { appliedVersions, currentVersion };
}
