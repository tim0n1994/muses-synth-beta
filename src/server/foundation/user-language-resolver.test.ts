import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, runMigrations } from "../db/index.js";
import type { SqliteDatabase } from "../db/types.js";
import { createUserLanguageResolver } from "./runtime-modules.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const makeDatabase = (): SqliteDatabase => {
  const directory = mkdtempSync(join(tmpdir(), "muses-language-test-"));
  directories.push(directory);
  const opened = openDatabase(join(directory, "muses.sqlite"));
  runMigrations(opened.connection, { purpose: "test" });
  return opened.connection;
};

const insertUser = (
  database: SqliteDatabase,
  id: string,
  settingsJson: string,
): void => {
  database
    .prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at, settings_json)
       VALUES (?, ?, '', 'x', '2026-10-19T00:00:00.000Z', ?)`,
    )
    .run(id, `${id}@example.com`, settingsJson);
};

describe("createUserLanguageResolver", () => {
  it("returns only languages the user explicitly configured", () => {
    const database = makeDatabase();
    insertUser(database, "u-zh", `{"appearance":{"language":"zh"}}`);
    insertUser(database, "u-ja", `{"appearance":{"language":"ja"}}`);
    insertUser(database, "u-empty", `{}`);
    insertUser(
      database,
      "u-other-keys",
      `{"theme":"dark","appearance":{"theme":"light"}}`,
    );
    insertUser(database, "u-invalid", `{"appearance":{"language":"klingon"}}`);

    const resolve = createUserLanguageResolver(
      database as unknown as Parameters<typeof createUserLanguageResolver>[0],
    );

    expect(resolve("u-zh")).toBe("zh");
    expect(resolve("u-ja")).toBe("ja");
    // No explicit language -> undefined -> the caller falls back to the
    // published global settings document, never to the schema default.
    expect(resolve("u-empty")).toBeUndefined();
    expect(resolve("u-other-keys")).toBeUndefined();
    expect(resolve("u-invalid")).toBeUndefined();
    expect(resolve("missing-user")).toBeUndefined();
  });

  it("tolerates malformed profile JSON and missing users table", () => {
    const database = makeDatabase();
    insertUser(database, "u-broken", `{"appearance":`);
    const resolve = createUserLanguageResolver(
      database as unknown as Parameters<typeof createUserLanguageResolver>[0],
    );
    expect(resolve("u-broken")).toBeUndefined();

    // A database without the users table (auth never enabled) pins the
    // resolver to "no preference" instead of throwing on every call.
    const directory = mkdtempSync(join(tmpdir(), "muses-language-test-"));
    directories.push(directory);
    const bare = openDatabase(join(directory, "muses.sqlite")).connection;
    const bareResolve = createUserLanguageResolver(
      bare as unknown as Parameters<typeof createUserLanguageResolver>[0],
    );
    expect(bareResolve("anyone")).toBeUndefined();
    expect(bareResolve("anyone")).toBeUndefined();
  });
});
