import { decodeContextCursor, encodeContextCursor } from "./cursor.js";
import {
  ContextDomainError,
  idempotencyConflict,
  invalidEvent,
  storageFailure,
} from "./errors.js";
import { hashCloudEvent } from "./hash.js";
import type {
  CloudEventInput,
  ContextClock,
  ContextEventCandidate,
  ContextEventCounts,
  ContextEventListRequest,
  ContextEventPage,
  ContextEventStore,
  ContextIngestResult,
} from "./model.js";
import { SYSTEM_CLOCK } from "./model.js";

export interface ContextEventServiceOptions {
  /** Read the current published policy on each ingest. Never rewrites existing deadlines. */
  readonly getRetentionHours?: () => number;
  readonly defaultTtlSeconds?: number;
  readonly maxTtlSeconds?: number;
  readonly allowedLatenessMs?: number;
  readonly maxFutureSkewMs?: number;
  readonly clock?: ContextClock;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 90 * 24 * 60 * 60;
const DEFAULT_ALLOWED_LATENESS_MS = 5_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export class ContextEventService {
  private readonly store: ContextEventStore;
  private readonly defaultTtlSeconds: number;
  private readonly maxTtlSeconds: number;
  private readonly allowedLatenessMs: number;
  private readonly maxFutureSkewMs: number;
  private readonly clock: ContextClock;
  private readonly getRetentionHours: (() => number) | undefined;
  private serialTail: Promise<void> = Promise.resolve();

  public constructor(
    store: ContextEventStore,
    options: ContextEventServiceOptions = {},
  ) {
    this.store = store;
    this.getRetentionHours = options.getRetentionHours;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.maxTtlSeconds = options.maxTtlSeconds ?? MAX_TTL_SECONDS;
    this.allowedLatenessMs =
      options.allowedLatenessMs ?? DEFAULT_ALLOWED_LATENESS_MS;
    this.maxFutureSkewMs =
      options.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
    this.clock = options.clock ?? SYSTEM_CLOCK;

    if (
      this.defaultTtlSeconds <= 0 ||
      this.maxTtlSeconds < this.defaultTtlSeconds ||
      this.allowedLatenessMs < 0 ||
      this.maxFutureSkewMs < 0
    ) {
      throw new Error("ContextEventService options are invalid.");
    }
  }

  /**
   * Ingests a CloudEvent. The optional attribution records which user's
   * stream the event belongs to; omitted or null writes to the legacy global
   * stream, which is what auth-disabled local mode does (zero-diff).
   */
  public async ingest(
    event: CloudEventInput,
    options: Readonly<{ userId?: string | null }> = {},
  ): Promise<ContextIngestResult> {
    return this.serialize(async () => {
      const userId = options.userId ?? null;
      const now = this.clock.now();
      const receivedAt = now.toISOString();
      const occurredAt = normalizeOccurredAt(
        event.time,
        now,
        this.maxFutureSkewMs,
      );
      const retentionSeconds = this.retentionSeconds();
      if (retentionSeconds === 0) {
        throw new ContextDomainError(
          "CONTEXT_RETENTION_DISABLED",
          "Raw event retention is zero; ingestion is disabled without writing the event.",
          503,
        );
      }
      const requestedTtl = event.ttlSeconds ?? retentionSeconds;
      const ttlSeconds = Math.min(requestedTtl, retentionSeconds);
      if (!Number.isSafeInteger(requestedTtl) || requestedTtl <= 0) {
        throw invalidEvent("ttlseconds must be a positive integer.");
      }
      if (requestedTtl > this.maxTtlSeconds) {
        throw invalidEvent(
          `ttlseconds exceeds the configured maximum of ${this.maxTtlSeconds}.`,
        );
      }

      let watermark: string | undefined;
      try {
        watermark = await this.store.getOrderingWatermark({
          source: event.source,
          ...(event.subject === undefined ? {} : { subject: event.subject }),
          userId,
        });
      } catch (error: unknown) {
        throw storageFailure("getOrderingWatermark", error);
      }

      const occurredMs = Date.parse(occurredAt);
      const watermarkMs =
        watermark === undefined ? undefined : Date.parse(watermark);
      if (watermark !== undefined && !Number.isFinite(watermarkMs)) {
        throw storageFailure(
          "getOrderingWatermark",
          new Error("Storage returned an invalid ordering watermark."),
        );
      }
      const outOfOrder =
        watermarkMs !== undefined &&
        occurredMs < watermarkMs - this.allowedLatenessMs;
      const expiresAt = new Date(
        now.getTime() + ttlSeconds * 1_000,
      ).toISOString();
      const contentHash = hashCloudEvent(event);
      const candidate: ContextEventCandidate = {
        ...event,
        contentHash,
        occurredAt,
        receivedAt,
        expiresAt,
        outOfOrder,
      };

      try {
        const result = await this.store.appendEvent(candidate, {
          userId,
          retentionManaged: true,
        });
        assertStoredEvent(result.event, candidate);
        if (result.duplicate && result.event.contentHash !== contentHash) {
          throw idempotencyConflict(event.source, event.id);
        }
        return result;
      } catch (error: unknown) {
        if (error instanceof ContextDomainError) {
          throw error;
        }
        throw storageFailure("appendEvent", error);
      }
    });
  }

  /**
   * Lists events, optionally scoped to one user's stream. `userId` follows
   * the store convention: undefined = unfiltered, null = legacy global
   * stream, string = that user's stream.
   */
  public async list(
    request: ContextEventListRequest = {},
    userId?: string | null,
  ): Promise<ContextEventPage> {
    const afterSequence = decodeContextCursor(request.cursor);
    const limit = request.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_PAGE_SIZE) {
      throw invalidEvent(
        `limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`,
      );
    }
    const asOf = normalizeAsOf(request.asOf, this.clock.now());

    let rows;
    try {
      rows = await this.store.listEvents({
        afterSequence,
        limit: limit + 1,
        ...(request.source === undefined ? {} : { source: request.source }),
        ...(request.type === undefined ? {} : { type: request.type }),
        ...(request.subject === undefined ? {} : { subject: request.subject }),
        includeExpired: request.includeExpired ?? false,
        asOf,
        ...(userId === undefined ? {} : { userId }),
      });
    } catch (error: unknown) {
      throw storageFailure("listEvents", error);
    }

    assertListedEvents(rows, afterSequence);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeContextCursor(last.serverSequence) }
        : {}),
    };
  }

  /**
   * Aggregates the half-open event-time window `(since, until]` by type and
   * source for read-only consumers (currently the optional LLM summary). The
   * bounds are validated and ordered here so no caller can widen the window
   * semantics; payload columns are never read by the store implementation.
   * The optional userId scopes the window to one user's stream.
   */
  public async counts(
    since: string,
    until: string,
    userId?: string | null,
  ): Promise<ContextEventCounts> {
    const sinceMs = Date.parse(since);
    const untilMs = Date.parse(until);
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
      throw invalidEvent("counts bounds must be RFC3339 timestamps.");
    }
    if (sinceMs >= untilMs) {
      throw invalidEvent("counts window must start before it ends.");
    }
    try {
      return await this.store.countEvents({
        since,
        until,
        ...(userId === undefined ? {} : { userId }),
      });
    } catch (error: unknown) {
      throw storageFailure("countEvents", error);
    }
  }

  public async pruneExpired(limit = 500): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10_000) {
      throw invalidEvent("prune limit must be an integer from 1 to 10000.");
    }
    try {
      // A failed/invalid settings read must never fall back to destructive cleanup.
      this.retentionSeconds();
      return await this.store.pruneExpired(
        this.clock.now().toISOString(),
        limit,
      );
    } catch (error: unknown) {
      throw storageFailure("pruneExpired", error);
    }
  }

  private retentionSeconds(): number {
    if (this.getRetentionHours === undefined) return this.defaultTtlSeconds;
    try {
      const hours = this.getRetentionHours();
      if (!Number.isSafeInteger(hours) || hours < 0 || hours > 24 * 90) {
        throw new Error("Invalid published rawEventRetentionHours.");
      }
      return hours * 3600;
    } catch (error: unknown) {
      throw storageFailure("readRetentionPolicy", error);
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.serialTail.then(operation, operation);
    this.serialTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const normalizeOccurredAt = (
  input: string | undefined,
  now: Date,
  maxFutureSkewMs: number,
): string => {
  if (input === undefined) {
    return now.toISOString();
  }
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds)) {
    throw invalidEvent("CloudEvents time is invalid.");
  }
  if (milliseconds > now.getTime() + maxFutureSkewMs) {
    throw invalidEvent("CloudEvents time is too far in the future.");
  }
  return new Date(milliseconds).toISOString();
};

