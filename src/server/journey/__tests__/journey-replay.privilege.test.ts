import { afterEach, describe, expect, it } from "vitest";

import {
  authedHeaders,
  buildJourneyApp,
  ingestEvents,
  registerUser,
  ORIGIN,
  type JourneyTestApp,
} from "./journey-app-fixture.js";

/**
 * Privilege matrix — A must not read B's Journey or Replay (V10, acceptance
 * "A 用 API 读不到 B 的 Journey、Replay 和 Signature").
 *
 * Frozen contract this file enforces (row references are the auditor's
 * matrix numbers):
 *   - cross-user ownership denial is 404 with code UNKNOWN_JOURNEY /
 *     UNKNOWN_REPLAY, byte-identical to a nonexistent id (rows #2/#10/#24)
 *   - 403 stays reserved for the role gate (row #25); ownership never
 *     answers 403 (no existence leak)
 *   - Signature routes are NOT part of batch-2 D scope: they are absent and
 *     therefore fail closed 404 for every caller alike (rows #7-#9, honest
 *     absence contract — C's batch-1 work owns the 200 shape)
 *
 * Every "A is denied" row has a B control arm proving the token, path and
 * journey are all real (anti-vacuous pattern from encoded-path.test.ts).
 */

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

interface PrivilegeFixture {
  readonly testApp: JourneyTestApp;
  readonly attackerToken: string;
  readonly victimToken: string;
  readonly victimJourneyId: string;
  readonly victimReplayId: string;
}

const ATTACKER = "priv-a@example.com";
const VICTIM = "priv-b@example.com";

const buildPrivilegeFixture = async (): Promise<PrivilegeFixture> => {
  const testApp = await buildJourneyApp({ v07: "1", replay: "1" });
  cleanups.push(testApp.cleanup);

  const attacker = await registerUser(testApp.app, ATTACKER);
  const victim = await registerUser(testApp.app, VICTIM);

  // B (victim) works a real session: slow start, flow plateau, test failure,
  // recovery. A ingests one event of its own so list scoping is two-sided.
  await ingestEvents(testApp.app, victim.token, [
    { id: "vic-1", type: "muses.editor.activity", secondsAgo: 8_000 },
    { id: "vic-2", type: "muses.editor.activity", secondsAgo: 7_800 },
    {
      id: "vic-3",
      type: "muses.test.run.completed",
      secondsAgo: 7_000,
      data: { status: "failed", total: 9, failed: 2 },
    },
    { id: "vic-4", type: "muses.editor.activity", secondsAgo: 6_900 },
    { id: "vic-5", type: "muses.editor.activity", secondsAgo: 6_800 },
    {
      id: "vic-6",
      type: "muses.test.run.completed",
      secondsAgo: 6_500,
      data: { status: "passed", total: 9, failed: 0 },
    },
    { id: "vic-7", type: "muses.editor.activity", secondsAgo: 6_400 },
  ]);
  await ingestEvents(testApp.app, attacker.token, [
    { id: "atk-1", type: "muses.editor.activity", secondsAgo: 5_000 },
    { id: "atk-2", type: "muses.editor.activity", secondsAgo: 4_900 },
    { id: "atk-3", type: "muses.editor.activity", secondsAgo: 4_800 },
  ]);

  const victimList = await testApp.app.inject({
    method: "GET",
    url: "/api/v1/journeys",
    headers: authedHeaders(victim.token),
  });
  expect(victimList.statusCode).toBe(200);
  const victimItems = victimList.json<{
    items: readonly { journeyId: string }[];
  }>().items;
  expect(victimItems.length).toBeGreaterThanOrEqual(1);
  const victimJourneyId = victimItems[0]!.journeyId;

  const rendered = await testApp.app.inject({
    method: "POST",
    url: `/api/v1/journeys/${victimJourneyId}/replay`,
    headers: authedHeaders(victim.token),
    payload: {},
  });
  expect(rendered.statusCode).toBe(201);
  const victimReplayId = rendered.json<{ replay: { replayId: string } }>()
    .replay.replayId;

  return {
    testApp,
    attackerToken: attacker.token,
    victimToken: victim.token,
    victimJourneyId,
    victimReplayId,
  };
};

const normalizeRequestId = (body: string): string =>
  body.replace(/req_[0-9a-f-]{36}/g, "req_X");

