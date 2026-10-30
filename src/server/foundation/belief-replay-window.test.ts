import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { BeliefSnapshot } from "../belief/model.js";
import { projectBelief } from "../belief/projector.js";
import type {
  ContextEventCandidate,
  ContextEventRecord,
} from "../context/model.js";
import { SqliteContextEventStore } from "../context/sqlite-context-event-store.js";
import type { SqliteDatabasePort } from "../context/sqlite-context-event-store.js";
import { openDatabase } from "../db/index.js";
import { loadRuntimeConfig } from "./config.js";
import { createApp } from "./create-app.js";
import { buildRuntimeModules } from "./runtime-modules.js";

/**
 * Production regression (v0.6, 2026-10-21): the owner's stream outgrew the
 * belief replay bound (DEFAULT_MAX_EVENTS = 2000), so every projection threw
 * BELIEF_REPLAY_LIMIT_EXCEEDED — /api/v1/belief/current answered 413 and
 * /api/v1/bootstrap, which wraps the same projection, answered 500. The
 * dashboard was unusable for exactly the account with the most history.
 *
 * The contract now: a stream larger than the bound is replayed from its most
 * recent `maxEvents` events (by serverSequence), both routes answer 200 with
 * that windowed projection, and the degradation is logged once per replay
 * with the user key, the stream total and the window size.
 */

const STREAM_SIZE = 2_500;
const WINDOW_SIZE = 2_000;

interface LogLine {
  readonly level: number;
  readonly msg?: string;
  readonly userId?: string | null;
  readonly total?: number;
  readonly window?: number;
  readonly maxEvents?: number;
}

interface WindowedApp {
  readonly app: FastifyInstance;
  readonly appended: readonly ContextEventRecord[];
  readonly logLines: () => readonly LogLine[];
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) {
      await cleanup();
    }
  }
});

const editCandidate = (index: number, nowMs: number): ContextEventCandidate => {
  // One edit per second, the newest one second ago, all alive for 30 days.
  const occurredAt = new Date(
    nowMs - (STREAM_SIZE - index) * 1_000,
  ).toISOString();
  return {
    specversion: "1.0",
    id: `edit-${String(index).padStart(5, "0")}`,
    source: "urn:muses:replay-window",
    type: "muses.editor.activity",
    subject: "workspace:alpha",
    time: occurredAt,
    datacontenttype: "application/json",
    data: { action: index % 2 === 0 ? "edit" : "save" },
    extensions: {},
    contentHash: `hash-${index}`,
    occurredAt,
    receivedAt: occurredAt,
    expiresAt: new Date(nowMs + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    outOfOrder: false,
  };
};

/**
 * The full production module graph over a temporary SQLite file, auth
 * disabled so requests read the legacy null stream, with STREAM_SIZE events
 * written straight into the store. Writing through the ingest route would
 * re-project belief after every event (the automation seam), which is both
 * slow and beside the point: the regression is about reading a stream that
 * already outgrew the bound.
 */
const buildWindowedApp = async (): Promise<WindowedApp> => {
  const directory = mkdtempSync(join(tmpdir(), "muses-replay-window-"));
  const databasePath = join(directory, "muses.sqlite");
  const previousDatabasePath = process.env.MUSES_DATABASE_PATH;
  process.env.MUSES_DATABASE_PATH = databasePath;

  const runtime = await buildRuntimeModules({ auth: null });

  const seeded = openDatabase(databasePath, { fileMustExist: true });
  const store = new SqliteContextEventStore(
    seeded.connection as unknown as SqliteDatabasePort,
  );
  const appended: ContextEventRecord[] = [];
  const nowMs = Date.now();
  for (let index = 0; index < STREAM_SIZE; index += 1) {
    const result = await store.appendEvent(editCandidate(index, nowMs));
    appended.push(result.event);
  }
  seeded.close();

  const chunks: string[] = [];
  const app = await createApp({
    config: loadRuntimeConfig({ NODE_ENV: "test" }),
    logger: {
      level: "warn",
      stream: {
        write: (message: string) => {
          chunks.push(message);
        },
      },
    },
    modules: runtime.modules,
  });

  cleanups.push(async () => {
    await app.close();
    await runtime.close();
    if (previousDatabasePath === undefined) {
      delete process.env.MUSES_DATABASE_PATH;
    } else {
      process.env.MUSES_DATABASE_PATH = previousDatabasePath;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  return {
    app,
    appended,
    logLines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as LogLine),
  };
};

describe("belief replay window (stream larger than the replay bound)", () => {
  it(
    "answers bootstrap and belief/current with 200 and the most recent 2000 events, logging the truncation",
    { timeout: 180_000 },
    async () => {
      const { app, appended, logLines } = await buildWindowedApp();
      expect(appended).toHaveLength(STREAM_SIZE);
      const newest = appended.slice(-WINDOW_SIZE);

      const bootstrap = await app.inject({
        method: "GET",
        url: "/api/v1/bootstrap",
      });
      expect(bootstrap.statusCode).toBe(200);
      const belief = bootstrap.json<{ belief: BeliefSnapshot }>().belief;

      // The projection is exactly the replay of the most recent window...
      const expected = projectBelief(newest, belief.asOf);
      expect(belief).toEqual(expected);
      expect(belief.lastServerSequence).toBe(
        appended[STREAM_SIZE - 1]?.serverSequence,
      );
      // ...and would differ had the whole stream been replayed, so the digest
      // equality above really pins the window and not just the newest event.
      expect(belief.inputDigest).not.toBe(
        projectBelief(appended, belief.asOf, { maxEvents: STREAM_SIZE })
          .inputDigest,
      );

      const current = await app.inject({
        method: "GET",
        url: "/api/v1/belief/current",
      });
      expect(current.statusCode).toBe(200);
      const currentBelief = current.json<BeliefSnapshot>();
      // Served from the per-user cache (same asOf) it is the same windowed
      // projection; a fresh replay must still be the newest-window one.
      expect(currentBelief).toEqual(
        currentBelief.asOf === belief.asOf
          ? belief
          : projectBelief(newest, currentBelief.asOf),
      );

      // One replay happened (belief/current was served from the per-user
      // cache), so the degradation is on the record exactly once, with the
      // stream it applied to.
      const truncationLines = logLines().filter(
        (line) => line.total === STREAM_SIZE && line.window === WINDOW_SIZE,
      );
      expect(truncationLines).toHaveLength(1);
      expect(truncationLines[0]).toMatchObject({
        level: 40,
        userId: null,
        total: STREAM_SIZE,
        window: WINDOW_SIZE,
        maxEvents: WINDOW_SIZE,
      });
      expect(truncationLines[0]?.msg).toMatch(/replay/i);
    },
  );
});
