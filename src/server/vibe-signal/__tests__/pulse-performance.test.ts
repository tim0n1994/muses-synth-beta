import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ContextEventCandidate,
  ContextEventRecord,
  JsonValue,
} from "../../context/model.js";
import { SqliteContextEventStore } from "../../context/sqlite-context-event-store.js";
import type { SqliteDatabasePort } from "../../context/sqlite-context-event-store.js";
import { createPulseIngestHook, PulseRuntimes } from "../index.js";
import { projectPulse } from "../projector.js";

const AS_OF = "2026-07-30T12:00:00.000Z";
const AS_OF_MS = Date.parse(AS_OF);

const at = (offsetMs: number): string =>
  new Date(AS_OF_MS + offsetMs).toISOString();

const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

/**
 * 1000 events inside one 60s window — far denser than any realistic minute
 * (the budget asks for the 1000-event window explicitly). Mix mirrors the
 * counted event table.
 */
const denseWindowFixture = (): readonly ContextEventCandidate[] =>
  Array.from({ length: 1_000 }, (_, index) => {
    const offsetMs = -59_900 + Math.floor(index * 59.8);
    const bucket = index % 10;
    const type =
      bucket < 6
        ? "muses.editor.activity"
        : bucket < 7
          ? "muses.review.activity"
          : bucket < 8
            ? "muses.process.activity"
            : "muses.test.run.completed";
    const data: JsonValue =
      type === "muses.editor.activity"
        ? { action: index % 5 === 0 ? "save" : "edit" }
        : type === "muses.review.activity"
          ? { action: "diff-opened" }
          : type === "muses.process.activity"
            ? { status: index % 2 === 0 ? "completed" : "started" }
            : { status: index % 2 === 0 ? "passed" : "failed" };
    return {
      specversion: "1.0",
      id: `perf-${index}`,
      source: "urn:muses:pulse-perf",
      type,
      subject: "workspace:alpha",
      time: at(offsetMs),
      datacontenttype: "application/json",
      data,
      extensions: {},
      contentHash: `hash-perf-${index}`,
      occurredAt: at(offsetMs),
      receivedAt: at(offsetMs),
      expiresAt: at(600_000),
      outOfOrder: false,
    };
  });

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length),
  );
  return sorted[index] ?? 0;
};

const statsLine = (label: string, times: readonly number[]): string => {
  const sorted = [...times].sort((left, right) => left - right);
  const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
  return `${label}: n=${times.length} mean=${mean.toFixed(2)}ms p50=${percentile(sorted, 0.5).toFixed(2)}ms p95=${percentile(sorted, 0.95).toFixed(2)}ms max=${sorted.at(-1)?.toFixed(2) ?? "n/a"}ms`;
};

