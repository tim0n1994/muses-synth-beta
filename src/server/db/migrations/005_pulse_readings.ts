import type { MigrationDefinition } from "../migrations.js";

/**
 * Migration 005 — pulse_readings (Vibe Signal 1.0 / v0.7 batch 1).
 *
 * Derived time series for the pulse (rhythm / intensity / emotion
 * snapshots); the raw events stay in context_event_store (V7: journeys
 * store derived results only). Purely additive: one new table plus its
 * per-user time index, no existing table is touched, so rollback is
 * "drop table pulse_readings" (or the standard backup restore) and
 * MUSES_V07=off never reads or writes it.
 *
 * NOTE (stage-3 integrator): src/server/db/migrations.ts is a shared file
 * this batch must not edit — registering this migration is a two-line
 * wiring there (import + array entry after migration004UserAttribution).
 * SqlitePulseReadingsStore also guards with CREATE TABLE IF NOT EXISTS for
 * test harnesses that assemble a database without runMigrations, matching
 * the SqliteContextEventStore convention.
 */
export const PULSE_READINGS_SQL = `
CREATE TABLE IF NOT EXISTS pulse_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  as_of TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  rhythm_value TEXT NOT NULL,
  rhythm_score REAL NOT NULL,
  intensity_value TEXT NOT NULL,
  intensity_score REAL NOT NULL,
  emotion_valence REAL NOT NULL,
  emotion_tone TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_pulse_readings_user_as_of
  ON pulse_readings (user_id, as_of DESC);
`;

export const migration005PulseReadings: MigrationDefinition = {
  version: 5,
  name: "pulse_readings",
  sql: PULSE_READINGS_SQL,
};
