import type { ContextEventRecord } from "../context/model.js";
import type {
  SqliteDatabasePort,
  SqlitePrimitive,
} from "../context/sqlite-context-event-store.js";
import type { PulseEventReader } from "./model.js";
import { PULSE_RULES } from "./rules.js";

interface EventRow {
  readonly server_sequence: number;
  readonly candidate_json: string;
}

/**
 * SQLite adapter for the PulseEventReader port.
 *
 * Reads the context_event_store table directly with a newest-first query
 * (the existing idx_context_event_store_occurred index on
 * occurred_at DESC, server_sequence DESC serves it), then reverses into
 * the deterministic ascending order the projector expects. This avoids the
 * BeliefEventReader pattern of paging the whole history ascending from
 * serverSequence 0 — a dense stream would otherwise make a 60s window read
 * its oldest rows first.
 *
 * The optional userId follows the EventStoreListQuery three-state
 * convention: undefined reads unfiltered, null is the legacy global
 * stream, a string is that user's stream.
 */
export const createSqlitePulseEventReader = (
  database: SqliteDatabasePort,
  userId?: string | null,
  windowMs: number = PULSE_RULES.windowMs,
): PulseEventReader => ({
  // eslint-disable-next-line @typescript-eslint/require-await -- PulseEventReader port requires Promise; better-sqlite3 is synchronous.
  readRecentForPulse: async ({ asOf, limit }) => {
    const asOfMs = Date.parse(asOf);
    if (!Number.isFinite(asOfMs)) {
      throw new Error("Pulse reader asOf must be a valid timestamp.");
    }
    const since = new Date(asOfMs - windowMs).toISOString();

    const where: string[] = [
      "occurred_at > ?",
      "occurred_at <= ?",
      "expires_at > ?",
    ];
    const params: SqlitePrimitive[] = [since, asOf, asOf];
    if (userId !== undefined) {
      where.push("user_id IS ?");
      params.push(userId);
    }

    const rows = database
      .prepare(
        `SELECT server_sequence, candidate_json FROM context_event_store
         WHERE ${where.join(" AND ")}
         ORDER BY occurred_at DESC, server_sequence DESC
         LIMIT ?`,
      )
      .all(...params, limit) as readonly EventRow[];

    return rows
      .slice()
      .reverse()
      .map((row) => hydrate(row.server_sequence, row.candidate_json));
  },
});

const hydrate = (
  serverSequence: number,
  candidateJson: string,
): ContextEventRecord =>
  ({
    ...(JSON.parse(candidateJson) as Record<string, unknown>),
    serverSequence,
  }) as ContextEventRecord;