describe("pulse performance budget", () => {
  it(
    "keeps pure signal computation p95 under 50ms on a 1000-event window",
    { timeout: 120_000 },
    () => {
      const fixture = denseWindowFixture().map((candidate, index) => ({
        ...candidate,
        serverSequence: index + 1,
      })) as readonly ContextEventRecord[];
      // Warmup.
      for (let index = 0; index < 20; index += 1) {
        projectPulse(fixture, AS_OF);
      }
      const times: number[] = [];
      for (let index = 0; index < 200; index += 1) {
        const started = performance.now();
        const snapshot = projectPulse(fixture, AS_OF);
        times.push(performance.now() - started);
        expect(snapshot.rhythm.value).toBe("FAST");
      }
      const p95 = percentile(
        [...times].sort((left, right) => left - right),
        0.95,
      );
      console.info(
        `[PULSE_BENCH] ${statsLine("projectPulse(1000-event window)", times)}`,
      );
      expect(p95).toBeLessThan(50);
    },
  );

  it(
    "keeps the sqlite reader + projection path p95 under 50ms",
    { timeout: 240_000 },
    async () => {
      const raw = new Database(":memory:");
      openDatabases.push(raw);
      const database = raw as unknown as SqliteDatabasePort;
      const store = new SqliteContextEventStore(database);
      const runtimes = new PulseRuntimes({ database, store });

      for (const candidate of denseWindowFixture()) {
        void store.appendEvent(candidate, { userId: "perf" });
      }

      const times: number[] = [];
      for (let index = 0; index < 100; index += 1) {
        const started = performance.now();
        const snapshot = await runtimes
          .getFor("perf")
          .pulse.replay({ asOf: AS_OF });
        times.push(performance.now() - started);
        expect(snapshot.rhythm.value).toBe("FAST");
      }
      const p95 = percentile(
        [...times].sort((left, right) => left - right),
        0.95,
      );
      console.info(
        `[PULSE_BENCH] ${statsLine("reader+service.replay(1000 events)", times)}`,
      );
      expect(p95).toBeLessThan(50);
    },
  );

  it(
    "makes the signal queryable immediately after ingest (event-to-signal latency)",
    { timeout: 60_000 },
    async () => {
      const raw = new Database(":memory:");
      openDatabases.push(raw);
      const database = raw as unknown as SqliteDatabasePort;
      const store = new SqliteContextEventStore(database);
      const runtimes = new PulseRuntimes({ database, store });
      const armed: Array<() => void> = [];
      const hook = createPulseIngestHook({
        runtimes,
        refreshDelayMs: 25,
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

      // Seed some activity so the window is not empty.
      const now = Date.now();
      for (let index = 0; index < 5; index += 1) {
        const offsetMs = -50_000 + index * 8_000;
        void store.appendEvent(
          {
            specversion: "1.0",
            id: `seed-${index}`,
            source: "urn:muses:pulse-perf",
            type: "muses.editor.activity",
            subject: "workspace:alpha",
            time: new Date(now + offsetMs).toISOString(),
            datacontenttype: "application/json",
            data: { action: "edit" },
            extensions: {},
            contentHash: `hash-seed-${index}`,
            occurredAt: new Date(now + offsetMs).toISOString(),
            receivedAt: new Date(now + offsetMs).toISOString(),
            expiresAt: new Date(now + 600_000).toISOString(),
            outOfOrder: false,
          },
          { userId: "latency" },
        );
      }

      const ingestStarted = performance.now();
      void store.appendEvent(
        {
          specversion: "1.0",
          id: "fresh-edit",
          source: "urn:muses:pulse-perf",
          type: "muses.editor.activity",
          subject: "workspace:alpha",
          time: new Date(now).toISOString(),
          datacontenttype: "application/json",
          data: { action: "save" },
          extensions: {},
          contentHash: "hash-fresh-edit",
          occurredAt: new Date(now).toISOString(),
          receivedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 600_000).toISOString(),
          outOfOrder: false,
        },
        { userId: "latency" },
      );
      await hook("latency");

      // On-demand availability: the very next current() already reflects it.
      const onDemandStarted = performance.now();
      const snapshot = await runtimes.getFor("latency").pulse.current();
      const onDemandMs = performance.now() - onDemandStarted;
      expect(snapshot.rhythm.score).toBe(6);
      expect(
        snapshot.evidence.some((entry) => entry.eventId === "fresh-edit"),
      ).toBe(true);
      console.info(
        `[PULSE_BENCH] ingest->current() on-demand availability: ${onDemandMs.toFixed(2)}ms (total since ingest ${(performance.now() - ingestStarted).toFixed(2)}ms)`,
      );

      // Background debounced refresh: 25ms trailing edge in this test (5s in
      // production — both far inside the 60s event->track-change budget).
      // The timer is flushed deterministically; the measured cost is the
      // refresh itself, and the debounce delay is a config constant.
      expect(armed.length).toBe(1);
      const backgroundStarted = performance.now();
      armed[0]?.();
      // Let the fire-and-forget refresh settle before reading counters.
      await new Promise((resolve) => setImmediate(resolve));
      const backgroundMs = performance.now() - backgroundStarted;
      expect(
        runtimes.stats.replays + runtimes.stats.cacheHits,
      ).toBeGreaterThanOrEqual(2);
      const sinceIngest = performance.now() - ingestStarted;
      console.info(
        `[PULSE_BENCH] debounced background refresh cost: ${backgroundMs.toFixed(2)}ms (debounce delay 25ms here / 5000ms in production); total test-side since ingest ${sinceIngest.toFixed(2)}ms`,
      );
      expect(backgroundMs).toBeLessThan(60_000);
      expect(onDemandMs).toBeLessThan(5_000);
    },
  );
});
