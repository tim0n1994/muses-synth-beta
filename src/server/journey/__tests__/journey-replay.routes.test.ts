import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  authedHeaders,
  buildJourneyApp,
  ingestEvents,
  registerUser,
  type JourneyAppOptions,
  type JourneyTestApp,
} from "./journey-app-fixture.js";
import {
  buildJourneyModule,
  JOURNEY_MODULE_NAME,
  type SqliteDatabasePort,
} from "../index.js";
import { openDatabase } from "../../db/index.js";
import { SqliteContextEventStore } from "../../context/sqlite-context-event-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Route contract (batch 2, behind MUSES_V07 && MUSES_V07_REPLAY — the
 * batch-2 kill switch: any journey/replay failure is contained by turning
 * MUSES_V07_REPLAY off, leaving batch 1 untouched).
 *
 * Frozen URL shapes and codes:
 *   GET  /api/v1/journeys                    -> 200 {items:[JourneySummary]}
 *   GET  /api/v1/journeys/:journeyId         -> 200 {journey} | 404 UNKNOWN_JOURNEY
 *   POST /api/v1/journeys/:journeyId/replay  -> 201 {replay} | 404 UNKNOWN_JOURNEY
 *   GET  /api/v1/journeys/:journeyId/replay  -> 200 {replay}
 *                                                | 404 UNKNOWN_JOURNEY
 *                                                | 404 UNKNOWN_REPLAY
 * Missing routes (either flag off) answer the foundation 404 envelope
 * {error:{code:"NOT_FOUND",...}}.
 */

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

const app = async (options?: JourneyAppOptions): Promise<JourneyTestApp> => {
  const built = await buildJourneyApp(options);
  cleanups.push(built.cleanup);
  return built;
};

const seedSession = async (instance: FastifyInstance, token: string | null) => {
  await ingestEvents(instance, token, [
    { id: "r1", type: "muses.editor.activity", secondsAgo: 6_000 },
    { id: "r2", type: "muses.editor.activity", secondsAgo: 5_000 },
    { id: "r3", type: "muses.editor.activity", secondsAgo: 4_000 },
    { id: "r4", type: "muses.editor.activity", secondsAgo: 3_900 },
  ]);
};

describe("journey routes behind the batch-2 switches", () => {
  it(
    "lists derived journeys after ingestion",
    { timeout: 30_000 },
    async () => {
      const { app: instance } = await app();
      const user = await registerUser(instance, "routes-a@example.com");
      await seedSession(instance, user.token);

      const list = await instance.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: authedHeaders(user.token),
      });
      expect(list.statusCode).toBe(200);
      const body = list.json<{ items: readonly { journeyId: string }[] }>();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0]?.journeyId).toMatch(/^jrn_[0-9a-f]{24}$/);
    },
  );

  it(
    "returns the full snapshot by id and 404 UNKNOWN_JOURNEY otherwise",
    { timeout: 30_000 },
    async () => {
      const { app: instance } = await app();
      const user = await registerUser(instance, "routes-b@example.com");
      await seedSession(instance, user.token);
      const list = await instance.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: authedHeaders(user.token),
      });
      const journeyId = list.json<{ items: readonly { journeyId: string }[] }>()
        .items[0]!.journeyId;

      const detail = await instance.inject({
        method: "GET",
        url: `/api/v1/journeys/${journeyId}`,
        headers: authedHeaders(user.token),
      });
      expect(detail.statusCode).toBe(200);
      const snapshot = detail.json<{
        journey: {
          samples: readonly unknown[];
          nodes: readonly { type: string }[];
          retentionDays: number;
        };
      }>().journey;
      expect(snapshot.samples.length).toBeGreaterThan(0);
      expect(snapshot.retentionDays).toBe(90);

      const missing = await instance.inject({
        method: "GET",
        url: "/api/v1/journeys/jrn_deadbeefdeadbeefdeadbeef",
        headers: authedHeaders(user.token),
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json<{ error: { code: string } }>().error.code).toBe(
        "UNKNOWN_JOURNEY",
      );
    },
  );

  it(
    "renders a replay, then serves it; UNKNOWN_REPLAY before rendering",
    { timeout: 30_000 },
    async () => {
      const { app: instance } = await app();
      const user = await registerUser(instance, "routes-c@example.com");
      await seedSession(instance, user.token);
      const list = await instance.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: authedHeaders(user.token),
      });
      const journeyId = list.json<{ items: readonly { journeyId: string }[] }>()
        .items[0]!.journeyId;

      const before = await instance.inject({
        method: "GET",
        url: `/api/v1/journeys/${journeyId}/replay`,
        headers: authedHeaders(user.token),
      });
      expect(before.statusCode).toBe(404);
      expect(before.json<{ error: { code: string } }>().error.code).toBe(
        "UNKNOWN_REPLAY",
      );

      const rendered = await instance.inject({
        method: "POST",
        url: `/api/v1/journeys/${journeyId}/replay`,
        headers: authedHeaders(user.token),
        payload: {},
      });
      expect(rendered.statusCode).toBe(201);
      const replay = rendered.json<{
        replay: {
          totalDurationSec: number;
          segments: readonly { durationSec: number }[];
        };
      }>().replay;
      expect(replay.segments.length).toBeGreaterThanOrEqual(1);
      for (const segment of replay.segments) {
        expect(segment.durationSec).toBeGreaterThan(0);
      }

      const fetched = await instance.inject({
        method: "GET",
        url: `/api/v1/journeys/${journeyId}/replay`,
        headers: authedHeaders(user.token),
      });
      expect(fetched.statusCode).toBe(200);
      expect(
        fetched.json<{ replay: { journeyId: string } }>().replay.journeyId,
      ).toBe(journeyId);

      const foreignJourney = await instance.inject({
        method: "POST",
        url: "/api/v1/journeys/jrn_ffffffffffffffffffffffff/replay",
        headers: authedHeaders(user.token),
        payload: {},
      });
      expect(foreignJourney.statusCode).toBe(404);
      expect(
        foreignJourney.json<{ error: { code: string } }>().error.code,
      ).toBe("UNKNOWN_JOURNEY");
    },
  );

  it(
    "serves the anonymous global stream when auth is disabled (v0.6 parity)",
    { timeout: 30_000 },
    async () => {
      const { app: instance } = await app({ auth: null });
      await seedSession(instance, null);
      const list = await instance.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: { origin: "http://127.0.0.1:3001" },
      });
      expect(list.statusCode).toBe(200);
      expect(
        list.json<{ items: readonly { journeyId: string }[] }>().items.length,
      ).toBeGreaterThanOrEqual(1);
    },
  );
});

