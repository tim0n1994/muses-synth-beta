import type {
  ContextEventAttribution,
  ContextEventCandidate,
  ContextEventCounts,
  ContextEventRecord,
  ContextEventStore,
  ContextEventStoreAppendResult,
  EventStoreListQuery,
} from "./model.js";

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

interface WatermarkRow {
  readonly watermark: string | null;
}

interface CountRow {
  readonly count: number;
}

interface GroupCountRow {
  readonly type: string;
  readonly source: string;
  readonly count: number;
}

/**
 * SQLite-backed ContextEventStore. Each repository owns its table (matching the
 * SqliteEffectRepository / SqliteDecisionRepository convention) rather than the
 * migration-001 projection tables. The full candidate is stored as JSON with
 * the columns the belief reader and list/purge queries need denormalized.
 */
export class SqliteContextEventStore implements ContextEventStore {
  private readonly insertStatement: SqliteStatementPort;
  private readonly byIdentityStatement: SqliteStatementPort;
  private readonly countTotalStatement: SqliteStatementPort;
  private readonly countGroupsStatement: SqliteStatementPort;
  private readonly countTotalUserStatement: SqliteStatementPort;
  private readonly countGroupsUserStatement: SqliteStatementPort;
  private readonly maxSequenceStatement: SqliteStatementPort;

