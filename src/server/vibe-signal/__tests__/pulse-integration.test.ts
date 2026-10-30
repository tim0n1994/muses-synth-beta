import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import type {
  ContextEventCandidate,
  ContextClock,
  JsonValue,
} from "../../context/model.js";
import { ContextEventService } from "../../context/service.js";
import { SqliteContextEventStore } from "../../context/sqlite-context-event-store.js";
import type { SqliteDatabasePort } from "../../context/sqlite-context-event-store.js";
import { contextRoutes } from "../../context/routes.js";
import { migration005PulseReadings } from "../../db/migrations/005_pulse_readings.js";
import {
  createPulseIngestHook,
  createSqlitePulseEventReader,
  PulseRuntimes,
  SqlitePulseReadingsStore,
} from "../index.js";
import { createVibeSignalModule, isVibeSignalEnabled } from "../module.js";
import { projectPulse } from "../projector.js";
import type { PulseSnapshot } from "../model.js";

const AS_OF = "2026-07-30T12:00:00.000Z";
const AS_OF_MS = Date.parse(AS_OF);

const at = (offsetSeconds: number): string =>
  new Date(AS_OF_MS + offsetSeconds * 1_000).toISOString();

interface Harness {
  readonly database: SqliteDatabasePort;
  readonly raw: Database.Database;
  readonly store: SqliteContextEventStore;
  readonly contextService: ContextEventService;
  readonly clock: { now(): Date };
  setNow(offsetSeconds: number): void;
}

const harnesses: Harness[] = [];
const openDatabases: Database.Database[] = [];
const applications: FastifyInstance[] = [];

