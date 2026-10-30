import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type OpenDatabaseResult } from "../../db/index.js";
import { hashCloudEvent } from "../hash.js";
import type { ContextEventStore } from "../model.js";
import { ContextEventService } from "../service.js";
import {
  SqliteContextEventStore,
  type SqliteDatabasePort,
} from "../sqlite-context-event-store.js";
import { InMemoryContextEventStore } from "./support/in-memory-context-event-store.js";

const start = Date.parse("2026-10-30T00:00:00.000Z");
const event = (id: string, ttlSeconds: number) => ({
  specversion: "1.0" as const,
  id,
  source: "urn:fixture:default-retention",
  type: "fixture.event",
  data: { payload: id },
  ttlSeconds,
  extensions: {},
});
const opened: OpenDatabaseResult[] = [];
afterEach(() => {
  while (opened.length) opened.pop()?.close();
});

const factories: ReadonlyArray<readonly [string, () => ContextEventStore]> = [
  ["in-memory adapter", () => new InMemoryContextEventStore()],
  [
    "SQLite :memory:",
    () => {
      const db = openDatabase(":memory:");
      opened.push(db);
      return new SqliteContextEventStore(
        db.connection as unknown as SqliteDatabasePort,
      );
    },
  ],
];

describe.each(factories)("%s managed-only defaults", (_name, createStore) => {
  it("default service and default store delete only expired managed events, even if an obsolete false flag is supplied", async () => {
    const store = createStore();
    let now = start;
    const service = new ContextEventService(store, {
      clock: { now: () => new Date(now) },
    });
    const legacy = event("legacy", 1);
    await store.appendEvent({
      ...legacy,
      contentHash: hashCloudEvent(legacy),
      occurredAt: new Date(start).toISOString(),
      receivedAt: new Date(start).toISOString(),
      expiresAt: new Date(start + 1000).toISOString(),
      outOfOrder: false,
    });
    await service.ingest(event("managed-1", 1));
    await service.ingest(event("managed-2", 1));
    await service.ingest(event("managed-live", 60));
    now += 1000;
    expect(await service.pruneExpired(1)).toBe(1);
    expect(await store.pruneExpired(new Date(now).toISOString(), 500)).toBe(1);
    const oldCaller = store as unknown as {
      pruneExpired(
        asOf: string,
        limit: number,
        managedOnly: boolean,
      ): Promise<number>;
    };
    const obsoleteFalseResult = await oldCaller.pruneExpired(
      new Date(now).toISOString(),
      500,
      false,
    );
    expect(obsoleteFalseResult).toBe(0);
    const rows = await store.listEvents({
      afterSequence: 0,
      limit: 10,
      includeExpired: true,
      asOf: new Date(now).toISOString(),
    });
    expect(rows.map((row) => row.id)).toEqual(["legacy", "managed-live"]);
    expect(rows[0]?.data).toEqual({ payload: "legacy" });
  });
});