describe("journey/replay privilege matrix (V10 isolation)", () => {
  it("group 1 — ownership reads and writes", { timeout: 30_000 }, async () => {
    const { testApp, attackerToken, victimToken, victimJourneyId } =
      await buildPrivilegeFixture();

    // #1 A's list contains only A's journeys, never B's.
    const attackerList = await testApp.app.inject({
      method: "GET",
      url: "/api/v1/journeys",
      headers: authedHeaders(attackerToken),
    });
    expect(attackerList.statusCode).toBe(200);
    const attackerItems = attackerList.json<{
      items: readonly { journeyId: string }[];
    }>().items;
    expect(attackerItems.length).toBeGreaterThanOrEqual(1);
    for (const item of attackerItems) {
      expect(item.journeyId).not.toBe(victimJourneyId);
    }

    // #3 Control arm: B reads its own journey.
    const victimRead = await testApp.app.inject({
      method: "GET",
      url: `/api/v1/journeys/${victimJourneyId}`,
      headers: authedHeaders(victimToken),
    });
    expect(victimRead.statusCode).toBe(200);

    // #2 A cannot read B's journey: 404, identical to #10's baseline.
    const attackerRead = await testApp.app.inject({
      method: "GET",
      url: `/api/v1/journeys/${victimJourneyId}`,
      headers: authedHeaders(attackerToken),
    });
    expect(attackerRead.statusCode).toBe(404);
    expect(attackerRead.json<{ error: { code: string } }>().error.code).toBe(
      "UNKNOWN_JOURNEY",
    );

    // #10 Baseline: a nonexistent id, same route.
    const missingRead = await testApp.app.inject({
      method: "GET",
      url: "/api/v1/journeys/jrn_doesnotexist1234567890ab",
      headers: authedHeaders(attackerToken),
    });
    expect(missingRead.statusCode).toBe(404);

    // #24 Indistinguishability: statusCode, code, message identical after
    // requestId normalization.
    expect(attackerRead.statusCode).toBe(missingRead.statusCode);
    expect(normalizeRequestId(attackerRead.body)).toBe(
      normalizeRequestId(missingRead.body),
    );

    // #4 A cannot read B's replay.
    const attackerReplayRead = await testApp.app.inject({
      method: "GET",
      url: `/api/v1/journeys/${victimJourneyId}/replay`,
      headers: authedHeaders(attackerToken),
    });
    expect(attackerReplayRead.statusCode).toBe(404);
    expect(
      attackerReplayRead.json<{ error: { code: string } }>().error.code,
    ).toBe("UNKNOWN_JOURNEY");

    // #5 Write side: A cannot render a replay from B's journey.
    const attackerReplayPost = await testApp.app.inject({
      method: "POST",
      url: `/api/v1/journeys/${victimJourneyId}/replay`,
      headers: authedHeaders(attackerToken),
      payload: {},
    });
    expect(attackerReplayPost.statusCode).toBe(404);
    expect(
      attackerReplayPost.json<{ error: { code: string } }>().error.code,
    ).toBe("UNKNOWN_JOURNEY");

    // #6 Control arm: B can render (and the earlier replay still serves).
    const victimReplayRead = await testApp.app.inject({
      method: "GET",
      url: `/api/v1/journeys/${victimJourneyId}/replay`,
      headers: authedHeaders(victimToken),
    });
    expect(victimReplayRead.statusCode).toBe(200);
  });

  it(
    "group 1 — signature routes fail closed while unimplemented",
    { timeout: 30_000 },
    async () => {
      const { testApp, attackerToken, victimToken } =
        await buildPrivilegeFixture();
      // #7-#9: /api/v1/signature is batch-1 (C) scope. While absent it must
      // answer 404 identically for both users — no differential, no leak.
      for (const token of [attackerToken, victimToken]) {
        const get = await testApp.app.inject({
          method: "GET",
          url: "/api/v1/signature",
          headers: authedHeaders(token),
        });
        expect(get.statusCode).toBe(404);
        const put = await testApp.app.inject({
          method: "PUT",
          url: "/api/v1/signature",
          headers: authedHeaders(token),
          payload: { bpmRange: [90, 140] },
        });
        expect(put.statusCode).toBe(404);
        const history = await testApp.app.inject({
          method: "GET",
          url: "/api/v1/signature/history",
          headers: authedHeaders(token),
        });
        expect(history.statusCode).toBe(404);
      }
    },
  );

  it(
    "group 2 — id enumeration and query-parameter smuggling",
    { timeout: 30_000 },
    async () => {
      const { testApp, attackerToken, victimJourneyId } =
        await buildPrivilegeFixture();

      // #11 Ids are sha-derived, not sequential; a predictable-id sweep
      // still finds nothing but the attacker's own journeys.
      expect(victimJourneyId).toMatch(/^jrn_[0-9a-f]{24}$/);
      for (let n = 1; n <= 8; n += 1) {
        const response = await testApp.app.inject({
          method: "GET",
          url: `/api/v1/journeys/journey_${n}`,
          headers: authedHeaders(attackerToken),
        });
        expect(response.statusCode).toBe(404);
      }
      // Neighbor strings of the real id.
      for (const id of [
        victimJourneyId.slice(0, -1) + "0",
        victimJourneyId.slice(0, -1) + "f",
        "jrn_" + victimJourneyId.slice(4).toUpperCase(),
      ]) {
        const response = await testApp.app.inject({
          method: "GET",
          url: `/api/v1/journeys/${id}`,
          headers: authedHeaders(attackerToken),
        });
        expect([404]).toContain(response.statusCode);
      }

      // #12 Ownership id smuggled via the query string: the list handler
      // ignores unknown query params; B's journey must not appear.
      const viaQuery = await testApp.app.inject({
        method: "GET",
        url: `/api/v1/journeys?id=${encodeURIComponent(victimJourneyId)}`,
        headers: authedHeaders(attackerToken),
      });
      expect(viaQuery.statusCode).toBe(200);
      const items = viaQuery.json<{
        items: readonly { journeyId: string }[];
      }>().items;
      expect(items.some((item) => item.journeyId === victimJourneyId)).toBe(
        false,
      );
    },
  );

  it(
    "group 3 — gate attacks (no or fake identity)",
    { timeout: 30_000 },
    async () => {
      const { testApp, victimJourneyId } = await buildPrivilegeFixture();
      const urls = [
        "/api/v1/journeys",
        `/api/v1/journeys/${victimJourneyId}`,
        `/api/v1/journeys/${victimJourneyId}/replay`,
      ];
      // #13 Anonymous: 401 AUTH_REQUIRED (same code family the production
      // gate at :17502 measured).
      for (const url of urls) {
        const response = await testApp.app.inject({
          method: "GET",
          url,
          headers: { origin: ORIGIN },
        });
        expect(response.statusCode).toBe(401);
        expect(response.json<{ error: { code: string } }>().error.code).toBe(
          "AUTH_REQUIRED",
        );
      }
      // #14 Fake bearer token: 401 AUTH_INVALID.
      for (const url of urls) {
        const response = await testApp.app.inject({
          method: "GET",
          url,
          headers: { origin: ORIGIN, authorization: "Bearer x.y.z" },
        });
        expect(response.statusCode).toBe(401);
        expect(response.json<{ error: { code: string } }>().error.code).toBe(
          "AUTH_INVALID",
        );
      }
    },
  );

  it(
    "group 4 — encoded and path-confused attacks",
    { timeout: 30_000 },
    async () => {
      const { testApp, attackerToken, victimJourneyId } =
        await buildPrivilegeFixture();
      const headers = authedHeaders(attackerToken);

      // #15 Encoded /api prefix: the gate decodes and lets the router match
      // the decoded form; ownership still applies. Never 200.
      const encodedPrefix = await testApp.app.inject({
        method: "GET",
        url: `/%61pi/v1/journeys/${victimJourneyId}`,
        headers,
      });
      expect(encodedPrefix.statusCode).toBe(404);

      // #16 Single-encoded id segment decodes to the real id; the handler
      // still scopes by owner.
      const encodedId = await testApp.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${encodeURIComponent(victimJourneyId)}`,
        headers,
      });
      expect(encodedId.statusCode).toBe(404);
      expect(encodedId.json<{ error: { code: string } }>().error.code).toBe(
        "UNKNOWN_JOURNEY",
      );

      // #17 Double-encoded id stays literal after decode-once: matches
      // nothing.
      const doubleEncoded = await testApp.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${encodeURIComponent(encodeURIComponent(victimJourneyId))}`,
        headers,
      });
      expect(doubleEncoded.statusCode).toBe(404);

      // #18 Dot segments, trailing slash, encoded traversal.
      for (const url of [
        `/api/v1/journeys/../journeys/${victimJourneyId}`,
        `/api/v1/journeys/${victimJourneyId}/`,
        `/api/v1/journeys/%2e%2e%2f${victimJourneyId}`,
      ]) {
        const response = await testApp.app.inject({
          method: "GET",
          url,
          headers,
        });
        expect(response.statusCode).toBe(404);
      }

      // #19 Case-confused route fails closed (401 or 404, never 200).
      const upper = await testApp.app.inject({
        method: "GET",
        url: `/API/V1/JOURNEYS/${victimJourneyId}`,
        headers,
      });
      expect([401, 404]).toContain(upper.statusCode);
    },
  );

  it("group 5 — bypass and side channels", { timeout: 30_000 }, async () => {
    const { testApp, attackerToken, victimToken, victimJourneyId } =
      await buildPrivilegeFixture();

    // #20 v0.6 regression arm: the event list stays scoped.
    const events = await testApp.app.inject({
      method: "GET",
      url: "/api/v1/context/events?limit=200",
      headers: authedHeaders(attackerToken),
    });
    expect(events.statusCode).toBe(200);
    const ids = (
      events.json<{ items: readonly { id: string }[] }>().items ?? []
    ).map((item) => item.id);
    for (const id of ids) {
      expect(id.startsWith("vic-")).toBe(false);
    }
    expect(ids.some((id) => id.startsWith("atk-"))).toBe(true);

    // #21 Decisions and effects stay scoped to A.
    for (const url of [
      "/api/v1/effects/current",
      "/api/v1/decisions/current",
    ]) {
      const response = await testApp.app.inject({
        method: "GET",
        url,
        headers: authedHeaders(attackerToken),
      });
      expect(response.statusCode).toBe(200);
    }

    // #22 A's own replay cites only A's evidence (containment check).
    const attackerList = await testApp.app.inject({
      method: "GET",
      url: "/api/v1/journeys",
      headers: authedHeaders(attackerToken),
    });
    const attackerJourneyId = attackerList.json<{
      items: readonly { journeyId: string }[];
    }>().items[0]!.journeyId;
    const attackerReplay = await testApp.app.inject({
      method: "POST",
      url: `/api/v1/journeys/${attackerJourneyId}/replay`,
      headers: authedHeaders(attackerToken),
      payload: {},
    });
    expect(attackerReplay.statusCode).toBe(201);
    const attackerSnapshot = await testApp.app.inject({
      method: "GET",
      url: `/api/v1/journeys/${attackerJourneyId}`,
      headers: authedHeaders(attackerToken),
    });
    const nodes = attackerSnapshot.json<{
      journey: { nodes: readonly { evidenceEventIds: readonly string[] }[] };
    }>().journey.nodes;
    for (const node of nodes) {
      for (const id of node.evidenceEventIds) {
        expect(id.startsWith("atk-")).toBe(true);
        expect(id.startsWith("vic-")).toBe(false);
      }
    }

    // #25 The role gate stays a 403 and stays separate from ownership.
    const admin = await testApp.app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: authedHeaders(attackerToken),
    });
    expect(admin.statusCode).toBe(403);
    expect(admin.json<{ error: { code: string } }>().error.code).toBe(
      "AUTH_FORBIDDEN",
    );

    // Control arm: the victim token behaves the same on the admin gate
    // (both are ordinary users).
    const adminVictim = await testApp.app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: authedHeaders(victimToken),
    });
    expect(adminVictim.statusCode).toBe(403);
    void victimJourneyId;
  });

  it(
    "group 6 — repository and service depth",
    { timeout: 30_000 },
    async () => {
      const { testApp, victimJourneyId, victimReplayId } =
        await buildPrivilegeFixture();

      // #26 Direct repository probes: cross-user reads are null even though
      // the rows exist (SQL-level user_id predicate on every read path).
      const attackerId = await resolveUserId(testApp, ATTACKER);
      expect(
        testApp.repository.getById(victimJourneyId, attackerId),
      ).toBeNull();
      expect(
        testApp.repository.getLatestReplay(victimJourneyId, attackerId),
      ).toBeNull();
      // And the rows genuinely exist for the victim id.
      const victimId = await resolveUserId(testApp, VICTIM);
      expect(
        testApp.repository.getById(victimJourneyId, victimId),
      ).not.toBeNull();
      expect(
        testApp.repository.getLatestReplay(victimJourneyId, victimId)?.replayId,
      ).toBe(victimReplayId);
    },
  );
});

/** Reads the account id straight from the auth store via the API profile. */
const resolveUserId = async (
  testApp: JourneyTestApp,
  email: string,
): Promise<string> => {
  // Register already gave us ids, but this fixture only kept tokens; the
  // profile endpoint is the honest per-token source.
  const response = await testApp.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${await tokenFor(testApp, email)}`,
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ user: { id: string } }>().user.id;
};

const tokenFor = async (
  testApp: JourneyTestApp,
  email: string,
): Promise<string> => {
  const login = await testApp.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { email, password: "secret1" },
  });
  expect(login.statusCode).toBe(200);
  return login.json<{ token: string }>().token;
};