describe("batch-2 switch: journey module zero-registration", () => {
  const moduleDeps = () => {
    const directory = mkdtempSync(join(tmpdir(), "muses-journey-gate-"));
    const opened = openDatabase(join(directory, "muses.sqlite"));
    const connection = opened.connection as unknown as SqliteDatabasePort;
    const eventStore = new SqliteContextEventStore(connection);
    return {
      deps: { database: connection, eventSource: eventStore },
      cleanup: () => {
        opened.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  };

  it("registers nothing unless both switches are on", () => {
    const { deps, cleanup } = moduleDeps();
    try {
      expect(
        buildJourneyModule({ MUSES_V07: "1", MUSES_V07_REPLAY: "0" }, deps),
      ).toBeNull();
      expect(
        buildJourneyModule({ MUSES_V07: "0", MUSES_V07_REPLAY: "1" }, deps),
      ).toBeNull();
      expect(buildJourneyModule({}, deps)).toBeNull();
      expect(
        buildJourneyModule(
          { MUSES_V07: "true", MUSES_V07_REPLAY: "true" },
          deps,
        ),
      ).not.toBeNull();
      const module = buildJourneyModule(
        { MUSES_V07: "1", MUSES_V07_REPLAY: "1" },
        deps,
      );
      expect(module?.name).toBe(JOURNEY_MODULE_NAME);
    } finally {
      cleanup();
    }
  });

  it(
    "leaves the module graph identical to v0.6 when the replay switch is off",
    { timeout: 30_000 },
    async () => {
      // Auth-disabled app: with no bearer gate in front, a 404 here can
      // only mean the route itself is absent.
      const off = await app({ auth: null, v07: "1", replay: "0" });
      // Zero registration: the assembled graph is exactly the v0.6 set
      // for an auth-disabled host (the auth-enabled twin below adds
      // "auth" last; both without JOURNEY_MODULE_NAME).
      expect(off.moduleNames).toEqual([
        "context",
        "belief",
        "effects",
        "policy",
        "settings",
        "llm",
        "bootstrap",
      ]);
      expect(off.moduleNames).not.toContain(JOURNEY_MODULE_NAME);

      // And the routes are unreachable: foundation 404 envelope, never a
      // handler that leaks existence.
      for (const url of [
        "/api/v1/journeys",
        "/api/v1/journeys/jrn_aaaaaaaaaaaaaaaaaaaaaaaa",
        "/api/v1/journeys/jrn_a/replay",
      ]) {
        const response = await off.app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(404);
        expect(response.json<{ error: { code: string } }>().error.code).toBe(
          "NOT_FOUND",
        );
      }
      const post = await off.app.inject({
        method: "POST",
        url: "/api/v1/journeys/jrn_a/replay",
        headers: {
          origin: "http://127.0.0.1:3001",
          "content-type": "application/json",
        },
        payload: {},
      });
      expect(post.statusCode).toBe(404);

      // And with auth enabled plus a valid token the route is still gone:
      // an authenticated caller gets the foundation 404, not a handler.
      const authed = await app({ v07: "1", replay: "0" });
      const user = await registerUser(authed.app, "gate-off@example.com");
      for (const url of ["/api/v1/journeys"]) {
        const response = await authed.app.inject({
          method: "GET",
          url,
          headers: authedHeaders(user.token),
        });
        expect(response.statusCode).toBe(404);
        expect(response.json<{ error: { code: string } }>().error.code).toBe(
          "NOT_FOUND",
        );
      }
    },
  );

  it(
    "also stays off when the whole of v0.7 is off",
    { timeout: 30_000 },
    async () => {
      const off = await app({ auth: null, v07: "0", replay: "1" });
      expect(off.moduleNames).not.toContain(JOURNEY_MODULE_NAME);
      const response = await off.app.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: { origin: "http://127.0.0.1:3001" },
      });
      expect(response.statusCode).toBe(404);
    },
  );

  it(
    "registers the module and serves routes when both switches are on",
    { timeout: 30_000 },
    async () => {
      const on = await app({ v07: "1", replay: "1" });
      expect(on.moduleNames).toContain(JOURNEY_MODULE_NAME);
      // Route exists; without a token the auth gate answers first (401).
      const anonymous = await on.app.inject({
        method: "GET",
        url: "/api/v1/journeys",
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json<{ error: { code: string } }>().error.code).toBe(
        "AUTH_REQUIRED",
      );
    },
  );
});
