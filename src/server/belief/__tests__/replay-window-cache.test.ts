import { describe, expect, it } from "vitest";

import type {
  ContextEventCandidate,
  ContextEventStore,
  JsonValue,
} from "../../context/model.js";
import { InMemoryContextEventStore } from "../../context/__tests__/support/in-memory-context-event-store.js";
import { createContextBeliefEventReader } from "../context-event-reader.js";
import type { BeliefReplayWindowCache } from "../replay-window-cache.js";

/**
 * R2 memory work (2026-10-21): production RSS grew ~110 -> ~230MB after the
 * v0.6 P0 fix, and the same-build flag-off/flag-on comparison plus a live-at-
 * exit heap profile pinned the growth on one allocation path — every
 * post-ingest belief projection re-reading and re-hydrating the full 2000
 * event window (`listEvents({afterSequence: 0, limit: 2000, order: "desc"})`
 * plus 2000 JSON.parse calls per replay). The reader now keeps a per-shard
 * hydrated window and serves a projection whose stream only moved forward by
 * fetching the delta and appending, instead of re-reading the window.
 *
 * These tests drive the reader directly. The contract under test:
 *  - a forward-moving stream reads only the delta after the first full read;
 *  - any signal the cached window can no longer describe the stream (window
 *    events expiring, the stream sequence regressing — a restored backup,
 *    a gap larger than the whole window) falls back to a full re-read;
 *  - projections that do not ask for the cached path (`useWindowCache`
 *    absent/false — the public POST /belief/replay contract) always read
 *    the window in full;
 *  - the cached and uncached paths produce identical windows at every step.
 */

const NOW_MS = Date.parse("2026-10-21T12:00:00.000Z");

const editingEvent = (
  index: number,
  secondsAgo: number,
  options: { expiresInSeconds?: number; idPrefix?: string } = {},
): ContextEventCandidate => {
  const occurredAt = new Date(NOW_MS - secondsAgo * 1_000).toISOString();
  const prefix = options.idPrefix ?? "evt";
  return {
    specversion: "1.0",
    id: `${prefix}-${String(index).padStart(5, "0")}`,
    source: "urn:muses:window-cache",
    type: "muses.editor.activity",
    subject: "workspace:alpha",
    time: occurredAt,
    datacontenttype: "application/json",
    data: { action: "edit" } satisfies JsonValue,
    extensions: {},
    contentHash: `hash-${prefix}-${index}`,
    occurredAt,
    receivedAt: occurredAt,
    expiresAt: new Date(
      NOW_MS + (options.expiresInSeconds ?? 30 * 24 * 60 * 60) * 1_000,
    ).toISOString(),
    outOfOrder: false,
  };
};

interface ListCall {
  afterSequence: number;
  limit: number;
  order: string;
}

class SpyStore extends InMemoryContextEventStore {
  public readonly calls: ListCall[] = [];

  public override listEvents(
    query: Parameters<InMemoryContextEventStore["listEvents"]>[0],
  ): ReturnType<InMemoryContextEventStore["listEvents"]> {
    this.calls.push({
      afterSequence: query.afterSequence,
      limit: query.limit,
      order: query.order ?? "asc",
    });
    return super.listEvents(query);
  }

  /** Full window re-reads: afterSequence 0, newest-first, window-sized. */
  public fullReads(): number {
    return this.calls.filter(
      (call) =>
        call.afterSequence === 0 &&
        call.order === "desc" &&
        call.limit === 2_000,
    ).length;
  }

  /** Delta reads: anything anchored past a previous window head. */
  public deltaReads(): number {
    return this.calls.filter((call) => call.afterSequence > 0).length;
  }

  /** Healing-band reads: newest-first, band-sized. */
  public bandReads(): number {
    return this.calls.filter(
      (call) =>
        call.afterSequence === 0 && call.order === "desc" && call.limit === 64,
    ).length;
  }
}

const seed = async (
  store: InMemoryContextEventStore,
  count: number,
  options: { expiresInSeconds?: number; idPrefix?: string } = {},
): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await store.appendEvent(editingEvent(index, count - index, options), {
      userId: "user-a",
    });
  }
};

type CacheCtor = new (onFill?: () => void) => BeliefReplayWindowCache;

const loadCacheClass = async (): Promise<CacheCtor> => {
  const module = await import("../replay-window-cache.js");
  return module.BeliefReplayWindowCache;
};

const byId = (
  events: readonly { readonly id: string }[],
): { readonly id: string }[] =>
  [...events].sort((left, right) => left.id.localeCompare(right.id));

