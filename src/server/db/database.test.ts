import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { openDatabase } from "./database.js";
import {
  MigrationSafetyError,
  migrations,
  runMigrations,
} from "./migrations.js";

function withTempDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "muses-db-test-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("database opener and migrations", () => {
  it("opens in WAL mode, enables foreign keys, migrates idempotently, and closes explicitly", () => {
    withTempDirectory((directory) => {
      const opened = openDatabase(join(directory, "muses.sqlite"));
      expect(opened.connection.pragma("journal_mode", { simple: true })).toBe(
        "wal",
      );
      expect(opened.connection.pragma("foreign_keys", { simple: true })).toBe(
        1,
      );

      const first = runMigrations(opened.connection, { purpose: "test" });
      expect(first.appliedVersions).toEqual(
        migrations.map((migration) => migration.version),
      );
      expect(first.currentVersion).toBe(migrations.at(-1)?.version);

      const second = runMigrations(opened.connection, { purpose: "test" });
      expect(second.appliedVersions).toEqual([]);

      const tables = opened.connection
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all() as readonly { name: string }[];
      expect(tables.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          "audit_events",
          "belief_snapshots",
          "context_events",
          "decisions",
          "effects",
          "settings_drafts",
          "settings_history",
          "settings_releases",
        ]),
      );

      opened.close();
      expect(opened.isClosed()).toBe(true);
      opened.close();
      expect(opened.isClosed()).toBe(true);
    });
  });

  it("refuses to migrate an unrelated non-empty SQLite database", () => {
    withTempDirectory((directory) => {
      const filename = join(directory, "foreign.sqlite");
      const foreign = new BetterSqlite3(filename);
      foreign.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY) STRICT;");
      foreign.close();

      const opened = openDatabase(filename, { fileMustExist: true });
      try {
        expect(() =>
          runMigrations(opened.connection, { purpose: "test" }),
        ).toThrow(MigrationSafetyError);
      } finally {
        opened.close();
      }
    });
  });
});
