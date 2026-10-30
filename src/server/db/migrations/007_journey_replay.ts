import type { MigrationDefinition } from "../migrations.js";

/**
 * Migration 007 — journey/replay derived tables (v0.7 batch 2, D-owned).
 *
 * Two tables, both user-attributed with the v0.6 semantics: user_id NULL is
 * the legacy global stream (auth-disabled local mode), a user id is that
 * account's stream, and every repository read carries `WHERE user_id IS ?`
 * so cross-user reads are indistinguishable from missing rows.
 *
 *   journeys        one derived timeline per session (V7): a few KB of
 *                  snapshot JSON, never a copy of raw events; retention_days
 *                  defaults to the 90-day policy (V7) and is checked on
 *                  every prune pass
 *   journey_replays rendered playlists (V8): plan JSON (playlist +
 *                  timestamps), no audio blobs — the browser plays static
 *                  library files, the server never renders or exports
 *
 * Idempotent by construction (IF NOT EXISTS): on a fresh database the
 * repository constructors create the same tables first and this migration
 * is a no-op; on an upgraded production database it creates them. The SQL
 * lives in one exported constant shared with SqliteJourneyRepository so the
 * two paths cannot drift (the migration checksum covers exactly this
 * string).
 *
 * Rollback (V11 — reversible increment; verified by the v0.6 backup ->
 * restore-drill -> dry-run runbook):
 *   DROP TABLE IF EXISTS journey_replays;
 *   DROP TABLE IF EXISTS journeys;
 */
export const journeyReplaySchemaSql = `
  CREATE TABLE IF NOT EXISTS journeys (
    journey_id TEXT PRIMARY KEY,
    user_id TEXT,
    session_started_at TEXT NOT NULL,
    session_ended_at TEXT NOT NULL,
    duration_sec INTEGER NOT NULL CHECK (duration_sec >= 0),
    event_count INTEGER NOT NULL CHECK (event_count >= 0),
    snapshot_json TEXT NOT NULL,
    retention_days INTEGER NOT NULL DEFAULT 90 CHECK (
      retention_days BETWEEN 1 AND 3650
    ),
    derived_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_journeys_user_started
    ON journeys (user_id, session_started_at DESC);
  CREATE TABLE IF NOT EXISTS journey_replays (
    replay_id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL,
    user_id TEXT,
    generated_at TEXT NOT NULL,
    plan_json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_journey_replays_journey
    ON journey_replays (journey_id, generated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_journey_replays_user
    ON journey_replays (user_id, generated_at DESC);
`;

export const migration007JourneyReplay: MigrationDefinition = {
  version: 7,
  name: "journey_replay_tables",
  sql: journeyReplaySchemaSql,
};

/** Dry-run-able rollback script for the runbook (never executed by the app). */
export const migration007RollbackSql = `
  DROP TABLE IF EXISTS journey_replays;
  DROP TABLE IF EXISTS journeys;
`;
