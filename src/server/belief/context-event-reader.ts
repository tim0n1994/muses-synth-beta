import type {
  ContextEventRecord,
  ContextEventStore,
} from "../context/model.js";
import type { BeliefEventReader, BeliefEventWindow } from "./model.js";
import type { BeliefReplayWindowCache } from "./replay-window-cache.js";

/**
 * Lower bound for the stream total: every stored occurredAt is an RFC3339
 * timestamp, so the half-open window `(STREAM_START, asOf]` is "everything
 * that has occurred as of asOf" — the same rows listEvents sees.
 */
const STREAM_START = "1970-01-01T00:00:00.000Z";

/**
 * R2 memory work (2026-10-21): how much of the stream tail is re-read on
 * every cached projection. The band both absorbs new events (any burst
 * smaller than the band needs no other read) and heals window damage caused
 * by events that became eligible later than they were sequenced (a future
 * occurredAt from a skewed collector clock). 64 rows is two orders of
 * magnitude cheaper than the 2000-row window while covering realistic edit
 * bursts between two projections.
 */
const HEALING_BAND_EVENTS = 64;

/**
 * Rebuild the window from a full read every N-th cached use. Bounds any
 * divergence class the incremental path cannot observe (see
 * BeliefReplayWindowCache.takeUse).
 */
const FULL_REFRESH_USES = 32;

export interface BeliefEventReaderOptions {
  /**
   * Hydrated window kept per shard and consulted only when the projection
   * opts in (`useWindowCache: true` — the composition root's hot path).
   * Undefined keeps the pre-R2 behavior: every projection reads the full
   * window.
   */
  readonly windowCache?: BeliefReplayWindowCache;
}

/**
 * Domain adapter from the M4 ContextEventStore port to the BeliefEventReader port.
 * The production ContextEventStore implementation remains owned by M2.
 *
 * The optional `userId` scopes the replay to one user's event stream: null is
 * the legacy global stream (auth-disabled local mode), a string is that
 * user's stream, and undefined leaves the read unfiltered.
 *
 * The read is the stream's most recent `limit` events by serverSequence — one
 * newest-first query, never a forward scan of the whole stream — so a stream
 * that outgrew the replay bound costs the same as one that just fits it. The
 * projector then replays the window oldest-first. The stream total is only
 * counted when the window came back full; a smaller result is its own total.
 *
 * When a window cache is attached and the projection opts in, a stream that
 * only moved forward is served from the cached hydrated events plus a small
 * tail band instead of re-reading and re-hydrating the whole window (see
 * replay-window-cache.ts for why). Any signal that the cached window can no
 * longer describe the stream — events losing eligibility, the stream's
 * sequence regressing (a restored backup under a live process), a backlog
 * larger than the window itself — falls back to the full read, so the cached
 * path can only ever be an optimization, never a different answer.
 */
export const createContextBeliefEventReader = (
  store: ContextEventStore,
  userId?: string | null,
  options: BeliefEventReaderOptions = {},
): BeliefEventReader => ({
  readForBelief: async ({
    asOf,
    limit,
    useWindowCache,
  }): Promise<BeliefEventWindow> => {
    const scope = userId === undefined ? {} : { userId };

    if (
      useWindowCache === true &&
      options.windowCache !== undefined &&
      userId !== undefined
    ) {
      const fast = await tryCachedWindow(
        store,
        userId,
        scope,
        options.windowCache,
        asOf,
        limit,
      );
      if (fast !== undefined) {
        return fast;
      }
    }

    // Full read — the pre-R2 path, unchanged — and, when the projection
    // opted in, the fill (or clear) of the window cache from its result.
    const events = await store.listEvents({
      afterSequence: 0,
      limit,
      includeExpired: false,
      asOf,
      order: "desc",
      ...scope,
    });
    if (useWindowCache === true && options.windowCache !== undefined) {
      if (events.length === 0) {
        options.windowCache.clear();
      } else {
        // The cache owns the arrays it holds; the projection consumes the
        // same reference without mutating it (see BeliefReplayWindowCache).
        options.windowCache.fill([...events].reverse(), limit);
      }
    }
    if (events.length < limit) {
      return { events, total: events.length };
    }
    const counts = await store.countEvents({
      since: STREAM_START,
      until: asOf,
      ...scope,
    });
    return { events, total: Math.max(counts.total, events.length) };
  },
});