afterEach(() => {
  for (const application of applications.splice(0)) {
    void application.close();
  }
  harnesses.splice(0);
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

const buildHarness = (startOffsetSeconds = 0): Harness => {
  const raw = new Database(":memory:");
  openDatabases.push(raw);
  const database = raw as unknown as SqliteDatabasePort;
  const store = new SqliteContextEventStore(database);
  let nowMs = AS_OF_MS + startOffsetSeconds * 1_000;
  const clock: ContextClock = { now: () => new Date(nowMs) };
  const contextService = new ContextEventService(store, { clock });
  const harness: Harness = {
    database,
    raw,
    store,
    contextService,
    clock,
    setNow(offsetSeconds: number) {
      nowMs = AS_OF_MS + offsetSeconds * 1_000;
    },
  };
  harnesses.push(harness);
  return harness;
};

const cloudEvent = (
  id: string,
  type: string,
  offsetSeconds: number,
  data: JsonValue,
): Parameters<ContextEventService["ingest"]>[0] => ({
  specversion: "1.0",
  id,
  source: "urn:muses:pulse-test",
  type,
  subject: "workspace:alpha",
  time: at(offsetSeconds),
  datacontenttype: "application/json",
  data,
  extensions: {},
});

const ingestEdit = async (
  harness: Harness,
  userId: string | null,
  id: string,
  offsetSeconds: number,
): Promise<void> => {
  const result = await harness.contextService.ingest(
    cloudEvent(id, "muses.editor.activity", offsetSeconds, { action: "edit" }),
    { userId },
  );
  if (result.duplicate) {
    throw new Error(`unexpected duplicate on ingest ${id}`);
  }
};

const candidate = (
  id: string,
  type: string,
  offsetSeconds: number,
  data: JsonValue,
  expiresOffsetSeconds: number,
): ContextEventCandidate => ({
  specversion: "1.0",
  id,
  source: "urn:muses:pulse-test",
  type,
  subject: "workspace:alpha",
  time: at(offsetSeconds),
  datacontenttype: "application/json",
  data,
  extensions: {},
  contentHash: `hash-${id}`,
  occurredAt: at(offsetSeconds),
  receivedAt: at(offsetSeconds),
  expiresAt: at(expiresOffsetSeconds),
  outOfOrder: false,
});

describe("sqlite pulse reader", () => {
  it("returns only the trailing 60s window, newest-first then reversed to ascending", async () => {
    const harness = buildHarness();
    // 20 old events (10 minutes ago) then 5 fresh ones.
    for (let index = 0; index < 20; index += 1) {
      await ingestEdit(harness, null, `old-${index}`, -600 + index);
    }
    for (let index = 0; index < 5; index += 1) {
      await ingestEdit(harness, null, `new-${index}`, -50 + index * 5);
    }

    const reader = createSqlitePulseEventReader(harness.database, null);
    const events = await reader.readRecentForPulse({
      asOf: AS_OF,
      limit: 100,
    });

    expect(events.length).toBe(5);
    expect(events[0]?.id).toBe("new-0");
    expect(events[4]?.id).toBe("new-4");
    const times = events.map((event) => Date.parse(event.occurredAt));
    expect(times).toEqual([...times].sort((left, right) => left - right));
  });

  it("excludes expired and future events, and enforces the limit", async () => {
    const harness = buildHarness();
    await harness.store.appendEvent(
      candidate(
        "expired-1",
        "muses.editor.activity",
        -30,
        { action: "edit" },
        -10,
      ),
      { userId: "a" },
    );
    await harness.store.appendEvent(
      candidate(
        "future-1",
        "muses.editor.activity",
        30,
        { action: "edit" },
        300,
      ),
      { userId: "a" },
    );
    await harness.store.appendEvent(
      candidate(
        "live-1",
        "muses.editor.activity",
        -20,
        { action: "edit" },
        300,
      ),
      { userId: "a" },
    );

    const reader = createSqlitePulseEventReader(harness.database, "a");
    const events = await reader.readRecentForPulse({ asOf: AS_OF, limit: 100 });
    expect(events.map((event) => event.id)).toEqual(["live-1"]);

    const limited = await reader.readRecentForPulse({ asOf: AS_OF, limit: 1 });
    expect(limited.length).toBe(1);
  });

  it("scopes by the three-state userId convention", async () => {
    const harness = buildHarness();
    await ingestEdit(harness, "alice", "alice-1", -30);
    await ingestEdit(harness, "bob", "bob-1", -30);
    await ingestEdit(harness, null, "legacy-1", -30);

    const forAlice = await createSqlitePulseEventReader(
      harness.database,
      "alice",
    ).readRecentForPulse({ asOf: AS_OF, limit: 100 });
    const forBob = await createSqlitePulseEventReader(
      harness.database,
      "bob",
    ).readRecentForPulse({ asOf: AS_OF, limit: 100 });
    const forLegacy = await createSqlitePulseEventReader(
      harness.database,
      null,
    ).readRecentForPulse({ asOf: AS_OF, limit: 100 });
    const unscoped = await createSqlitePulseEventReader(
      harness.database,
      undefined,
    ).readRecentForPulse({ asOf: AS_OF, limit: 100 });

    expect(forAlice.map((event) => event.id)).toEqual(["alice-1"]);
    expect(forBob.map((event) => event.id)).toEqual(["bob-1"]);
    expect(forLegacy.map((event) => event.id)).toEqual(["legacy-1"]);
    expect(unscoped.length).toBe(3);
  });
});

describe("PulseRuntimes per-user cache (D1/D2/D3)", () => {
  it("re-projects after ingest (D1) and serves cache hits until the staleness bound (D2)", async () => {
    const harness = buildHarness();
    const runtimes = new PulseRuntimes({
      database: harness.database,
      store: harness.store,
      clock: harness.clock,
    });

    for (let index = 0; index < 3; index += 1) {
      await ingestEdit(harness, "alice", `alice-${index}`, -50 + index * 15);
    }

    const first = await runtimes.getFor("alice").pulse.current();
    expect(runtimes.stats.replays).toBe(1);
    expect(first.rhythm.score).toBe(3);
    expect(first.lastServerSequence).toBe(3);

    // No new events, cache still young: served from cache.
    await runtimes.getFor("alice").pulse.current();
    expect(runtimes.stats.cacheHits).toBe(1);
    expect(runtimes.stats.replays).toBe(1);

    // A fresh event lands: invalidate + replay includes it in the window.
    await ingestEdit(harness, "alice", "alice-3", -5);
    runtimes.invalidate("alice");
    const second = await runtimes.getFor("alice").pulse.current();
    expect(runtimes.stats.replays).toBe(2);
    expect(second.rhythm.score).toBe(4);
    expect(second.evidence.some((entry) => entry.eventId === "alice-3")).toBe(
      true,
    );

    // Sequence unchanged but cache older than 60s: honest re-projection.
    harness.setNow(61);
    await runtimes.getFor("alice").pulse.current();
    expect(runtimes.stats.staleReplays).toBe(1);
    expect(runtimes.stats.replays).toBe(3);
  });

  it("keeps every user's evidence inside that user's stream (D3)", async () => {
    const harness = buildHarness();
    const runtimes = new PulseRuntimes({
      database: harness.database,
      store: harness.store,
      clock: harness.clock,
    });

    for (let index = 0; index < 4; index += 1) {
      await ingestEdit(harness, "alice", `alice-${index}`, -55 + index * 10);
    }
    await ingestEdit(harness, "bob", "bob-0", -30);
    const bobTest = await harness.contextService.ingest(
      cloudEvent("bob-test", "muses.test.run.completed", -20, {
        status: "passed",
      }),
      { userId: "bob" },
    );
    expect(bobTest.duplicate).toBe(false);
    await ingestEdit(harness, null, "legacy-0", -40);

    const alice = await runtimes.getFor("alice").pulse.current();
    const bob = await runtimes.getFor("bob").pulse.current();
    const legacy = await runtimes.getFor(null).pulse.current();

    const eventIds = (snapshot: PulseSnapshot) =>
      new Set(snapshot.evidence.map((entry) => entry.eventId));
    const aliceIds = eventIds(alice);
    for (const id of aliceIds) {
      expect(id.startsWith("alice-")).toBe(true);
    }
    expect(aliceIds.size).toBe(4);

    const bobIds = eventIds(bob);
    expect(bobIds.has("bob-0")).toBe(true);
    expect(bobIds.has("bob-test")).toBe(true);
    expect([...bobIds].every((id) => id.startsWith("bob-"))).toBe(true);
    expect(bob.emotion.tone).toBe("POSITIVE");

    expect(eventIds(legacy)).toEqual(new Set(["legacy-0"]));
  });
});

describe("ingest hook with 5s trailing-edge debounce (D1/D5)", () => {
  it("debounces a burst of ingests into one background refresh containing the newest event", async () => {
    const harness = buildHarness();
    const runtimes = new PulseRuntimes({
      database: harness.database,
      store: harness.store,
      clock: harness.clock,
    });
    // Trailing-edge debounce armed-timer bookkeeping: each new schedule
    // cancels the previously armed callback, so only the latest survives.
    const armed: Array<() => void> = [];
    const hook = createPulseIngestHook({
      runtimes,
      refreshDelayMs: 5_000,
      schedule: (callback) => {
        armed.push(callback);
        return () => {
          const index = armed.indexOf(callback);
          if (index >= 0) {
            armed.splice(index, 1);
          }
        };
      },
    });

    for (let index = 0; index < 5; index += 1) {
      await ingestEdit(harness, "alice", `alice-${index}`, -55 + index * 8);
      await hook("alice");
    }

    // Trailing edge: only one refresh stays armed for the whole burst.
    expect(armed.length).toBe(1);
    await ingestEdit(harness, "alice", "alice-5", -3);
    await hook("alice");
    expect(armed.length).toBe(1);

    armed[0]?.();
    // The refresh is fire-and-forget; let the promise settle before
    // asserting on the counters.
    await new Promise((resolve) => setImmediate(resolve));
    expect(runtimes.stats.replays).toBe(1);
    const snapshot = await runtimes.getFor("alice").pulse.current();
    expect(runtimes.stats.cacheHits).toBe(1);
    expect(snapshot.rhythm.score).toBe(6);
    expect(snapshot.lastServerSequence).toBe(6);
  });

  it("swallows refresh failures so ingest is never rejected (D5)", async () => {
    const broken = {
      getFor: () => ({
        pulse: {
          current: async () => {
            throw new Error("pulse projection exploded");
          },
          replay: async () => {
            throw new Error("pulse projection exploded");
          },
        },
      }),
      invalidate: () => undefined,
      stats: { replays: 0, cacheHits: 0, staleReplays: 0 },
    };
    const armed: Array<() => void> = [];
    const hook = createPulseIngestHook({
      runtimes: broken,
      refreshDelayMs: 5,
      schedule: (callback) => {
        armed.push(callback);
        return () => undefined;
      },
    });

    await expect(hook("alice")).resolves.toBeUndefined();
    expect(() => armed[0]?.()).not.toThrow();
  });

  it("keeps POST /api/v1/context/events at 202 even when the hook throws (D5)", async () => {
    const harness = buildHarness();
    const application = Fastify({ logger: false });
    applications.push(application);
    await application.register(contextRoutes, {
      service: harness.contextService,
      onIngested: async () => {
        throw new Error("pulse path exploded");
      },
    });

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/context/events",
      // Wire-format CloudEvent: extension attributes are top-level keys,
      // there is no "extensions" object on the HTTP body.
      payload: {
        specversion: "1.0",
        id: "edit-x",
        source: "urn:muses:pulse-test",
        type: "muses.editor.activity",
        subject: "workspace:alpha",
        time: at(-30),
        datacontenttype: "application/json",
        data: { action: "edit" },
      },
    });

    // v0.6 answers 202 for a fresh ingest; hook failures are swallowed by
    // the route itself (runtime-modules.ts void-error pattern).
    expect(response.statusCode).toBe(202);
  });
});

