import { Value } from "@sinclair/typebox/value";

import { DecisionSchema, type Decision } from "./contracts.js";
import type { DecisionRepository } from "./repository.js";

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

interface DecisionRow {
  readonly decision_json: string;
}

export class SqliteDecisionRepository implements DecisionRepository {
  private readonly insertStatement: SqliteStatementPort;
  private readonly currentStatement: SqliteStatementPort;
  private readonly currentUserStatement: SqliteStatementPort;

  public constructor(private readonly database: SqliteDatabasePort) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS policy_decisions (
        decision_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        user_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_policy_decisions_current
        ON policy_decisions(created_at DESC, decision_id DESC);
      CREATE INDEX IF NOT EXISTS idx_policy_decisions_user_current
        ON policy_decisions(user_id, created_at DESC, decision_id DESC);
    `);
    // Databases created before v0.6 have the table without user_id; migration
    // 004 adds it at startup, this guard covers harnesses that skip
    // runMigrations.
    if (!columnExists(this.database, "policy_decisions", "user_id")) {
      this.database.exec(
        `ALTER TABLE policy_decisions ADD COLUMN user_id TEXT;`,
      );
      this.database.exec(
        `CREATE INDEX IF NOT EXISTS idx_policy_decisions_user_current
           ON policy_decisions(user_id, created_at DESC, decision_id DESC);`,
      );
    }
    this.insertStatement = this.database.prepare(`
      INSERT INTO policy_decisions (
        decision_id,
        created_at,
        kind,
        decision_json,
        user_id
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(decision_id) DO NOTHING
    `);
    this.currentStatement = this.database.prepare(`
      SELECT decision_json
      FROM policy_decisions
      ORDER BY created_at DESC, decision_id DESC
      LIMIT 1
    `);
    this.currentUserStatement = this.database.prepare(`
      SELECT decision_json
      FROM policy_decisions
      WHERE user_id IS ?
      ORDER BY created_at DESC, decision_id DESC
      LIMIT 1
    `);
  }

  public save(decision: Decision, userId?: string | null): void {
    this.insertStatement.run(
      decision.decisionId,
      decision.createdAt,
      decision.kind,
      JSON.stringify(decision),
      userId ?? null,
    );
  }

  public getCurrent(userId?: string | null): Decision | null {
    const candidate =
      userId === undefined
        ? this.currentStatement.get()
        : this.currentUserStatement.get(userId);
    if (candidate === undefined) {
      return null;
    }
    if (!isDecisionRow(candidate)) {
      throw new Error("Invalid policy_decisions row shape.");
    }

    const parsed: unknown = JSON.parse(candidate.decision_json);
    if (!Value.Check(DecisionSchema, parsed)) {
      throw new Error("Stored current decision failed schema validation.");
    }
    return parsed;
  }
}

function isDecisionRow(value: unknown): value is DecisionRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "decision_json" in value &&
    typeof value.decision_json === "string"
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
