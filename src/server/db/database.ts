import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import type { SqliteDatabase } from "./types.js";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const MIN_BUSY_TIMEOUT_MS = 100;
const MAX_BUSY_TIMEOUT_MS = 60_000;

export interface OpenDatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  createParentDirectory?: boolean;
  busyTimeoutMs?: number;
}

export interface OpenDatabaseResult {
  readonly connection: SqliteDatabase;
  readonly filename: string;
  isClosed(): boolean;
  close(): void;
}

export class DatabaseOpenError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "DatabaseOpenError";
  }
}

function normalizeBusyTimeout(value: number | undefined): number {
  const resolved = value ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (
    !Number.isInteger(resolved) ||
    resolved < MIN_BUSY_TIMEOUT_MS ||
    resolved > MAX_BUSY_TIMEOUT_MS
  ) {
    throw new RangeError(
      `busyTimeoutMs must be an integer between ${MIN_BUSY_TIMEOUT_MS} and ${MAX_BUSY_TIMEOUT_MS}`,
    );
  }
  return resolved;
}

function normalizeFilename(filename: string): string {
  const trimmed = filename.trim();
  if (trimmed.length === 0) {
    throw new TypeError("Database filename must not be empty");
  }
  if (trimmed === ":memory:") {
    return trimmed;
  }
  return resolve(trimmed);
}

export function openDatabase(
  filename: string,
  options: OpenDatabaseOptions = {},
): OpenDatabaseResult {
  const normalizedFilename = normalizeFilename(filename);
  const readonly = options.readonly ?? false;
  const fileMustExist = options.fileMustExist ?? readonly;
  const busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs);

  if (
    normalizedFilename !== ":memory:" &&
    !readonly &&
    !fileMustExist &&
    (options.createParentDirectory ?? true)
  ) {
    mkdirSync(dirname(normalizedFilename), { recursive: true, mode: 0o700 });
  }

  let connection: SqliteDatabase | undefined;
  try {
    connection = new BetterSqlite3(normalizedFilename, {
      readonly,
      fileMustExist,
      timeout: busyTimeoutMs,
    });

    connection.pragma(`busy_timeout = ${busyTimeoutMs}`);
    connection.pragma("foreign_keys = ON");
    connection.pragma("trusted_schema = OFF");
    connection.pragma("recursive_triggers = ON");

    if (!readonly && normalizedFilename !== ":memory:") {
      const journalMode = connection.pragma("journal_mode = WAL", {
        simple: true,
      });
      if (
        typeof journalMode !== "string" ||
        journalMode.toLowerCase() !== "wal"
      ) {
        throw new DatabaseOpenError(
          `SQLite refused WAL mode; received ${String(journalMode)}`,
        );
      }
      connection.pragma("synchronous = NORMAL");
      connection.pragma("wal_autocheckpoint = 1000");
    }

    const foreignKeys = connection.pragma("foreign_keys", { simple: true });
    if (foreignKeys !== 1) {
      throw new DatabaseOpenError("SQLite foreign_keys could not be enabled");
    }
  } catch (error: unknown) {
    if (connection?.open === true) {
      connection.close();
    }
    if (error instanceof DatabaseOpenError) {
      throw error;
    }
    throw new DatabaseOpenError(
      `Unable to open SQLite database at ${normalizedFilename}`,
      error,
    );
  }

  let closed = false;
  return {
    connection,
    filename: normalizedFilename,
    isClosed: () => closed,
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      if (connection.open) {
        connection.close();
      }
    },
  };
}
