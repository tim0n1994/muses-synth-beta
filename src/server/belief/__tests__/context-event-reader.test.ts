import { describe, expect, it } from "vitest";

import type { ContextEventCandidate } from "../../context/model.js";
import { InMemoryContextEventStore } from "../../context/__tests__/support/in-memory-context-event-store.js";
import { createContextBeliefEventReader } from "../context-event-reader.js";

const AS_OF = "2026-07-30T10:00:00.000Z";

const candidate = (
  id: string,
  occurredAt: string,
  expiresAt = "2026-08-30T00:00:00.000Z",
): ContextEventCandidate => ({
  specversion: "1.0",
  id,
  source: "urn:muses:test",
  type: "muses.editor.activity",
  subject: "workspace:alpha",
  time: occurredAt,
  datacontenttype: "application/json",
  data: { action: "edit" },
  extensions: {},
  contentHash: `hash-${id}`,
  occurredAt,
  receivedAt: occurredAt,
  expiresAt,
  outOfOrder: false,
});

const at = (minute: number): string =>
  `2026-07-30T09:${String(minute).padStart(2, "0")}:00.000Z`;

/**
 * Three interleaved streams so the window and the total are both proven to be
 * per-user: owner (5 live events), another user (2) and the legacy null
 * stream (1). Sequences are allocated in insertion order, 1..8.
 */
const seedStore = async (): Promise<InMemoryContextEventStore> => {
  const store = new InMemoryContextEventStore();
  await store.appendEvent(candidate("o-1", at(1)), { userId: "owner" });
  await store.appendEvent(candidate("x-1", at(2)), { userId: "other" });
  await store.appendEvent(candidate("o-2", at(3)), { userId: "owner" });
  await store.appendEvent(candidate("o-3", at(4)), { userId: "owner" });
  await store.appendEvent(candidate("n-1", at(5)), { userId: null });
  await store.appendEvent(candidate("o-4", at(6)), { userId: "owner" });
  await store.appendEvent(candidate("x-2", at(7)), { userId: "other" });
  await store.appendEvent(candidate("o-5", at(8)), { userId: "owner" });
  return store;
};

const idsBySequence = (
  events: readonly { id: string; serverSequence: number }[],
): readonly string[] =>
  [...events]
    .sort((left, right) => left.serverSequence - right.serverSequence)
    .map((event) => event.id);

describe("createContextBeliefEventReader", () => {
  it("returns the whole stream and its total when it fits the limit", async () => {
    const reader = createContextBeliefEventReader(await seedStore(), "owner");

    const window = await reader.readForBelief({ asOf: AS_OF, limit: 10 });

    expect(idsBySequence(window.events)).toEqual([
      "o-1",
      "o-2",
      "o-3",
      "o-4",
      "o-5",
    ]);
    expect(window.total).toBe(5);
  });

  it("returns only the newest `limit` events by serverSequence when the stream is larger", async () => {
    const reader = createContextBeliefEventReader(await seedStore(), "owner");

    const window = await reader.readForBelief({ asOf: AS_OF, limit: 3 });

    expect(idsBySequence(window.events)).toEqual(["o-3", "o-4", "o-5"]);
    expect(window.total).toBe(5);
  });

  it("reports the precise total when the stream is exactly the window size", async () => {
    const reader = createContextBeliefEventReader(await seedStore(), "owner");

    const window = await reader.readForBelief({ asOf: AS_OF, limit: 5 });

    expect(window.events).toHaveLength(5);
    expect(window.total).toBe(5);
  });

  it("scopes the window and the total to the legacy null stream when asked", async () => {
    const reader = createContextBeliefEventReader(await seedStore(), null);

    const window = await reader.readForBelief({ asOf: AS_OF, limit: 1 });

    expect(idsBySequence(window.events)).toEqual(["n-1"]);
    expect(window.total).toBe(1);
  });

  it("excludes expired and not-yet-occurred events from the window and the total", async () => {
    const store = await seedStore();
    // Expired before asOf: invisible to the projection, so not counted.
    await store.appendEvent(
      candidate("o-expired", at(9), "2026-07-30T09:30:00.000Z"),
      { userId: "owner" },
    );
    // Occurs after asOf: not part of a projection as of AS_OF.
    await store.appendEvent(candidate("o-future", "2026-07-30T11:00:00.000Z"), {
      userId: "owner",
    });
    const reader = createContextBeliefEventReader(store, "owner");

    const window = await reader.readForBelief({ asOf: AS_OF, limit: 2 });

    expect(idsBySequence(window.events)).toEqual(["o-4", "o-5"]);
    expect(window.total).toBe(5);
  });
});
