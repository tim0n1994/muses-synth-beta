import { Value } from "@sinclair/typebox/value";

import {
  EffectOutcomeSchema,
  EffectRequestSchema,
  MANUAL_OVERRIDE_REASONS,
  type EffectLedgerEntry,
  type EffectOutcome,
  type EffectRequest,
} from "./contracts.js";
import type { EffectRepository } from "./repository.js";

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

/**
 * The reserved manual reasons as a SQL literal list, for the partial index.
 * An index definition cannot be parameterised, so the values are inlined —
 * guarded here because a reason that is not a bare uppercase token would be
 * going straight into DDL.
 */
const MANUAL_REASON_SQL_LIST = MANUAL_OVERRIDE_REASONS.map((reason) => {
  if (!/^[A-Z_]+$/u.test(reason)) {
    throw new Error(`Unsafe manual override reason for SQL: ${reason}`);
  }
  return `'${reason}'`;
}).join(", ");

interface EffectJoinRow {
  readonly request_json: string;
  readonly outcome_json: string | null;
}

export class SqliteEffectRepository implements EffectRepository {
  private readonly insertEffectStatement: SqliteStatementPort;
  private readonly insertOutcomeStatement: SqliteStatementPort;
  private readonly byIdStatement: SqliteStatementPort;
  private readonly byIdUserStatement: SqliteStatementPort;
  private readonly currentStatement: SqliteStatementPort;
  private readonly currentUserStatement: SqliteStatementPort;
  private readonly lastManualOverrideStatement: SqliteStatementPort;
  private readonly lastManualOverrideUserStatement: SqliteStatementPort;

  public constructor(private readonly database: SqliteDatabasePort) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS effect_requests (
        effect_id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        action_id TEXT NOT NULL CHECK (action_id = 'audio.adjust'),
        issued_at TEXT NOT NULL,
        request_json TEXT NOT NULL,
        user_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_effect_requests_current
        ON effect_requests(issued_at DESC, effect_id DESC);
      CREATE INDEX IF NOT EXISTS idx_effect_requests_user_current
        ON effect_requests(user_id, issued_at DESC, effect_id DESC);

      CREATE TABLE IF NOT EXISTS effect_outcomes (
        outcome_id TEXT PRIMARY KEY,
        effect_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applied', 'skipped', 'failed', 'reverted')),
        observed_at TEXT NOT NULL,
        outcome_json TEXT NOT NULL,
        user_id TEXT,
        FOREIGN KEY(effect_id) REFERENCES effect_requests(effect_id)
      );
      CREATE INDEX IF NOT EXISTS idx_effect_outcomes_latest
        ON effect_outcomes(effect_id, observed_at DESC, outcome_id DESC);

      -- Manual overrides are looked up on every policy evaluation, and the
      -- common case is "the user never touched it", which without a partial
      -- index means scanning every outcome ever recorded to return null.
      -- Restricting the index to the reserved reasons keeps that lookup on an
      -- index that is usually empty.
      --
      -- If MANUAL_OVERRIDE_REASONS ever grows, an existing database keeps the
      -- older index definition (IF NOT EXISTS does not redefine it). The
      -- query stays correct — SQLite simply stops using the narrower index and
      -- falls back to a scan. Correctness never depends on this index.
      CREATE INDEX IF NOT EXISTS idx_effect_outcomes_manual
        ON effect_outcomes(observed_at DESC, outcome_id DESC)
        WHERE json_extract(outcome_json, '$.reason') IN (${MANUAL_REASON_SQL_LIST});
    `);
    // Databases created before v0.6 have both tables without user_id;
    // migration 004 adds the columns at startup; this guard covers harnesses
    // that assemble the repository without runMigrations.
    for (const table of ["effect_requests", "effect_outcomes"] as const) {
      if (!columnExists(this.database, table, "user_id")) {
        this.database.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT;`);
      }
    }

    this.insertEffectStatement = this.database.prepare(`
      INSERT INTO effect_requests (
        effect_id,
        decision_id,
        action_id,
        issued_at,
        request_json,
        user_id
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(effect_id) DO NOTHING
    `);
    this.insertOutcomeStatement = this.database.prepare(`
      INSERT INTO effect_outcomes (
        outcome_id,
        effect_id,
        status,
        observed_at,
        outcome_json,
        user_id
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(outcome_id) DO NOTHING
    `);
    this.byIdStatement = this.database.prepare(
      selectEntrySql("WHERE request.effect_id = ?"),
    );
    this.byIdUserStatement = this.database.prepare(
      selectEntrySql("WHERE request.effect_id = ? AND request.user_id IS ?"),
    );
    this.currentStatement = this.database.prepare(
      `${selectEntrySql("")} ORDER BY request.issued_at DESC, request.effect_id DESC LIMIT 1`,
    );
    this.currentUserStatement = this.database.prepare(
      `${selectEntrySql("WHERE request.user_id IS ?")} ORDER BY request.issued_at DESC, request.effect_id DESC LIMIT 1`,
    );
    this.lastManualOverrideStatement = this.database.prepare(`
      SELECT observed_at
      FROM effect_outcomes
      WHERE json_extract(outcome_json, '$.reason') IN (${MANUAL_REASON_SQL_LIST})
      ORDER BY observed_at DESC, outcome_id DESC
      LIMIT 1
    `);
    this.lastManualOverrideUserStatement = this.database.prepare(`
      SELECT observed_at
      FROM effect_outcomes
      WHERE user_id IS ?
        AND json_extract(outcome_json, '$.reason') IN (${MANUAL_REASON_SQL_LIST})
      ORDER BY observed_at DESC, outcome_id DESC
      LIMIT 1
    `);
  }

  public recordIssued(request: EffectRequest, userId?: string | null): void {
    this.insertEffectStatement.run(
      request.effectId,
      request.decisionId,
      request.actionId,
      request.issuedAt,
      JSON.stringify(request),
      userId ?? null,
    );
  }

  public recordOutcome(outcome: EffectOutcome, userId?: string | null): void {
    this.insertOutcomeStatement.run(
      outcome.outcomeId,
      outcome.effectId,
      outcome.status,
      outcome.observedAt,
      JSON.stringify(outcome),
      userId ?? null,
    );
  }

  public getById(
    effectId: string,
    userId?: string | null,
  ): EffectLedgerEntry | null {
    const candidate =
      userId === undefined
        ? this.byIdStatement.get(effectId)
        : this.byIdUserStatement.get(effectId, userId);
    return parseEntry(candidate);
  }

  public getCurrent(userId?: string | null): EffectLedgerEntry | null {
    const candidate =
      userId === undefined
        ? this.currentStatement.get()
        : this.currentUserStatement.get(userId);
    return parseEntry(candidate);
  }

  public getLastManualOverrideAt(userId?: string | null): string | null {
    const row: unknown =
      userId === undefined
        ? this.lastManualOverrideStatement.get()
        : this.lastManualOverrideUserStatement.get(userId);
    if (row === undefined || row === null) {
      return null;
    }
    if (
      typeof row !== "object" ||
      !("observed_at" in row) ||
      typeof row.observed_at !== "string"
    ) {
      throw new Error("Invalid manual override row shape.");
    }
    return row.observed_at;
  }
}

