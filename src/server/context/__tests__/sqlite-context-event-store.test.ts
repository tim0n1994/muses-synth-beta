import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type OpenDatabaseResult } from "../../db/index.js";
import { SqliteContextEventStore } from "../sqlite-context-event-store.js";
import type { SqliteDatabasePort } from "../sqlite-context-event-store.js";
import type { ContextEventCandidate, EventStoreListQuery } from "../model.js";

function candidate(opts: {
  source: string;
  id: string;
  type: string;
  subject?: string;
  occurredAt: string;
  expiresAt: string;
}): ContextEventCandidate {
  return {
    specversion: "1.0",
    id: opts.id,
    source: opts.source,
    type: opts.type,
    ...(opts.subject === undefined ? {} : { subject: opts.subject }),
    time: opts.occurredAt,
    datacontenttype: "application/json",
    data: { note: opts.id },
    extensions: {},
    contentHash: `hash_${opts.id}`,
    occurredAt: opts.occurredAt,
    receivedAt: opts.occurredAt,
    expiresAt: opts.expiresAt,
    outOfOrder: false,
  };
}

const listQuery = (
  overrides: Partial<EventStoreListQuery>,
): EventStoreListQuery => ({
  afterSequence: 0,
  limit: 100,
  includeExpired: false,
  asOf: "2026-07-30T10:00:00.000Z",
  ...overrides,
});

