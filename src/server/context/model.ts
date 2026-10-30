export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface CloudEventInput {
  readonly specversion: "1.0";
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly subject?: string;
  readonly time?: string;
  readonly datacontenttype?: string;
  readonly dataschema?: string;
  readonly data?: JsonValue;
  readonly ttlSeconds?: number;
  readonly extensions: Readonly<Record<string, JsonValue>>;
}

export interface ContextEventIdentity {
  readonly source: string;
  readonly id: string;
}

export interface ContextEventCandidate extends CloudEventInput {
  readonly contentHash: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly expiresAt: string;
  readonly outOfOrder: boolean;
}

export interface ContextEventRecord extends ContextEventCandidate {
  readonly serverSequence: number;
}

export interface ContextIngestResult {
  readonly event: ContextEventRecord;
  readonly duplicate: boolean;
}

export interface ContextEventListRequest {
  readonly cursor?: string;
  readonly limit?: number;
  readonly source?: string;
  readonly type?: string;
  readonly subject?: string;
  readonly includeExpired?: boolean;
  readonly asOf?: string;
}

export interface ContextEventPage {
  readonly items: readonly ContextEventRecord[];
  readonly nextCursor?: string;
}

export interface EventStoreListQuery {
  readonly afterSequence: number;
  readonly limit: number;
  readonly source?: string;
  readonly type?: string;
  readonly subject?: string;
  readonly includeExpired: boolean;
  readonly asOf: string;
  /**
   * Per-user attribution filter (v0.6 personal space). Three states, by
   * design:
   *   - `undefined` — no filter; every row regardless of attribution. This is
   *     the pre-v0.6 behavior and stays the default so existing callers are
   *     unchanged.
   *   - `null` — the legacy global stream (`user_id IS NULL`): what
   *     auth-disabled local mode reads and writes.
   *   - a user id string — only that user's rows.
   */
  readonly userId?: string | null;
  /**
   * Row order by serverSequence. `"asc"` (the default) is the forward page
   * from `afterSequence`, unchanged for every existing caller. `"desc"`
   * returns the newest rows first, so with `afterSequence: 0` the result is
   * the most recent `limit` rows of the stream — the bounded window the
   * belief reader replays when a stream has outgrown its replay limit.
   */
  readonly order?: "asc" | "desc";
}

export interface ContextEventStoreAppendResult {
  readonly event: ContextEventRecord;
  readonly duplicate: boolean;
}

/**
 * Attribution written alongside the event. Omitted (or `userId: null`) stores
 * the row in the legacy global stream. The userId is a storage column only —
 * it never becomes part of the candidate JSON, the content hash, or the
 * dedupe identity, so a stored event remains byte-identical to v0.5.
 */
export interface ContextEventAttribution {
  readonly userId?: string | null;
  /** Only new events governed by the published retention policy are eligible for automatic deletion. */
  readonly retentionManaged?: boolean;
}

export interface ContextEventGroupCount {
  readonly type: string;
  readonly source: string;
  readonly count: number;
}

export interface ContextEventCounts {
  /** Precise event count inside the window, before the group cap is applied. */
  readonly total: number;
  readonly groups: readonly ContextEventGroupCount[];
}

export interface ContextEventStore {
  /**
   * Returns the latest event-time watermark for the ordering key. The adapter must
   * scope this by source + subject (and, when given, the user stream) and
   * return an RFC3339 timestamp when present. The userId filter follows the
   * EventStoreListQuery three-state convention.
   */
  getOrderingWatermark(
    identity: Readonly<{
      source: string;
      subject?: string;
      userId?: string | null;
    }>,
  ): Promise<string | undefined>;

  /**
   * Atomically allocates a strictly increasing positive serverSequence and inserts
   * the candidate, or returns the existing row for the unique (source, id) key.
   */
  appendEvent(
    candidate: ContextEventCandidate,
    attribution?: ContextEventAttribution,
  ): Promise<ContextEventStoreAppendResult>;

  /**
   * Returns rows ordered by serverSequence ascending, or descending (newest
   * first) when the query asks for `order: "desc"`.
   */
  listEvents(
    query: EventStoreListQuery,
  ): Promise<readonly ContextEventRecord[]>;

  /**
   * Aggregates unexpired events in the half-open event-time window
   * `(since, until]` by type and source, highest count first, capped at 50
   * groups. `total` is the precise event count before the group cap. Like
   * listEvents it only reads the denormalized columns — never the stored
   * event payload — so no caller can accidentally widen the privacy surface.
   * The optional userId filter follows the EventStoreListQuery convention.
   */
  countEvents(
    query: Readonly<{ since: string; until: string; userId?: string | null }>,
  ): Promise<ContextEventCounts>;

  /**
   * The highest allocated serverSequence in the given user's stream (the
   * legacy global stream for null), or 0 when the stream is empty. Served
   * from the idx_context_events_user index so the per-user belief cache can
   * detect "nothing changed" in O(log N) without replaying events.
   */
  getMaxServerSequence(userId: string | null): Promise<number>;

  /** Physically removes only marked, expired rows in bounded batches. */
  pruneExpired(asOf: string, limit: number): Promise<number>;
}

export interface ContextClock {
  now(): Date;
}

export const SYSTEM_CLOCK: ContextClock = {
  now: () => new Date(),
};
