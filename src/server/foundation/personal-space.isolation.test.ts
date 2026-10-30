import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "./config.js";
import { createApp } from "./create-app.js";
import { buildRuntimeModules } from "./runtime-modules.js";
import type { PerUserRuntimes } from "./per-user-runtimes.js";
import { enabledAuthConfig, registerViaApi } from "../auth/test-support.js";
import type { AuthConfig } from "../auth/config.js";
import type { BeliefSnapshot } from "../belief/model.js";

interface PersonalSpaceApp {
  readonly app: FastifyInstance;
  readonly perUserRuntimes: PerUserRuntimes;
  readonly cleanup: () => Promise<void>;
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

const buildApp = async (auth: AuthConfig | null): Promise<PersonalSpaceApp> => {
  const directory = mkdtempSync(join(tmpdir(), "muses-personal-space-"));
  const previousDatabasePath = process.env.MUSES_DATABASE_PATH;
  process.env.MUSES_DATABASE_PATH = join(directory, "muses.sqlite");
  const runtime = await buildRuntimeModules({ auth });
  const app = await createApp({
    config: loadRuntimeConfig({ NODE_ENV: "test" }),
    logger: false,
    modules: runtime.modules,
  });
  const personal: PersonalSpaceApp = {
    app,
    perUserRuntimes: runtime.perUserRuntimes,
    cleanup: async () => {
      await app.close();
      await runtime.close();
      if (previousDatabasePath === undefined) {
        delete process.env.MUSES_DATABASE_PATH;
      } else {
        process.env.MUSES_DATABASE_PATH = previousDatabasePath;
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
  cleanups.push(personal.cleanup);
  return personal;
};

const ORIGIN = "http://127.0.0.1:3001";

const authedHeaders = (token: string): Record<string, string> => ({
  origin: ORIGIN,
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

const iso = (secondsAgo: number): string =>
  new Date(Date.now() - secondsAgo * 1_000).toISOString();

const ingestEvent = async (
  app: FastifyInstance,
  token: string,
  id: string,
  secondsAgo: number,
): Promise<void> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/context/events",
    headers: authedHeaders(token),
    payload: {
      specversion: "1.0",
      id,
      source: "urn:muses:personal-space",
      type: "muses.editor.activity",
      subject: "workspace:alpha",
      time: iso(secondsAgo),
      data: { action: "edit" },
    },
  });
  if (response.statusCode !== 202) {
    throw new Error(
      `ingest ${id} failed: ${response.statusCode} ${response.body}`,
    );
  }
};

interface BootstrapBody {
  readonly belief: BeliefSnapshot;
  readonly decision: { beliefId: string } | null;
  readonly effect: { request: { effectId: string } } | null;
}

const bootstrapAs = async (
  app: FastifyInstance,
  token: string,
): Promise<BootstrapBody> => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/bootstrap",
    headers: authedHeaders(token),
  });
  expect(response.statusCode).toBe(200);
  return response.json<BootstrapBody>();
};

const listEventIds = async (
  app: FastifyInstance,
  token: string,
): Promise<readonly string[]> => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/context/events?limit=200",
    headers: authedHeaders(token),
  });
  expect(response.statusCode).toBe(200);
  return (
    response.json<{ items: readonly { id: string }[] }>().items ?? []
  ).map((item) => item.id);
};

