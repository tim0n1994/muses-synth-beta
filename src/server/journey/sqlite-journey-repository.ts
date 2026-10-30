import { journeyReplaySchemaSql } from "../db/migrations/007_journey_replay.js";
import type { JourneySnapshot, JourneySummary, ReplayPlan } from "./model.js";

/**
 * SQLite-backed journey/replay repository, following the v0.6
 * SqliteEffectRepository convention: the repository owns its tables (the
 * constructor's CREATE TABLE IF NOT EXISTS is the same SQL string migration
 * 007 applies, so fresh databases and upgraded ones cannot drift), and
 * EVERY read path carries the `user_id IS ?` attribution predicate — a
 * cross-user read returns null exactly like a missing row.
 */

export type SqlitePrimitive = string | number | bigint | Uint8Array | null;

export interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface SqliteStatementPort {
  run(...parameters: readonly SqlitePrimitive[]): SqliteRunResult;
  get(...parameters: readonly SqlitePrimitive[]): unknown;
  all(...parameters: readonly SqlitePrimitive[]): readonly unknown[];
}

export interface SqliteDatabasePort {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementPort;
}

interface JourneyRow {
  readonly journey_id: string;
  readonly user_id: string | null;
  readonly session_started_at: string;
  readonly session_ended_at: string;
  readonly duration_sec: number;
  readonly event_count: number;
  readonly snapshot_json: string;
  readonly retention_days: number;
  readonly derived_at: string;
}

export interface PruneResult {
  readonly journeys: number;
  readonly replays: number;
}

export class SqliteJourneyRepository {
  public constructor(private readonly database: SqliteDatabasePort) {
    this.database.exec(journeyReplaySchemaSql);
  }

  public upsertSnapshot(
    snapshot: JourneySnapshot,
    userId: string | null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO journeys (
           journey_id, user_id, session_started_at, session_ended_at,
           duration_sec, event_count, snapshot_json, retention_days, derived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (journey_id) DO UPDATE SET
           session_started_at = excluded.session_started_at,
           session_ended_at = excluded.session_ended_at,
           duration_sec = excluded.duration_sec,
           event_count = excluded.event_count,
           snapshot_json = excluded.snapshot_json,
           derived_at = excluded.derived_at`,
      )
      .run(
        snapshot.journeyId,
        userId,
        snapshot.sessionStartedAt,
        snapshot.sessionEndedAt,
        snapshot.durationSec,
        snapshot.eventCount,
        JSON.stringify(snapshot),
        snapshot.retentionDays,
        snapshot.derivedAt,
      );
  }

  public getById(
    journeyId: string,
    userId: string | null,
  ): JourneySnapshot | null {
    const row = this.database
      .prepare(
        `SELECT snapshot_json FROM journeys
         WHERE journey_id = ? AND user_id IS ?`,
      )
      .get(journeyId, userId) as { snapshot_json: string } | undefined;
    return row === undefined
      ? null
      : (JSON.parse(row.snapshot_json) as JourneySnapshot);
  }

  public listSummaries(userId: string | null): readonly JourneySummary[] {
    const rows = this.database
      .prepare(
        `SELECT journey_id, session_started_at, session_ended_at,
                duration_sec, event_count, retention_days, derived_at,
                snapshot_json
         FROM journeys
         WHERE user_id IS ?
         ORDER BY session_started_at DESC`,
      )
      .all(userId) as readonly JourneyRow[];
    return rows.map((row) => {
      const snapshot = JSON.parse(row.snapshot_json) as JourneySnapshot;
      return {
        journeyId: row.journey_id,
        sessionStartedAt: row.session_started_at,
        sessionEndedAt: row.session_ended_at,
        durationSec: row.duration_sec,
        eventCount: row.event_count,
        nodeCount: snapshot.nodes.length,
        retentionDays: row.retention_days,
        derivedAt: row.derived_at,
      };
    });
  }

  public saveReplay(plan: ReplayPlan, userId: string | null): void {
    this.database
      .prepare(
        `INSERT INTO journey_replays (
           replay_id, journey_id, user_id, generated_at, plan_json
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (replay_id) DO UPDATE SET
           generated_at = excluded.generated_at,
           plan_json = excluded.plan_json`,
      )
      .run(
        plan.replayId,
        plan.journeyId,
        userId,
        plan.generatedAt,
        JSON.stringify(plan),
      );
  }

  /**
   * How many rendered replays exist for one journey — the service's
   * rotation counter. First render = 0 (the frozen v0 output), each
   * re-render re-rolls with avoidance of the previous pick.
   */
  public countReplays(journeyId: string, userId: string | null): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS n FROM journey_replays
         WHERE journey_id = ? AND user_id IS ?`,
      )
      .get(journeyId, userId) as { n: number };
    return row.n;
  }

  public getLatestReplay(
    journeyId: string,
    userId: string | null,
  ): ReplayPlan | null {
    const row = this.database
      .prepare(
        `SELECT plan_json FROM journey_replays
         WHERE journey_id = ? AND user_id IS ?
         ORDER BY generated_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(journeyId, userId) as { plan_json: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.plan_json) as ReplayPlan);
  }

  /**
   * Retention pass (V7, default 90 days, per-row policy): journeys whose
   * session ended before now - retention_days are deleted together with
   * their replays. Comparison happens in JS on parsed timestamps because
   * ISO-8601 strings and SQLite datetime() output do not compare
   * lexicographically.
   */
  public pruneExpired(now: Date): PruneResult {
    const rows = this.database
      .prepare(
        `SELECT journey_id, session_ended_at, retention_days FROM journeys`,
      )
      .all() as readonly {
      journey_id: string;
      session_ended_at: string;
      retention_days: number;
    }[];
    const expired = rows.filter((row) => {
      const endedMs = Date.parse(row.session_ended_at);
      if (Number.isNaN(endedMs)) {
        return true;
      }
      return endedMs < now.getTime() - row.retention_days * 86_400_000;
    });
    if (expired.length === 0) {
      return { journeys: 0, replays: 0 };
    }
    const deleteReplays = this.database.prepare(
      `DELETE FROM journey_replays WHERE journey_id = ?`,
    );
    const deleteJourney = this.database.prepare(
      `DELETE FROM journeys WHERE journey_id = ?`,
    );
    let replays = 0;
    for (const row of expired) {
      replays += deleteReplays.run(row.journey_id).changes;
      deleteJourney.run(row.journey_id);
    }
    return { journeys: expired.length, replays };
  }
}
