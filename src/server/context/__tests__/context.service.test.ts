import { describe, expect, it } from "vitest";
import type { CloudEventInput, ContextClock } from "../model.js";
import { ContextEventService } from "../service.js";
import { InMemoryContextEventStore } from "./support/in-memory-context-event-store.js";

class MutableClock implements ContextClock {
  public constructor(private current: Date) {}

  public now(): Date {
    return new Date(this.current.getTime());
  }

  public set(iso: string): void {
    this.current = new Date(iso);
  }
}

const event = (
  id: string,
  time: string,
  data: Readonly<Record<string, string>> = { action: "edit" },
  ttlSeconds?: number,
): CloudEventInput => ({
  specversion: "1.0",
  id,
  source: "urn:muses:test:editor",
  type: "muses.editor.activity",
  subject: "workspace:alpha",
  time,
  datacontenttype: "application/json",
  data,
  ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
  extensions: ttlSeconds === undefined ? {} : { ttlseconds: ttlSeconds },
});

describe("ContextEventService", () => {
  it("is idempotent without allocating a second server sequence", async () => {
    const store = new InMemoryContextEventStore();
    const clock = new MutableClock(new Date("2026-07-30T00:00:00.000Z"));
    const service = new ContextEventService(store, {
      clock,
      allowedLatenessMs: 0,
    });

    const first = await service.ingest(
      event("evt-1", "2026-07-30T00:00:00.000Z"),
    );
    const duplicate = await service.ingest(
      event("evt-1", "2026-07-30T00:00:00.000Z"),
    );

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.event.serverSequence).toBe(first.event.serverSequence);
  });

  it("fails safely when an idempotency key is reused for different content", async () => {
    const store = new InMemoryContextEventStore();
    const clock = new MutableClock(new Date("2026-07-30T00:00:00.000Z"));
    const service = new ContextEventService(store, { clock });
    await service.ingest(event("evt-1", "2026-07-30T00:00:00.000Z"));

    await expect(
      service.ingest(
        event("evt-1", "2026-07-30T00:00:00.000Z", { action: "save" }),
      ),
    ).rejects.toMatchObject({
      code: "CONTEXT_IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
  });

  it("assigns monotonic sequence numbers and marks late out-of-order events", async () => {
    const store = new InMemoryContextEventStore();
    const clock = new MutableClock(new Date("2026-07-30T00:10:00.000Z"));
    const service = new ContextEventService(store, {
      clock,
      allowedLatenessMs: 0,
    });

    const newer = await service.ingest(
      event("evt-new", "2026-07-30T00:09:00.000Z"),
    );
    const older = await service.ingest(
      event("evt-old", "2026-07-30T00:02:00.000Z"),
    );

    expect(newer.event.serverSequence).toBe(1);
    expect(older.event.serverSequence).toBe(2);
    expect(older.event.outOfOrder).toBe(true);
  });

  it("uses an opaque cursor for stable server-sequence pagination", async () => {
    const store = new InMemoryContextEventStore();
    const clock = new MutableClock(new Date("2026-07-30T00:10:00.000Z"));
    const service = new ContextEventService(store, { clock });
    await service.ingest(event("evt-1", "2026-07-30T00:01:00.000Z"));
    await service.ingest(event("evt-2", "2026-07-30T00:02:00.000Z"));

    const firstPage = await service.list({ limit: 1 });
    expect(firstPage.nextCursor).toBeTypeOf("string");
    const cursor = firstPage.nextCursor;
    if (cursor === undefined) {
      throw new Error("Expected next cursor");
    }
    const secondPage = await service.list({ limit: 1, cursor });

    expect(firstPage.items.map((item) => item.id)).toEqual(["evt-1"]);
    expect(secondPage.items.map((item) => item.id)).toEqual(["evt-2"]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("excludes expired events by default and can prune them in bounded batches", async () => {
    const store = new InMemoryContextEventStore();
    const clock = new MutableClock(new Date("2026-07-30T00:00:00.000Z"));
    const service = new ContextEventService(store, {
      clock,
      defaultTtlSeconds: 60,
      maxTtlSeconds: 600,
    });
    await service.ingest(
      event("evt-expiring", "2026-07-30T00:00:00.000Z", { action: "edit" }, 60),
    );

    clock.set("2026-07-30T00:02:00.000Z");
    expect((await service.list()).items).toHaveLength(0);
    expect((await service.list({ includeExpired: true })).items).toHaveLength(
      1,
    );
    expect(await service.pruneExpired(1)).toBe(1);
    expect((await service.list({ includeExpired: true })).items).toHaveLength(
      0,
    );
  });

  it("counts a bounded, non-expired window grouped by type and source", async () => {
    const store = new InMemoryContextEventStore();
    const clock = new MutableClock(new Date("2026-07-30T00:00:00.000Z"));
    const service = new ContextEventService(store, { clock });
    // Two events inside the window, one that expires before the window ends
    // (ingested at 00:00 with a 60s ttl, window ends at 00:10), and one that
    // only becomes visible after the window ends.
    await service.ingest(event("in-1", "2026-07-29T23:50:00.000Z"));
    await service.ingest(event("in-2", "2026-07-29T23:55:00.000Z"));
    await service.ingest(
      event("short-lived", "2026-07-29T23:58:00.000Z", { action: "edit" }, 60),
    );
    // Advance the clock past the window end so the last event passes the
    // future-skew guard while the earlier ingests keep their stored expiry.
    clock.set("2026-07-30T00:25:00.000Z");
    await service.ingest(event("after-window", "2026-07-30T00:20:00.000Z"));

    const counts = await service.counts(
      "2026-07-29T23:45:00.000Z",
      "2026-07-30T00:10:00.000Z",
    );

    expect(counts.total).toBe(2);
    expect(counts.groups).toEqual([
      {
        type: "muses.editor.activity",
        source: "urn:muses:test:editor",
        count: 2,
      },
    ]);
  });

  it("rejects unparseable or inverted counts windows", async () => {
    const service = new ContextEventService(new InMemoryContextEventStore());

    await expect(
      service.counts("not-a-timestamp", "2026-07-30T00:00:00.000Z"),
    ).rejects.toMatchObject({ code: "CONTEXT_INVALID_EVENT" });
    await expect(
      service.counts("2026-07-30T01:00:00.000Z", "2026-07-30T00:00:00.000Z"),
    ).rejects.toMatchObject({ code: "CONTEXT_INVALID_EVENT" });
  });
});
