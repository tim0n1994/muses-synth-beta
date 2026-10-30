import { describe, expect, it } from "vitest";

import type {
  ContextEventCandidate,
  ContextClock,
  JsonValue,
} from "../context/model.js";
import { InMemoryContextEventStore } from "../context/__tests__/support/in-memory-context-event-store.js";
import { PerUserRuntimes } from "./per-user-runtimes.js";

/**
 * R2 memory work (2026-10-21): the shard-level wiring of the belief replay
 * window cache. PerUserRuntimes owns one hydrated window per shard; the hot
 * path (currentFor -> service.replay) must ask the reader to reuse it, the
 * public POST /belief/replay path must stay uncached, the per-user windows
 * are bounded by a byte budget with LRU eviction across shards, and the
 * cached projections must stay byte-identical to uncached ones.
 */

const NOW_MS = Date.parse("2026-10-21T12:00:00.000Z");

const mutableClock = (): {
  clock: ContextClock;
  advanceTo: (ms: number) => void;
} => {
  let currentMs = NOW_MS;
  return {
    clock: { now: () => new Date(currentMs) },
    advanceTo: (ms: number) => {
      currentMs = ms;
    },
  };
};

const editingEvent = (
  index: number,
  secondsAgo: number,
): ContextEventCandidate => {
  const occurredAt = new Date(NOW_MS - secondsAgo * 1_000).toISOString();
  return {
    specversion: "1.0",
    id: `evt-${String(index).padStart(5, "0")}`,
    source: "urn:muses:window-cache",
    type: "muses.editor.activity",
    subject: "workspace:alpha",
    time: occurredAt,
    datacontenttype: "application/json",
    data: { action: "edit" } satisfies JsonValue,
    extensions: {},
    contentHash: `hash-${index}`,
    occurredAt,
    receivedAt: occurredAt,
    expiresAt: new Date(NOW_MS + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    outOfOrder: false,
  };
};

interface ListCall {
  afterSequence: number;
  limit: number;
  order: string;
  userId?: string | null;
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
      ...(query.userId === undefined ? {} : { userId: query.userId }),
    });
    return super.listEvents(query);
  }

  public fullReadsFor(userId: string): number {
    return this.calls.filter(
      (call) =>
        call.afterSequence === 0 &&
        call.order === "desc" &&
        call.limit === 2_000 &&
        call.userId === userId,
    ).length;
  }

  public deltaReadsFor(userId: string): number {
    return this.calls.filter(
      (call) => call.afterSequence > 0 && call.userId === userId,
    ).length;
  }

  /** Healing-band or delta reads: any window-avoiding read. */
  public tailReadsFor(userId: string): number {
    return this.calls.filter(
      (call) =>
        call.userId === userId &&
        (call.afterSequence > 0 ||
          (call.order === "desc" && call.limit === 64)),
    ).length;
  }
}

const seed = async (
  store: InMemoryContextEventStore,
  userId: string,
  count: number,
  idOffset = 0,
): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    const result = await store.appendEvent(
      editingEvent(idOffset + index, count - index),
      { userId },
    );
    // The store dedupes by (source, id) GLOBALLY, not per user: a second
    // user seeded with the same ids gets an empty stream and the scenario
    // silently degenerates (this is exactly how the eviction test passed
    // vacuously). Refuse to seed duplicates.
    if (result.duplicate) {
      throw new Error(
        `seed(${userId}): duplicate event id at index ${index} — use idOffset`,
      );
    }
  }
};

/** One 2000-event window's approximate footprint (see replay-window-cache.ts). */
const ONE_WINDOW_BYTES = 2_000 * 1_536;

