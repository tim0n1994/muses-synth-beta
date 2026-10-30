import { describe, expect, it } from "vitest";

import type { ContextEventCandidate, JsonValue } from "../context/model.js";
import { InMemoryContextEventStore } from "../context/__tests__/support/in-memory-context-event-store.js";
import { PerUserRuntimes } from "./per-user-runtimes.js";

const iso = (secondsAgo: number): string =>
  new Date(Date.now() - secondsAgo * 1_000).toISOString();

const editingEvent = (
  id: string,
  secondsAgo: number,
): ContextEventCandidate => ({
  specversion: "1.0",
  id,
  source: "urn:muses:test",
  type: "muses.editor.activity",
  subject: "workspace:alpha",
  time: iso(secondsAgo),
  datacontenttype: "application/json",
  data: { action: "edit" } satisfies JsonValue,
  extensions: {},
  contentHash: `hash-${id}`,
  occurredAt: iso(secondsAgo),
  receivedAt: iso(secondsAgo),
  expiresAt: iso(-60 * 60 * 24 * 30),
  outOfOrder: false,
});

const appendFor = async (
  store: InMemoryContextEventStore,
  userId: string | null,
  id: string,
  secondsAgo: number,
): Promise<void> => {
  await store.appendEvent(editingEvent(id, secondsAgo), { userId });
};