describe("SqliteContextEventStore", () => {
  let directory: string;
  let opened: OpenDatabaseResult;
  let store: SqliteContextEventStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "muses-context-"));
    opened = openDatabase(join(directory, "muses.sqlite"));
    store = new SqliteContextEventStore(
      opened.connection as unknown as SqliteDatabasePort,
    );
  });

  afterEach(async () => {
    opened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("allocates strictly increasing sequences and persists across reopen", async () => {
    const a = await store.appendEvent(
      candidate({
        source: "s",
        id: "a",
        type: "t",
        occurredAt: "2026-07-30T09:00:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    const b = await store.appendEvent(
      candidate({
        source: "s",
        id: "b",
        type: "t",
        occurredAt: "2026-07-30T09:05:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(false);
    expect(b.event.serverSequence).toBeGreaterThan(a.event.serverSequence);

    const reopened = openDatabase(opened.filename, { fileMustExist: true });
    const reopenedStore = new SqliteContextEventStore(
      reopened.connection as unknown as SqliteDatabasePort,
    );
    const events = await reopenedStore.listEvents(listQuery({}));
    reopened.close();
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("deduplicates on (source, id) and returns the stored row", async () => {
    const first = await store.appendEvent(
      candidate({
        source: "s",
        id: "dup",
        type: "t",
        occurredAt: "2026-07-30T09:00:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    const second = await store.appendEvent(
      candidate({
        source: "s",
        id: "dup",
        type: "t",
        occurredAt: "2026-07-30T09:30:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    expect(second.duplicate).toBe(true);
    expect(second.event.serverSequence).toBe(first.event.serverSequence);
    expect(second.event.occurredAt).toBe("2026-07-30T09:00:00.000Z");
  });

  it("respects source, type, subject and expiry filters when listing", async () => {
    // Long-lived events survive the default listing at asOf=10:00.
    await store.appendEvent(
      candidate({
        source: "s1",
        id: "a",
        type: "build",
        subject: "proj",
        occurredAt: "2026-07-30T09:00:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    await store.appendEvent(
      candidate({
        source: "s2",
        id: "b",
        type: "build",
        occurredAt: "2026-07-30T09:00:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    // Short-lived event used only for the expiry assertions.
    await store.appendEvent(
      candidate({
        source: "s1",
        id: "c",
        type: "build",
        subject: "proj",
        occurredAt: "2026-07-30T09:00:00.000Z",
        expiresAt: "2026-07-30T09:30:00.000Z",
      }),
    );

    // Before c's expiry (09:30), both s1 events are alive.
    const bySource = await store.listEvents(
      listQuery({ source: "s1", asOf: "2026-07-30T09:15:00.000Z" }),
    );
    expect(bySource.map((e) => e.id)).toEqual(["a", "c"]);

    const withoutSubject = await store.listEvents(
      listQuery({ source: "s2", asOf: "2026-07-30T09:15:00.000Z" }),
    );
    expect(withoutSubject.map((e) => e.id)).toEqual(["b"]);

    // At asOf=09:45, "c" has expired (09:30) and is hidden unless includeExpired.
    const expiredHidden = await store.listEvents(
      listQuery({
        source: "s1",
        subject: "proj",
        asOf: "2026-07-30T09:45:00.000Z",
      }),
    );
    expect(expiredHidden.map((e) => e.id)).toEqual(["a"]);

    const expiredShown = await store.listEvents(
      listQuery({
        source: "s1",
        subject: "proj",
        asOf: "2026-07-30T09:45:00.000Z",
        includeExpired: true,
      }),
    );
    expect(expiredShown.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("lists the newest rows first when order is desc, within the same filters", async () => {
    const live = (id: string, userId: string | null) =>
      store.appendEvent(
        candidate({
          source: "s",
          id,
          type: "t",
          occurredAt: "2026-07-30T09:00:00.000Z",
          expiresAt: "2026-07-30T20:00:00.000Z",
        }),
        { userId },
      );
    // Sequences 1..5 in insertion order, two interleaved streams.
    await live("a1", null);
    await live("u1", "u");
    await live("a2", null);
    await live("u2", "u");
    await live("u3", "u");
    // The newest row of all, but already expired at asOf=10:00: a desc
    // window must skip it exactly like the asc listing does.
    await store.appendEvent(
      candidate({
        source: "s",
        id: "u-expired",
        type: "t",
        occurredAt: "2026-07-30T09:30:00.000Z",
        expiresAt: "2026-07-30T09:45:00.000Z",
      }),
      { userId: "u" },
    );

    // Default order is unchanged: the oldest rows, ascending.
    const ascending = await store.listEvents(listQuery({ limit: 2 }));
    expect(ascending.map((e) => e.id)).toEqual(["a1", "u1"]);

    // Descending: the most recent `limit` rows of the stream, newest first.
    const newest = await store.listEvents(
      listQuery({ limit: 2, order: "desc" }),
    );
    expect(newest.map((e) => e.id)).toEqual(["u3", "u2"]);

    const newestForUser = await store.listEvents(
      listQuery({ limit: 2, order: "desc", userId: "u" }),
    );
    expect(newestForUser.map((e) => e.id)).toEqual(["u3", "u2"]);

    const wholeUserStream = await store.listEvents(
      listQuery({ limit: 10, order: "desc", userId: "u" }),
    );
    expect(wholeUserStream.map((e) => e.id)).toEqual(["u3", "u2", "u1"]);

    const newestLegacy = await store.listEvents(
      listQuery({ limit: 2, order: "desc", userId: null }),
    );
    expect(newestLegacy.map((e) => e.id)).toEqual(["a2", "a1"]);
  });

  it("counts windowed, unexpired events grouped by type and source", async () => {
    // Two build events from s1 (one exactly at `since` — excluded by the
    // half-open bound), one build from s2 exactly at `until` (included), one
    // short-lived event that has expired by `until`, one event after `until`.
    await store.appendEvent(
      candidate({
        source: "s1",
        id: "at-since",
        type: "build",
        occurredAt: "2026-07-30T09:00:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    await store.appendEvent(
      candidate({
        source: "s1",
        id: "a",
        type: "build",
        occurredAt: "2026-07-30T09:05:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    await store.appendEvent(
      candidate({
        source: "s1",
        id: "b",
        type: "build",
        occurredAt: "2026-07-30T09:10:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    await store.appendEvent(
      candidate({
        source: "s2",
        id: "at-until",
        type: "build",
        occurredAt: "2026-07-30T10:00:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    await store.appendEvent(
      candidate({
        source: "s1",
        id: "expired",
        type: "build",
        occurredAt: "2026-07-30T09:20:00.000Z",
        expiresAt: "2026-07-30T09:30:00.000Z",
      }),
    );
    await store.appendEvent(
      candidate({
        source: "s1",
        id: "future",
        type: "build",
        occurredAt: "2026-07-30T10:30:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );

    const counts = await store.countEvents({
      since: "2026-07-30T09:00:00.000Z",
      until: "2026-07-30T10:00:00.000Z",
    });

    expect(counts.total).toBe(3);
    expect(counts.groups).toEqual([
      { type: "build", source: "s1", count: 2 },
      { type: "build", source: "s2", count: 1 },
    ]);
  });

  it("caps the group list at 50 while reporting the precise total", async () => {
    for (let index = 0; index < 51; index += 1) {
      await store.appendEvent(
        candidate({
          source: `source-${String(index).padStart(2, "0")}`,
          id: "only",
          type: "build",
          occurredAt: "2026-07-30T09:00:00.000Z",
          expiresAt: "2026-07-30T20:00:00.000Z",
        }),
      );
    }

    const counts = await store.countEvents({
      since: "2026-07-30T08:00:00.000Z",
      until: "2026-07-30T10:00:00.000Z",
    });

    expect(counts.total).toBe(51);
    expect(counts.groups).toHaveLength(50);
  });

  it("reports the ordering watermark per source+subject", async () => {
    await store.appendEvent(
      candidate({
        source: "s",
        id: "a",
        type: "t",
        subject: "p",
        occurredAt: "2026-07-30T09:00:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    await store.appendEvent(
      candidate({
        source: "s",
        id: "b",
        type: "t",
        subject: "p",
        occurredAt: "2026-07-30T09:30:00.000Z",
        expiresAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    const watermark = await store.getOrderingWatermark({
      source: "s",
      subject: "p",
    });
    expect(watermark).toBe("2026-07-30T09:30:00.000Z");
  });

  it("prunes expired rows in bounded batches", async () => {
    for (const id of ["a", "b", "c"]) {
      await store.appendEvent(
        candidate({
          source: "s",
          id,
          type: "t",
          occurredAt: "2026-07-30T09:00:00.000Z",
          expiresAt: "2026-07-30T09:20:00.000Z",
        }),
        { retentionManaged: true },
      );
    }
    const pruned = await store.pruneExpired("2026-07-30T10:00:00.000Z", 10);
    expect(pruned).toBe(3);
    const remaining = await store.listEvents(
      listQuery({ includeExpired: true }),
    );
    expect(remaining).toHaveLength(0);
  });
});