/**
 * The hydrated-window fast path. Returns the window, or undefined when the
 * caller must fall back to a full read (the cache was dropped or cannot
 * describe the stream). Never answers from a window it did not first prove
 * current.
 */
const tryCachedWindow = async (
  store: ContextEventStore,
  userId: string | null,
  scope: Readonly<{ userId?: string | null }>,
  windowCache: BeliefReplayWindowCache,
  asOf: string,
  limit: number,
): Promise<BeliefEventWindow | undefined> => {
  const cached = windowCache.window;
  if (cached === undefined || cached.limit !== limit) {
    return undefined;
  }
  // Periodic full refresh: rebuild from scratch (bounds any divergence the
  // incremental path cannot observe).
  if (windowCache.takeUse(FULL_REFRESH_USES)) {
    windowCache.clear();
    return undefined;
  }

  // A stream that regressed below the cached window (a database restored
  // from backup under a live process) cannot be described by it.
  const floor = await store.getMaxServerSequence(userId);
  if (floor < cached.maxSequence) {
    windowCache.clear();
    return undefined;
  }

  // Every cached event must still be eligible at asOf. One that lost
  // eligibility (expiry, or an asOf earlier than the fill) would leave a
  // hole the window head has to backfill — start over instead.
  const asOfMs = Date.parse(asOf);
  const eligible = cached.events.filter(
    (event) =>
      Date.parse(event.expiresAt) > asOfMs &&
      Date.parse(event.occurredAt) <= asOfMs,
  );
  if (eligible.length !== cached.events.length) {
    windowCache.clear();
    return undefined;
  }

  // The healing band: the newest events by sequence, eligible at asOf.
  const band = await store.listEvents({
    afterSequence: 0,
    limit: HEALING_BAND_EVENTS,
    includeExpired: false,
    asOf,
    order: "desc",
    ...scope,
  });
  if (band.length < HEALING_BAND_EVENTS) {
    // Fewer eligible events in the whole stream than the band: the band is
    // the entire window.
    const events = [...band].reverse();
    windowCache.fill(events, limit);
    return { events, total: events.length };
  }
  const bandAscending = [...band].reverse();
  const oldestBanded = bandAscending[0];
  if (oldestBanded === undefined) {
    return undefined;
  }
  const bandMin = oldestBanded.serverSequence;
  const head = eligible.filter((event) => event.serverSequence < bandMin);

  if (cached.maxSequence >= bandMin) {
    // Nothing older than the band arrived since the window was built: the
    // cached head plus the band is the window.
    return finishWindow(windowCache, store, scope, asOf, limit, [
      ...head,
      ...bandAscending,
    ]);
  }

  // More than a band of new events landed since the window was built: fetch
  // everything past the cached head. A backlog the size of the whole window
  // (or larger) is cheaper and safer to rebuild from a full read.
  const delta = await store.listEvents({
    afterSequence: cached.maxSequence,
    limit,
    includeExpired: false,
    asOf,
    order: "asc",
    ...scope,
  });
  if (delta.length >= limit) {
    windowCache.clear();
    return undefined;
  }
  const bandSequences = new Set(
    bandAscending.map((event) => event.serverSequence),
  );
  const beyondBand = delta.filter(
    (event) => !bandSequences.has(event.serverSequence),
  );
  return finishWindow(windowCache, store, scope, asOf, limit, [
    ...head,
    ...beyondBand,
    ...bandAscending,
  ]);
};

/** Trim to the newest `limit`, count the stream total, refill the cache. */
const finishWindow = async (
  windowCache: BeliefReplayWindowCache,
  store: ContextEventStore,
  scope: Readonly<{ userId?: string | null }>,
  asOf: string,
  limit: number,
  mergedAscending: readonly ContextEventRecord[],
): Promise<BeliefEventWindow> => {
  const events =
    mergedAscending.length > limit
      ? mergedAscending.slice(mergedAscending.length - limit)
      : mergedAscending;
  if (events.length === 0) {
    windowCache.clear();
    return { events, total: 0 };
  }
  let total = events.length;
  if (events.length === limit) {
    const counts = await store.countEvents({
      since: STREAM_START,
      until: asOf,
      ...scope,
    });
    total = Math.max(counts.total, total);
  }
  windowCache.fill(events, limit);
  return { events, total };
};