  public constructor(private readonly database: SqliteDatabasePort) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS context_event_store (
        server_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        subject TEXT,
        occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        out_of_order INTEGER NOT NULL CHECK (out_of_order IN (0, 1)),
        content_hash TEXT NOT NULL,
        candidate_json TEXT NOT NULL,
        user_id TEXT,
        UNIQUE (source, id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_context_event_store_occurred
        ON context_event_store (occurred_at DESC, server_sequence DESC);
      CREATE INDEX IF NOT EXISTS idx_context_event_store_source_subject
        ON context_event_store (source, subject, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_context_event_store_expires
        ON context_event_store (expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_context_events_user
        ON context_event_store (user_id, server_sequence);
    `);
    // A database created before v0.6 has the table without user_id; migration
    // 004 adds the column at startup, but this constructor also guards for
    // databases assembled without runMigrations (test harnesses), keeping the
    // two paths from drifting.
    if (!columnExists(this.database, "context_event_store", "user_id")) {
      this.database.exec(
        `ALTER TABLE context_event_store ADD COLUMN user_id TEXT;`,
      );
      this.database.exec(
        `CREATE INDEX IF NOT EXISTS idx_context_events_user
           ON context_event_store (user_id, server_sequence);`,
      );
    }

    // Existing history is excluded; no deadline or payload is rewritten.
    if (
      !columnExists(this.database, "context_event_store", "retention_managed")
    ) {
      this.database.exec(
        "ALTER TABLE context_event_store ADD COLUMN retention_managed INTEGER NOT NULL DEFAULT 0 CHECK (retention_managed IN (0, 1));",
      );
    }
    this.database.exec(`CREATE INDEX IF NOT EXISTS idx_context_retention_managed
      ON context_event_store (expires_at, server_sequence) WHERE retention_managed = 1;`);
    this.insertStatement = this.database.prepare(`
      INSERT INTO context_event_store (
        id, source, type, subject, occurred_at, received_at,
        expires_at, out_of_order, content_hash, candidate_json, user_id, retention_managed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (source, id) DO NOTHING
    `);
    this.byIdentityStatement = this.database.prepare(`
      SELECT server_sequence, candidate_json, user_id FROM context_event_store
      WHERE source = ? AND id = ?
    `);
    // Bounded aggregation for the LLM summary window (and any future reader):
    // only type/source/time columns are touched, never candidate_json, and the
    // group list is capped in SQL rather than in the caller. The *User
    // variants add the attribution predicate so a per-user summary counts
    // only that user's window.
    this.countTotalStatement = this.database.prepare(`
      SELECT COUNT(*) AS count FROM context_event_store
      WHERE occurred_at > ? AND occurred_at <= ? AND expires_at > ?
    `);
    this.countGroupsStatement = this.database.prepare(`
      SELECT type, source, COUNT(*) AS count FROM context_event_store
      WHERE occurred_at > ? AND occurred_at <= ? AND expires_at > ?
      GROUP BY type, source
      ORDER BY count DESC, type ASC, source ASC
      LIMIT 50
    `);
    this.countTotalUserStatement = this.database.prepare(`
      SELECT COUNT(*) AS count FROM context_event_store
      WHERE occurred_at > ? AND occurred_at <= ? AND expires_at > ? AND user_id IS ?
    `);
    this.countGroupsUserStatement = this.database.prepare(`
      SELECT type, source, COUNT(*) AS count FROM context_event_store
      WHERE occurred_at > ? AND occurred_at <= ? AND expires_at > ? AND user_id IS ?
      GROUP BY type, source
      ORDER BY count DESC, type ASC, source ASC
      LIMIT 50
    `);
    // MAX(server_sequence) per user stream: the per-user belief cache's
    // change probe. Backed by idx_context_events_user (user_id,
    // server_sequence), so this is an index seek, not a scan.
    this.maxSequenceStatement = this.database.prepare(
      `SELECT MAX(server_sequence) AS max_sequence FROM context_event_store
       WHERE user_id IS ?`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- ContextEventStore port requires Promise; better-sqlite3 is synchronous.
  public async getOrderingWatermark(
    identity: Readonly<{
      source: string;
      subject?: string;
      userId?: string | null;
    }>,
  ): Promise<string | undefined> {
    const subjectClause =
      identity.subject === undefined ? "subject IS NULL" : "subject = ?";
    const userClause = identity.userId === undefined ? "" : " AND user_id IS ?";
    const statement = this.database.prepare(
      `SELECT MAX(occurred_at) AS watermark FROM context_event_store
       WHERE source = ? AND ${subjectClause}${userClause}`,
    );
    const params: SqlitePrimitive[] = [identity.source];
    if (identity.subject !== undefined) {
      params.push(identity.subject);
    }
    if (identity.userId !== undefined) {
      params.push(identity.userId);
    }
    const row = statement.get(...params) as WatermarkRow | undefined;
    return row?.watermark ?? undefined;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- ContextEventStore port requires Promise; better-sqlite3 is synchronous.
  public async appendEvent(
    candidate: ContextEventCandidate,
    attribution?: ContextEventAttribution,
  ): Promise<ContextEventStoreAppendResult> {
    const userId = attribution?.userId ?? null;
    const result = this.insertStatement.run(
      candidate.id,
      candidate.source,
      candidate.type,
      candidate.subject ?? null,
      candidate.occurredAt,
      candidate.receivedAt,
      candidate.expiresAt,
      candidate.outOfOrder ? 1 : 0,
      candidate.contentHash,
      JSON.stringify(candidate),
      userId,
      attribution?.retentionManaged === true ? 1 : 0,
    );

    if (result.changes === 0) {
      const existing = this.byIdentityStatement.get(
        candidate.source,
        candidate.id,
      ) as
        | {
            server_sequence: number;
            candidate_json: string;
            user_id: string | null;
          }
        | undefined;
      if (existing === undefined) {
        throw new Error(
          "Context event insert reported no changes but no existing row was found.",
        );
      }
      if (existing.user_id !== userId) {
        throw new Error("Context event identity belongs to another stream.");
      }
      return {
        event: hydrate(existing.server_sequence, existing.candidate_json),
        duplicate: true,
      };
    }

    return {
      event: hydrate(Number(result.lastInsertRowid), JSON.stringify(candidate)),
      duplicate: false,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- ContextEventStore port requires Promise; better-sqlite3 is synchronous.
  public async listEvents(
    query: EventStoreListQuery,
  ): Promise<readonly ContextEventRecord[]> {
    const where: string[] = ["server_sequence > ?", "occurred_at <= ?"];
    const params: SqlitePrimitive[] = [query.afterSequence, query.asOf];

    if (query.source !== undefined) {
      where.push("source = ?");
      params.push(query.source);
    }
    if (query.type !== undefined) {
      where.push("type = ?");
      params.push(query.type);
    }
    if (query.subject !== undefined) {
      where.push("subject = ?");
      params.push(query.subject);
    }
    if (query.userId !== undefined) {
      where.push("user_id IS ?");
      params.push(query.userId);
    }
    if (!query.includeExpired) {
      where.push("expires_at > ?");
      params.push(query.asOf);
    }

    // Both directions are served by the primary key (or idx_context_events_user
    // when scoped to a stream), so the newest-first window is an index walk
    // from the top, never a sort.
    const direction = query.order === "desc" ? "DESC" : "ASC";
    const statement = this.database.prepare(
      `SELECT server_sequence, candidate_json FROM context_event_store
       WHERE ${where.join(" AND ")}
       ORDER BY server_sequence ${direction}
       LIMIT ?`,
    );
    params.push(query.limit);

    const rows = statement.all(...params) as readonly {
      server_sequence: number;
      candidate_json: string;
    }[];
    return rows.map((row) => hydrate(row.server_sequence, row.candidate_json));
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- ContextEventStore port requires Promise; better-sqlite3 is synchronous.
  public async countEvents(
    query: Readonly<{ since: string; until: string; userId?: string | null }>,
  ): Promise<ContextEventCounts> {
    // `user_id IS ?` binds null as the legacy global stream and a user id as
    // that user's stream; undefined keeps the unfiltered pre-v0.6 read.
    const totalRow =
      query.userId === undefined
        ? (this.countTotalStatement.get(
            query.since,
            query.until,
            query.until,
          ) as CountRow | undefined)
        : (this.countTotalUserStatement.get(
            query.since,
            query.until,
            query.until,
            query.userId,
          ) as CountRow | undefined);
    const groupRows =
      query.userId === undefined
        ? (this.countGroupsStatement.all(
            query.since,
            query.until,
            query.until,
          ) as readonly GroupCountRow[])
        : (this.countGroupsUserStatement.all(
            query.since,
            query.until,
            query.until,
            query.userId,
          ) as readonly GroupCountRow[]);
    return {
      total: totalRow?.count ?? 0,
      groups: groupRows.map((row) => ({
        type: row.type,
        source: row.source,
        count: row.count,
      })),
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- ContextEventStore port requires Promise; better-sqlite3 is synchronous.
  public async getMaxServerSequence(userId: string | null): Promise<number> {
    const row = this.maxSequenceStatement.get(userId) as
      { max_sequence: number | null } | undefined;
    return row?.max_sequence ?? 0;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- ContextEventStore port requires Promise; better-sqlite3 is synchronous.
  public async pruneExpired(asOf: string, limit: number): Promise<number> {
    if (
      !Number.isFinite(Date.parse(asOf)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 10_000
    ) {
      throw new Error("Invalid context cleanup bounds.");
    }
    const statement = this.database.prepare(
      `DELETE FROM context_event_store
       WHERE rowid IN (
         SELECT rowid FROM context_event_store
         WHERE expires_at <= ? AND retention_managed = 1
         ORDER BY expires_at, server_sequence
         LIMIT ?
       )`,
    );
    const result = statement.run(asOf, limit);
    return result.changes;
  }
}

function hydrate(
  serverSequence: number,
  candidateJson: string,
): ContextEventRecord {
  const candidate = JSON.parse(candidateJson) as ContextEventCandidate;
  return { ...candidate, serverSequence };
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
