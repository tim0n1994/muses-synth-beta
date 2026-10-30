import type { ContextClock } from "../context/model.js";
import { SYSTEM_CLOCK } from "../context/model.js";
import type {
  SqliteDatabasePort,
  SqlitePrimitive,
  SqliteStatementPort,
} from "../context/sqlite-context-event-store.js";
import { PULSE_READINGS_SQL } from "../db/migrations/005_pulse_readings.js";
import type { PulseSnapshot, PulseSnapshotStore } from "./model.js";

export interface SqlitePulseReadingsStoreOptions {
  /**
   * The user stream this shard persists readings for: null is the legacy
   * global stream (auth-disabled local mode), matching the three-state
   * attribution convention.
   */
  readonly userId: string | null;
  readonly clock?: ContextClock;
}

/**
 * Append-only writer for the pulse_readings derived table (migration 005).
 * The table is owned here: created by the migration in production and by
 * this constructor's CREATE TABLE IF NOT EXISTS for test harnesses that
 * assemble a database without runMigrations (the SqliteContextEventStore
 * convention).
 */
export class SqlitePulseReadingsStore implements PulseSnapshotStore {
  private readonly insertStatement: SqliteStatementPort;
  private readonly userId: string | null;
  private readonly clock: ContextClock;

  public constructor(
    database: SqliteDatabasePort,
    options: SqlitePulseReadingsStoreOptions,
  ) {
    database.exec(PULSE_READINGS_SQL);
    this.insertStatement = database.prepare(`
      INSERT INTO pulse_readings (
        user_id, as_of, window_started_at,
        rhythm_value, rhythm_score,
        intensity_value, intensity_score,
        emotion_valence, emotion_tone,
        input_digest, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.userId = options.userId;
    this.clock = options.clock ?? SYSTEM_CLOCK;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- PulseSnapshotStore port requires Promise; better-sqlite3 is synchronous.
  public async savePulseSnapshot(snapshot: PulseSnapshot): Promise<void> {
    const parameters: readonly SqlitePrimitive[] = [
      this.userId,
      snapshot.asOf,
      snapshot.windowStartedAt,
      snapshot.rhythm.value,
      snapshot.rhythm.score,
      snapshot.intensity.value,
      snapshot.intensity.score,
      snapshot.emotion.value === "UNKNOWN" ? 0 : snapshot.emotion.value,
      snapshot.emotion.tone,
      snapshot.inputDigest,
      JSON.stringify(snapshot),
      this.clock.now().toISOString(),
    ];
    this.insertStatement.run(...parameters);
  }
}