const normalizeAsOf = (input: string | undefined, now: Date): string => {
  if (input === undefined) {
    return now.toISOString();
  }
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds)) {
    throw invalidEvent("asOf must be an RFC3339 timestamp.");
  }
  return new Date(milliseconds).toISOString();
};

const assertStoredEvent = (
  event: Readonly<{
    source: string;
    id: string;
    serverSequence: number;
    occurredAt: string;
    receivedAt: string;
    expiresAt: string;
  }>,
  candidate: ContextEventCandidate,
): void => {
  if (
    event.source !== candidate.source ||
    event.id !== candidate.id ||
    !Number.isSafeInteger(event.serverSequence) ||
    event.serverSequence <= 0 ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    !Number.isFinite(Date.parse(event.receivedAt)) ||
    !Number.isFinite(Date.parse(event.expiresAt))
  ) {
    throw storageFailure(
      "appendEvent",
      new Error(
        "Storage returned an invalid or mismatched context event record.",
      ),
    );
  }
};

const assertListedEvents = (
  rows: readonly Readonly<{ serverSequence: number }>[],
  afterSequence: number,
): void => {
  let previous = afterSequence;
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.serverSequence) ||
      row.serverSequence <= previous
    ) {
      throw storageFailure(
        "listEvents",
        new Error(
          "Storage returned non-monotonic or invalid server sequences.",
        ),
      );
    }
    previous = row.serverSequence;
  }
};