describe("MUSES_V07 feature switch (D4)", () => {
  it("interprets the flag conservatively", () => {
    expect(isVibeSignalEnabled({})).toBe(false);
    expect(isVibeSignalEnabled({ MUSES_V07: undefined })).toBe(false);
    expect(isVibeSignalEnabled({ MUSES_V07: "0" })).toBe(false);
    expect(isVibeSignalEnabled({ MUSES_V07: "1" })).toBe(true);
    expect(isVibeSignalEnabled({ MUSES_V07: "true" })).toBe(true);
    expect(isVibeSignalEnabled({ MUSES_V07: "TRUE" })).toBe(true);
  });

  it("registers nothing when the switch is off: pulse routes 404", async () => {
    const harness = buildHarness();
    const module = createVibeSignalModule({
      database: harness.database,
      store: harness.store,
      enabled: isVibeSignalEnabled({}),
      clock: harness.clock,
    });
    expect(module).toBeNull();

    // The integrator wiring: only push a module when createVibeSignalModule
    // returns one, so flag-off means zero registration (v07-design.md V11).
    const application = Fastify({ logger: false });
    applications.push(application);
    if (module !== null) {
      await application.register(module.routes);
    }

    const current = await application.inject({
      method: "GET",
      url: "/api/v1/belief/pulse/current",
    });
    const replay = await application.inject({
      method: "POST",
      url: "/api/v1/belief/pulse/replay",
      payload: { asOf: AS_OF },
    });
    expect(current.statusCode).toBe(404);
    expect(replay.statusCode).toBe(404);
  });

  it("serves pulse routes when the switch is on", async () => {
    const harness = buildHarness();
    // No auth in this app, so requests read the legacy global (null) stream.
    for (let index = 0; index < 3; index += 1) {
      await ingestEdit(harness, null, `alice-${index}`, -40 + index * 10);
    }
    const module = createVibeSignalModule({
      database: harness.database,
      store: harness.store,
      enabled: true,
      clock: harness.clock,
    });
    expect(module).not.toBeNull();
    if (module === null) {
      return;
    }

    const application = Fastify({ logger: false });
    applications.push(application);
    await application.register(module.routes);

    const response = await application.inject({
      method: "GET",
      url: "/api/v1/belief/pulse/current",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<PulseSnapshot>();
    expect(body.rhythm.value).toBe("SLOW");
  });
});

describe("migration 005: pulse_readings", () => {
  it("is a valid, idempotent, additive migration definition", () => {
    expect(migration005PulseReadings.version).toBe(5);
    expect(migration005PulseReadings.name).toBe("pulse_readings");
    expect(migration005PulseReadings.sql.trim().length).toBeGreaterThan(0);
    expect(migration005PulseReadings.prepare).toBeUndefined();

    const harness = buildHarness();
    harness.database.exec(migration005PulseReadings.sql);
    harness.database.exec(migration005PulseReadings.sql);

    const row = harness.raw
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'pulse_readings'",
      )
      .get() as { count: number };
    expect(row.count).toBe(1);
  });

  it("round-trips a snapshot through SqlitePulseReadingsStore", async () => {
    const harness = buildHarness();
    await ingestEdit(harness, "alice", "alice-0", -30);
    const reader = createSqlitePulseEventReader(harness.database, "alice");
    const events = await reader.readRecentForPulse({ asOf: AS_OF, limit: 100 });
    const snapshot = projectPulse(events, AS_OF);

    const store = new SqlitePulseReadingsStore(harness.database, {
      userId: "alice",
      clock: harness.clock,
    });
    await store.savePulseSnapshot(snapshot);

    const row = harness.raw
      .prepare(
        "SELECT user_id, as_of, rhythm_value, rhythm_score, emotion_valence, input_digest, snapshot_json FROM pulse_readings",
      )
      .get() as {
      user_id: string;
      as_of: string;
      rhythm_value: string;
      rhythm_score: number;
      emotion_valence: number;
      input_digest: string;
      snapshot_json: string;
    };
    expect(row.user_id).toBe("alice");
    expect(row.as_of).toBe(AS_OF);
    expect(row.rhythm_value).toBe(snapshot.rhythm.value);
    expect(row.rhythm_score).toBe(snapshot.rhythm.score);
    expect(row.emotion_valence).toBe(snapshot.emotion.value as number);
    expect(row.input_digest).toBe(snapshot.inputDigest);
    expect(JSON.parse(row.snapshot_json)).toEqual(snapshot);
  });

  it("persists readings through the service when persistReadings is on", async () => {
    const harness = buildHarness();
    for (let index = 0; index < 2; index += 1) {
      await ingestEdit(harness, "alice", `alice-${index}`, -40 + index * 20);
    }
    const module = createVibeSignalModule({
      database: harness.database,
      store: harness.store,
      enabled: true,
      persistReadings: true,
      clock: harness.clock,
    });
    expect(module).not.toBeNull();
    if (module === null) {
      return;
    }

    await module.runtimes.getFor("alice").pulse.current();

    const count = harness.raw
      .prepare("SELECT COUNT(*) AS count FROM pulse_readings")
      .get() as { count: number };
    expect(count.count).toBe(1);
  });
});