describe("PerUserRuntimes", () => {
  it("isolates each user's belief projection to that user's events", async () => {
    const store = new InMemoryContextEventStore();
    await appendFor(store, "user-a", "a-1", 240);
    await appendFor(store, "user-a", "a-2", 120);
    await appendFor(store, "user-a", "a-3", 5);
    await appendFor(store, "user-b", "b-1", 30);

    const runtimes = new PerUserRuntimes({ store });

    const snapshotA = await runtimes.getFor("user-a").belief.current();
    const snapshotB = await runtimes.getFor("user-b").belief.current();

    expect(snapshotA.state).toBe("BUILD");
    const evidenceA = snapshotA.evidence.map((entry) => entry.eventId);
    for (const eventId of evidenceA) {
      expect(eventId.startsWith("a-")).toBe(true);
    }

    // B's stream holds a single edit: no cross-contamination from A's
    // sustained editing, so B cannot reach the same projection.
    const evidenceB = snapshotB.evidence.map((entry) => entry.eventId);
    expect(evidenceB).toEqual(["b-1"]);
    expect(snapshotB.lastServerSequence).toBe(4);
  });

  it("serves unchanged streams from cache and replays only after new events", async () => {
    const store = new InMemoryContextEventStore();
    await appendFor(store, "user-a", "a-1", 240);
    await appendFor(store, "user-a", "a-2", 120);

    const runtimes = new PerUserRuntimes({ store });

    const first = await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.replays).toBe(1);
    expect(runtimes.stats.cacheHits).toBe(0);

    const second = await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.replays).toBe(1);
    expect(runtimes.stats.cacheHits).toBe(1);
    // Cache hit returns the exact cached projection object.
    expect(second).toBe(first);

    // Explicit invalidation forces the next read to replay even though the
    // sequence probe would have matched — this is the post-ingest path.
    runtimes.invalidate("user-a");
    await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.replays).toBe(2);
    expect(runtimes.stats.cacheHits).toBe(1);

    // A genuinely new event also misses: the MAX(server_sequence) probe moved.
    await appendFor(store, "user-a", "a-3", 5);
    const third = await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.replays).toBe(3);
    expect(third.lastServerSequence).toBe(3);

    // Other users' events do not invalidate this user's cache.
    await appendFor(store, "user-b", "b-1", 5);
    await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.replays).toBe(3);
    expect(runtimes.stats.cacheHits).toBe(2);
  });

  it("keeps the null (legacy global) stream separate from user streams", async () => {
    const store = new InMemoryContextEventStore();
    await appendFor(store, "user-a", "a-1", 30);
    await appendFor(store, null, "anon-1", 30);
    await appendFor(store, null, "anon-2", 20);

    const runtimes = new PerUserRuntimes({ store });

    const anonymous = await runtimes.getFor(null).belief.current();
    // anon-1 (seq 2) and anon-2 (seq 3) — user-a's seq-1 event is excluded.
    expect(anonymous.lastServerSequence).toBe(3);

    const userA = await runtimes.getFor("user-a").belief.current();
    expect(userA.lastServerSequence).toBe(1);
    expect(
      userA.evidence.map((entry) => entry.eventId).includes("anon-1"),
    ).toBe(false);
  });

  it("evicts the least recently used shard above the user cap", async () => {
    const store = new InMemoryContextEventStore();
    await appendFor(store, "user-1", "u1", 30);
    await appendFor(store, "user-2", "u2", 30);
    await appendFor(store, "user-3", "u3", 30);
    await appendFor(store, "user-4", "u4", 30);

    const runtimes = new PerUserRuntimes({ store, maxUsers: 3 });

    await runtimes.getFor("user-1").belief.current();
    await runtimes.getFor("user-2").belief.current();
    await runtimes.getFor("user-3").belief.current();
    // Touching user-1 refreshes its LRU position...
    await runtimes.getFor("user-1").belief.current();
    // ...so user-2 becomes the oldest and is evicted by user-4's arrival.
    await runtimes.getFor("user-4").belief.current();

    expect(runtimes.cachedUsers).toBe(3);
    expect(runtimes.stats.usersEvicted).toBe(1);

    // The evicted user replays on its next read instead of erroring.
    const replayCount = runtimes.stats.replays;
    await runtimes.getFor("user-2").belief.current();
    expect(runtimes.stats.replays).toBe(replayCount + 1);
  });

  it("replay() always re-projects without consulting the cache", async () => {
    const store = new InMemoryContextEventStore();
    await appendFor(store, "user-a", "a-1", 30);

    const runtimes = new PerUserRuntimes({ store });
    const belief = runtimes.getFor("user-a").belief;

    const first = await belief.replay();
    const second = await belief.replay();
    expect(runtimes.stats.replays).toBe(0);
    expect(runtimes.stats.cacheHits).toBe(0);
    expect(second.state).toBe(first.state);
  });

  it("re-projects an aged-out cache even when the stream has not moved", async () => {
    const store = new InMemoryContextEventStore();
    await appendFor(store, "user-a", "a-1", 240);
    await appendFor(store, "user-a", "a-2", 120);

    let nowMs = Date.now();
    const runtimes = new PerUserRuntimes({
      store,
      clock: { now: () => new Date(nowMs) },
      maxCacheAgeMs: 60_000,
    });

    const first = await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.replays).toBe(1);

    // Unchanged sequence, still inside the staleness bound: cached as-is.
    nowMs += 30_000;
    await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.cacheHits).toBe(1);
    expect(runtimes.stats.replays).toBe(1);

    // Past the bound with the sequence still unchanged: exactly one
    // re-projection, credited to staleReplays, with a fresh asOf.
    nowMs += 30_001;
    const second = await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.replays).toBe(2);
    expect(runtimes.stats.staleReplays).toBe(1);
    expect(Date.parse(second.asOf)).toBe(nowMs);
    // No new events were appended; only the projection moved.
    expect(second.lastServerSequence).toBe(first.lastServerSequence);
  });

  it("decays an idle stream out of BUILD once the cache ages out", async () => {
    const store = new InMemoryContextEventStore();
    await appendFor(store, "user-a", "a-1", 240);
    await appendFor(store, "user-a", "a-2", 120);
    await appendFor(store, "user-a", "a-3", 5);

    let nowMs = Date.now();
    const runtimes = new PerUserRuntimes({
      store,
      clock: { now: () => new Date(nowMs) },
    });

    const before = await runtimes.getFor("user-a").belief.current();
    expect(before.state).toBe("BUILD");

    // A viewer who never sends another event: without the staleness bound
    // this snapshot (state included) would be served forever. Advancing the
    // clock past the evidence window with zero new events must re-project
    // and report the decayed truth instead of the frozen BUILD.
    nowMs += 31 * 60 * 1_000;
    const after = await runtimes.getFor("user-a").belief.current();
    expect(after.state).toBe("UNKNOWN");
    expect(after.freshness).toBeLessThan(before.freshness);
    expect(runtimes.stats.staleReplays).toBe(1);
  });

  it("degrades an oversized stream to the most recent window and reports the truncation per user", async () => {
    const store = new InMemoryContextEventStore();
    await appendFor(store, "user-a", "a-1", 300);
    await appendFor(store, "user-a", "a-2", 240);
    await appendFor(store, "user-a", "a-3", 180);
    await appendFor(store, "user-b", "b-1", 150);
    await appendFor(store, "user-a", "a-4", 120);
    await appendFor(store, "user-a", "a-5", 5);
    await appendFor(store, null, "anon-1", 5);

    const truncations: Array<{
      userId: string | null;
      total: number;
      window: number;
      maxEvents: number;
    }> = [];
    const runtimes = new PerUserRuntimes({
      store,
      maxEvents: 3,
      onReplayTruncated: (userId, truncation) =>
        truncations.push({
          userId,
          total: truncation.total,
          window: truncation.window,
          maxEvents: truncation.maxEvents,
        }),
    });

    // user-a holds 5 events against a 3-event window: no 413, the newest
    // three (a-3, a-4, a-5 — sequences 3, 5, 6) are replayed instead.
    const snapshot = await runtimes.getFor("user-a").belief.current();
    expect(snapshot.lastServerSequence).toBe(6);
    for (const entry of snapshot.evidence) {
      expect(["a-3", "a-4", "a-5"]).toContain(entry.eventId);
    }
    expect(truncations).toEqual([
      { userId: "user-a", total: 5, window: 3, maxEvents: 3 },
    ]);

    // Streams that fit the window are not reported — including the legacy
    // null stream, whose key must survive the callback untouched.
    await runtimes.getFor("user-b").belief.current();
    await runtimes.getFor(null).belief.current();
    expect(truncations).toHaveLength(1);

    // A cache hit serves the degraded snapshot without replaying again, so
    // the truncation is reported once per replay, not once per request.
    await runtimes.getFor("user-a").belief.current();
    expect(runtimes.stats.cacheHits).toBe(1);
    expect(truncations).toHaveLength(1);
  });
});
