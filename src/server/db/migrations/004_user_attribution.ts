import type { SqliteDatabase } from "../types.js";

/**
 * Migration 004 — per-user attribution columns (v0.6 personal space).
 *
 * Every event-sourced table gains a nullable `user_id` column:
 *   - `context_event_store` (owned by SqliteContextEventStore) also gains the
 *     covering index `idx_context_events_user (user_id, server_sequence)` so
 *     the per-user belief cache can probe MAX(server_sequence) per user in
 *     O(log N) without touching other users' rows.
 *   - `policy_decisions` / `effect_requests` / `effect_outcomes` are the live
 *     decision/effect tables owned by their repositories.
 *   - `decisions` / `belief_snapshots` are the migration-001 projection
 *     tables; they are attributed too so a future writer cannot silently mix
 *     streams.
 *
 * Semantics: existing rows keep `user_id = NULL`, which reads as the legacy
 * global stream. Auth-disabled (local) mode writes and reads only the NULL
 * stream, which is byte-for-byte the pre-migration behavior. On an
 * auth-enabled deployment upgraded from v0.5 the NULL stream is invisible to
 * every account. The `muses backfill` tool can attribute legacy rows to a
 * designated user after the data and migration plan have been reviewed.
 *
 * Why a `prepare` hook instead of plain SQL: SQLite has no
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and the repository-owned tables
 * do not exist yet on a fresh database (they are created by the repository
 * constructors after migrations run). So each ALTER is guarded by a
 * table-exists + column-exists PRAGMA check, and skipped entirely on fresh
 * databases — the constructors' CREATE TABLE statements now include the
 * column. On a legacy database the tables do exist and get the column added
 * in place, preserving their rows.
 */
export const ATTRIBUTED_TABLES: readonly string[] = [
  "context_event_store",
  "policy_decisions",
  "decisions",
  "effect_requests",
  "effect_outcomes",
  "belief_snapshots",
];

interface TableInfoRow {
  readonly name: string;
}

interface CountRow {
  readonly count: number;
}

function tableExists(database: SqliteDatabase, table: string): boolean {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?`,
    )
    .get(table) as CountRow | undefined;
  return row?.count === 1;
}

function columnExists(
  database: SqliteDatabase,
  table: string,
  column: string,
): boolean {
  const rows = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as readonly TableInfoRow[];
  return rows.some((row) => row.name === column);
}

export function prepareUserAttribution(database: SqliteDatabase): void {
  for (const table of ATTRIBUTED_TABLES) {
    // Table names come from the frozen local list above, never from input.
    if (!tableExists(database, table)) {
      continue;
    }
    if (columnExists(database, table, "user_id")) {
      continue;
    }
    database.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT;`);
  }

  if (tableExists(database, "context_event_store")) {
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_context_events_user
         ON context_event_store (user_id, server_sequence);`,
    );
  }
}

export const migration004UserAttribution = {
  version: 4,
  name: "user_attribution_columns",
  sql: "",
  prepare: prepareUserAttribution,
} as const;