describe("PerUserRuntimes belief window cache wiring", () => {
  // These tests fold real 2000-event windows (the point of the memory work);
  // under a contended host each projection can take seconds.
  it(
    "replays a moved stream from the window delta on the hot path",
    { timeout: 60_000 },
    async () => {
      const store = new SpyStore();
      await seed(store, "user-a", 2_050);
      const { clock, advanceTo } = mutableClock();

      const runtimes = new PerUserRuntimes({
        store,
        maxEvents: 2_000,
        // 0 disables serving the snapshot from cache: every current() re-projects,
        // isolating the window cache as the only cache in play.
        maxCacheAgeMs: 0,
        clock,
        windowCacheBytes: ONE_WINDOW_BYTES * 4,
      });

      await runtimes.getFor("user-a").belief.current();
      expect(store.fullReadsFor("user-a")).toBe(1);

      await store.appendEvent(editingEvent(2_050, 0), { userId: "user-a" });
      advanceTo(NOW_MS + 1_000);
      const snapshot = await runtimes.getFor("user-a").belief.current();

      // RED until the wiring lands: today every re-projection re-reads the
      // full 2000-event window (the R2 RSS driver).
      expect(store.fullReadsFor("user-a")).toBe(1);
      expect(store.tailReadsFor("user-a")).toBe(1);
      expect(snapshot.lastServerSequence).toBe(2_051);
    },
  );

  it(
    "keeps cached projections identical to uncached ones across bursts",
    { timeout: 180_000 },
    async () => {
      const store = new SpyStore();
      await seed(store, "user-a", 2_050);
      const { clock, advanceTo } = mutableClock();

      const cached = new PerUserRuntimes({
        store,
        maxEvents: 2_000,
        maxCacheAgeMs: 0,
        clock,
        windowCacheBytes: ONE_WINDOW_BYTES * 4,
      });
      const fresh = new PerUserRuntimes({
        store,
        maxEvents: 2_000,
        maxCacheAgeMs: 0,
        clock,
        windowCacheBytes: 0,
      });

      // Warm the cached runtime's window with one full read, so every bursty
      // step below starts from a filled window.
      advanceTo(NOW_MS);
      await cached.getFor("user-a").belief.current();

      let step = 0;
      for (const burst of [1, 4, 0, 9, 2, 0, 30, 1]) {
        for (let index = 0; index < burst; index += 1) {
          step += 1;
          await store.appendEvent(editingEvent(2_050 + step, step), {
            userId: "user-a",
          });
        }
        advanceTo(NOW_MS + step * 1_000);
        expect(await cached.getFor("user-a").belief.current()).toEqual(
          await fresh.getFor("user-a").belief.current(),
        );
      }
      // Every appending step (6 of the 8) reads a healing band instead of the
      // window; the two quiet steps snapshot-hit (unchanged sequence, aged 0).
      expect(store.tailReadsFor("user-a")).toBeGreaterThanOrEqual(6);
    },
  );

  it(
    "evicts the least recently used window when the byte budget is exceeded",
    { timeout: 60_000 },
    async () => {
      const store = new SpyStore();
      await seed(store, "user-a", 2_050);
      // user-b needs its own ids: the store dedupes by (source, id) across
      // users, so seeding B with A's ids leaves B's stream empty, B's window
      // never fills, and A is never under budget pressure.
      await seed(store, "user-b", 2_050, 10_000);
      const { clock } = mutableClock();

      const runtimes = new PerUserRuntimes({
        store,
        maxEvents: 2_000,
        maxCacheAgeMs: 0,
        clock,
        // Room for exactly one hydrated window.
        windowCacheBytes: ONE_WINDOW_BYTES,
      });

      await runtimes.getFor("user-a").belief.current();
      expect(store.fullReadsFor("user-a")).toBe(1);

      // B's window fills the budget: A's (older LRU position) must be dropped.
      await runtimes.getFor("user-b").belief.current();
      expect(store.fullReadsFor("user-b")).toBe(1);

      await store.appendEvent(editingEvent(2_050, 0), { userId: "user-a" });
      await runtimes.getFor("user-a").belief.current();
      expect(store.fullReadsFor("user-a")).toBe(2);
      expect(store.tailReadsFor("user-a")).toBe(0);
      // B is untouched by A's re-read.
      expect(store.fullReadsFor("user-b")).toBe(1);
    },
  );

  it(
    "disables the window cache entirely at windowCacheBytes 0",
    { timeout: 180_000 },
    async () => {
      const store = new SpyStore();
      await seed(store, "user-a", 2_050);
      const { clock } = mutableClock();

      const runtimes = new PerUserRuntimes({
        store,
        clock,
        maxEvents: 2_000,
        maxCacheAgeMs: 0,
        windowCacheBytes: 0,
      });

      await runtimes.getFor("user-a").belief.current();
      await store.appendEvent(editingEvent(2_050, 0), { userId: "user-a" });
      await runtimes.getFor("user-a").belief.current();

      expect(store.fullReadsFor("user-a")).toBe(2);
      expect(store.tailReadsFor("user-a")).toBe(0);
    },
  );
});