describe("belief replay window cache (reader level)", () => {
  it("serves a forward-moving stream from the delta after one full read", async () => {
    const WindowCache = await loadCacheClass();
    const store = new SpyStore();
    await seed(store, 2_050);

    const reader = createContextBeliefEventReader(store, "user-a", {
      windowCache: new WindowCache(),
    });

    const first = await reader.readForBelief({
      asOf: new Date(NOW_MS).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });
    expect(first.events).toHaveLength(2_000);
    expect(first.total).toBe(2_050);
    expect(store.fullReads()).toBe(1);

    await store.appendEvent(editingEvent(2_050, 0), { userId: "user-a" });
    const second = await reader.readForBelief({
      asOf: new Date(NOW_MS + 1_000).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });

    // RED until the cache lands: today every projection re-reads the window.
    expect(store.fullReads()).toBe(1);
    expect(store.bandReads()).toBe(1);
    expect(second.events).toHaveLength(2_000);
    expect(second.total).toBe(2_051);
    const ids = second.events.map((event) => event.id);
    expect(ids).toContain("evt-02050");
    expect(ids).not.toContain("evt-00000");
  });

  it("keeps the cached and uncached windows identical across a scripted stream", async () => {
    const WindowCache = await loadCacheClass();
    const store = new SpyStore();

    const cachedReader = createContextBeliefEventReader(store, "user-a", {
      windowCache: new WindowCache(),
    });
    const freshReader = createContextBeliefEventReader(store, "user-a");

    await seed(store, 2_050);
    let step = 0;
    // Interleave single appends, bursts, and no-op refreshes; compare every
    // cached window against a full uncached read of the same stream.
    for (const burst of [1, 1, 6, 0, 3, 0, 12, 1, 0, 5]) {
      for (let index = 0; index < burst; index += 1) {
        step += 1;
        await store.appendEvent(editingEvent(2_050 + step, step), {
          userId: "user-a",
        });
      }
      const asOf = new Date(NOW_MS + step * 1_000).toISOString();
      const cached = await cachedReader.readForBelief({
        asOf,
        limit: 2_000,
        useWindowCache: true,
      });
      const fresh = await freshReader.readForBelief({ asOf, limit: 2_000 });
      expect(byId(cached.events)).toEqual(byId(fresh.events));
      expect(cached.total).toBe(fresh.total);
    }
    // One initial full read + one healing-band read per cached step; the
    // uncached comparator contributes ten full reads of its own.
    expect(store.bandReads()).toBeGreaterThanOrEqual(7);
    expect(store.fullReads()).toBeLessThanOrEqual(11);
  });

  it("falls back to a full read when the gap outgrew the whole window", async () => {
    const WindowCache = await loadCacheClass();
    const store = new SpyStore();
    await seed(store, 2_050);

    const reader = createContextBeliefEventReader(store, "user-a", {
      windowCache: new WindowCache(),
    });
    await reader.readForBelief({
      asOf: new Date(NOW_MS).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });
    expect(store.fullReads()).toBe(1);

    // A backlog larger than the window itself under fresh ids: the delta
    // read comes back full, so the cached base cannot describe the newest
    // window and the reader must start over.
    await seed(store, 2_100, { idPrefix: "gap" });
    const window = await reader.readForBelief({
      asOf: new Date(NOW_MS + 2_000).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });
    expect(store.fullReads()).toBe(2);
    expect(window.events).toHaveLength(2_000);
    expect(window.total).toBe(4_150);
  });

  it("falls back to a full read once cached events start expiring", async () => {
    const WindowCache = await loadCacheClass();
    const store = new SpyStore();
    await seed(store, 2_050);

    // The newest event dies long before the rest of the window.
    await store.appendEvent(editingEvent(2_050, 0, { expiresInSeconds: 10 }), {
      userId: "user-a",
    });

    const reader = createContextBeliefEventReader(store, "user-a", {
      windowCache: new WindowCache(),
    });
    await reader.readForBelief({
      asOf: new Date(NOW_MS).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });
    expect(store.fullReads()).toBe(1);

    const stale = await reader.readForBelief({
      asOf: new Date(NOW_MS + 11 * 1_000).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });
    expect(store.fullReads()).toBe(2);
    expect(store.bandReads()).toBe(0);
    expect(stale.events).toHaveLength(2_000);
    expect(stale.total).toBe(2_050);
    expect(stale.events.map((event) => event.id)).not.toContain("evt-02050");
  });

  it("falls back to a full read when the stream sequence regressed", async () => {
    const WindowCache = await loadCacheClass();
    const real = new SpyStore();
    await seed(real, 2_050);

    // A store stub whose MAX(server_sequence) trails the cached window —
    // the shape of a restored-from-backup database under a live process.
    let probeMaxSequence = 2_050;
    const stub = {
      listEvents: (
        query: Parameters<InMemoryContextEventStore["listEvents"]>[0],
      ) => real.listEvents(query),
      countEvents: (
        query: Parameters<InMemoryContextEventStore["countEvents"]>[0],
      ) => real.countEvents(query),
      getMaxServerSequence: async () => probeMaxSequence,
    } as unknown as ContextEventStore;

    const reader = createContextBeliefEventReader(stub, "user-a", {
      windowCache: new WindowCache(),
    });
    await reader.readForBelief({
      asOf: new Date(NOW_MS).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });
    expect(real.fullReads()).toBe(1);

    probeMaxSequence = 1_900;
    await reader.readForBelief({
      asOf: new Date(NOW_MS + 1_000).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });
    expect(real.fullReads()).toBe(2);
  });

  it("never consults the cache for projections that do not ask for it", async () => {
    const WindowCache = await loadCacheClass();
    const store = new SpyStore();
    await seed(store, 2_050);

    const reader = createContextBeliefEventReader(store, "user-a", {
      windowCache: new WindowCache(),
    });
    await reader.readForBelief({
      asOf: new Date(NOW_MS).toISOString(),
      limit: 2_000,
      useWindowCache: true,
    });
    expect(store.fullReads()).toBe(1);

    // The public replay contract: no useWindowCache, always a full read.
    await reader.readForBelief({
      asOf: new Date(NOW_MS + 1_000).toISOString(),
      limit: 2_000,
    });
    await reader.readForBelief({
      asOf: new Date(NOW_MS + 2_000).toISOString(),
      limit: 2_000,
      useWindowCache: false,
    });
    expect(store.fullReads()).toBe(3);
    expect(store.bandReads()).toBe(0);
    expect(store.deltaReads()).toBe(0);
  });
});