describe("personal space (v0.6 multi-user isolation)", () => {
  it("preserves external Host access only when the real auth module is installed", async () => {
    const local = await buildApp(null);
    const denied = await local.app.inject({
      headers: { host: "muses.example:443" },
      method: "GET",
      url: "/api/health",
    });
    expect(denied.statusCode).toBe(403);

    const secured = await buildApp(enabledAuthConfig());
    const anonymous = await secured.app.inject({
      headers: { host: "muses.example:443" },
      method: "GET",
      url: "/api/v1/context/events?limit=1",
    });
    expect(anonymous.statusCode).toBe(401);
    const session = await registerViaApi(
      secured.app,
      "host-test@example.com",
      "secret1",
    );
    const authenticated = await secured.app.inject({
      headers: {
        authorization: `Bearer ${session.token}`,
        host: "muses.example:443",
      },
      method: "GET",
      url: "/api/v1/context/events?limit=1",
    });
    expect(authenticated.statusCode).toBe(200);
  });

  // Full app + two registered users (bcrypt) + migrations: generous timeout
  // because the parallel suite loads a small host.
  it(
    "isolates events, belief, decisions and effects between two users",
    { timeout: 30_000 },
    async () => {
      const { app, perUserRuntimes } = await buildApp(enabledAuthConfig());

      const sessionA = await registerViaApi(
        app,
        "alpha@example.com",
        "secret1",
      );
      const sessionB = await registerViaApi(app, "beta@example.com", "secret2");

      // A sustains editing (three events -> BUILD); B posts a single edit.
      await ingestEvent(app, sessionA.token, "alpha-1", 240);
      await ingestEvent(app, sessionA.token, "alpha-2", 120);
      await ingestEvent(app, sessionA.token, "alpha-3", 5);
      await ingestEvent(app, sessionB.token, "beta-1", 30);

      // Event listing is scoped per user.
      expect(await listEventIds(app, sessionA.token)).toEqual([
        "alpha-1",
        "alpha-2",
        "alpha-3",
      ]);
      expect(await listEventIds(app, sessionB.token)).toEqual(["beta-1"]);

      // Bootstrap belief is scoped: A reaches BUILD on its own evidence; B's
      // evidence contains only B's event.
      const bootstrapA = await bootstrapAs(app, sessionA.token);
      const bootstrapB = await bootstrapAs(app, sessionB.token);

      expect(bootstrapA.belief.state).toBe("BUILD");
      const evidenceA = bootstrapA.belief.evidence.map(
        (entry) => entry.eventId,
      );
      expect(evidenceA.length).toBeGreaterThan(0);
      for (const eventId of evidenceA) {
        expect(eventId.startsWith("alpha-")).toBe(true);
      }

      expect(bootstrapB.belief.evidence.map((e) => e.eventId)).toEqual([
        "beta-1",
      ]);
      // The projections consumed exactly each user's own events: A's last
      // sequence is its third event, B's is its single event (global seq 4).
      expect(bootstrapA.belief.lastServerSequence).toBe(3);
      expect(bootstrapB.belief.lastServerSequence).toBe(4);

      // Decisions are attributed per user: each decision cites the belief of
      // its own stream (belief_<rules>_seq<that user's last sequence>).
      expect(bootstrapA.decision).not.toBeNull();
      expect(bootstrapA.decision?.beliefId).toContain(
        `seq${bootstrapA.belief.lastServerSequence}`,
      );
      if (bootstrapB.decision !== null) {
        expect(bootstrapB.decision.beliefId).not.toBe(
          bootstrapA.decision?.beliefId,
        );
      }

      // A's automation issued A's effect; B has none in its own stream.
      if (bootstrapA.decision !== null && bootstrapA.effect !== null) {
        const currentB = await app.inject({
          method: "GET",
          url: "/api/v1/effects/current",
          headers: authedHeaders(sessionB.token),
        });
        expect(currentB.statusCode).toBe(200);
        expect(currentB.json<{ effect: unknown }>().effect).toBeNull();
      }

      // --- Per-user cache, exercised on B's stream in the same app. ---
      const afterFirst = perUserRuntimes.stats;
      expect(afterFirst.replays).toBeGreaterThan(0);

      const secondB = await bootstrapAs(app, sessionB.token);
      const afterSecond = perUserRuntimes.stats;
      // A refresh with no new events hits the cache: no replay, one more hit,
      // identical projection.
      expect(afterSecond.replays).toBe(afterFirst.replays);
      expect(afterSecond.cacheHits).toBe(afterFirst.cacheHits + 1);
      expect(secondB.belief).toEqual(bootstrapB.belief);

      // Ingest invalidates: the next bootstrap replays with the new evidence.
      await ingestEvent(app, sessionB.token, "beta-2", 0);
      const thirdB = await bootstrapAs(app, sessionB.token);
      const afterThird = perUserRuntimes.stats;
      expect(afterThird.replays).toBeGreaterThan(afterSecond.replays);
      expect(thirdB.belief.evidence.map((e) => e.eventId)).toContain("beta-2");
    },
  );

  it(
    "keeps the auth-disabled local app on the legacy global stream",
    { timeout: 30_000 },
    async () => {
      const { app } = await buildApp(null);

      const ingest = await app.inject({
        method: "POST",
        url: "/api/v1/context/events",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        payload: {
          specversion: "1.0",
          id: "anon-1",
          source: "urn:muses:local",
          type: "muses.editor.activity",
          subject: "workspace:local",
          time: iso(5),
          data: { action: "edit" },
        },
      });
      expect(ingest.statusCode).toBe(202);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/context/events",
        headers: { origin: ORIGIN },
      });
      expect(list.statusCode).toBe(200);
      expect(
        list
          .json<{ items: readonly { id: string }[] }>()
          .items.map((i) => i.id),
      ).toEqual(["anon-1"]);

      const bootstrap = await app.inject({
        method: "GET",
        url: "/api/v1/bootstrap",
        headers: { origin: ORIGIN },
      });
      expect(bootstrap.statusCode).toBe(200);
      const body = bootstrap.json<BootstrapBody>();
      expect(body.belief.evidence.map((e) => e.eventId)).toEqual(["anon-1"]);

      // The anonymous stream is stable across refreshes (cached projection).
      const again = await app.inject({
        method: "GET",
        url: "/api/v1/bootstrap",
        headers: { origin: ORIGIN },
      });
      expect(again.json<BootstrapBody>().belief).toEqual(body.belief);
    },
  );
});