function selectEntrySql(whereClause: string): string {
  return `
    SELECT
      request.request_json,
      (
        SELECT outcome.outcome_json
        FROM effect_outcomes AS outcome
        WHERE outcome.effect_id = request.effect_id
        ORDER BY outcome.observed_at DESC, outcome.outcome_id DESC
        LIMIT 1
      ) AS outcome_json
    FROM effect_requests AS request
    ${whereClause}
  `;
}

function parseEntry(candidate: unknown): EffectLedgerEntry | null {
  if (candidate === undefined) {
    return null;
  }
  if (!isEffectJoinRow(candidate)) {
    throw new Error("Invalid effect ledger row shape.");
  }

  const request: unknown = JSON.parse(candidate.request_json);
  if (!Value.Check(EffectRequestSchema, request)) {
    throw new Error("Stored effect request failed schema validation.");
  }

  if (candidate.outcome_json === null) {
    return { request, latestOutcome: null };
  }

  const outcome: unknown = JSON.parse(candidate.outcome_json);
  if (!Value.Check(EffectOutcomeSchema, outcome)) {
    throw new Error("Stored effect outcome failed schema validation.");
  }
  return { request, latestOutcome: outcome };
}

function isEffectJoinRow(value: unknown): value is EffectJoinRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "request_json" in value &&
    typeof value.request_json === "string" &&
    "outcome_json" in value &&
    (value.outcome_json === null || typeof value.outcome_json === "string")
  );
}

interface TableInfoRow {
  readonly name: string;
}

function columnExists(
  database: SqliteDatabasePort,
  table: string,
  column: string,
): boolean {
  const rows = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as readonly TableInfoRow[];
  return rows.some((row) => row.name === column);
}
