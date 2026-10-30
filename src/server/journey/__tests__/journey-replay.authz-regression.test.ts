import { openDatabase } from "../../db/index.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  authedHeaders,
  buildJourneyApp,
  ingestEvents,
  registerUser,
  type JourneyTestApp,
} from "./journey-app-fixture.js";

/**
 * Cross-user authorization regression (Round-2 batch-2 defect #4), matrix2
 * pattern: every "A is denied" row carries a B control arm proving the
 * token, path and journey are real, plus the indistinguishability baseline
 * (a nonexistent id answers byte-identically after requestId
 * normalization). Beyond the existing privilege matrix this file pins the
 * WRITE side reverse-proof at the storage layer: after A's denied POST,
 * no replay row for B's journey was created by A (journey_replays has no
 * row attributed to A, and the count for B's journey is unchanged).
 */

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

const ATTACKER = "regress-a@example.com";
const VICTIM = "regress-b@example.com";

const normalizeRequestId = (body: string): string =>
  body.replace(/req_[0-9a-f-]{36}/g, "req_X");

interface Fixture {
  readonly testApp: JourneyTestApp;
  readonly attackerToken: string;
  readonly attackerId: string;
  readonly victimToken: string;
  readonly victimJourneyId: string;
}

const buildFixture = async (): Promise<Fixture> => {
  const testApp = await buildJourneyApp({ v07: "1", replay: "1" });
  cleanups.push(() => testApp.cleanup());
  const attacker = await registerUser(testApp.app, ATTACKER);
  const victim = await registerUser(testApp.app, VICTIM);

  // B works a real session; A has its own journey so scoping is two-sided.
  await ingestEvents(testApp.app, victim.token, [
    { id: "reg-v1", type: "muses.editor.activity", secondsAgo: 3_000 },
    { id: "reg-v2", type: "muses.editor.activity", secondsAgo: 2_975 },
    { id: "reg-v3", type: "muses.editor.activity", secondsAgo: 2_950 },
    { id: "reg-v4", type: "muses.editor.activity", secondsAgo: 2_925 },
    { id: "reg-v5", type: "muses.editor.activity", secondsAgo: 2_900 },
  ]);
  await ingestEvents(testApp.app, attacker.token, [
    { id: "reg-a1", type: "muses.editor.activity", secondsAgo: 2_500 },
    { id: "reg-a2", type: "muses.editor.activity", secondsAgo: 2_475 },
    { id: "reg-a3", type: "muses.editor.activity", secondsAgo: 2_450 },
  ]);

  const victimList = await testApp.app.inject({
    method: "GET",
    url: "/api/v1/journeys",
    headers: authedHeaders(victim.token),
  });
  expect(victimList.statusCode).toBe(200);
  const victimJourneyId = victimList.json<{
    items: readonly { journeyId: string }[];
  }>().items[0]!.journeyId;

  return {
    testApp,
    attackerToken: attacker.token,
    attackerId: attacker.userId,
    victimToken: victim.token,
    victimJourneyId,
  };
};

describe("journey/replay cross-user regression (matrix2 pattern)", () => {
  it(
    "A cannot read or create anything on B's journey; B's arms stay green",
    { timeout: 60_000 },
    async () => {
      const {
        testApp,
        attackerToken,
        attackerId,
        victimToken,
        victimJourneyId,
      } = await buildFixture();
      const attackerHeaders = authedHeaders(attackerToken);
      const victimHeaders = authedHeaders(victimToken);

      const replayRowsFor = (journeyId: string): { n: number } => {
        const opened = openDatabase(testApp.databasePath);
        try {
          return opened.connection
            .prepare(
              "SELECT COUNT(*) AS n FROM journey_replays WHERE journey_id = ?",
            )
            .get(journeyId) as { n: number };
        } finally {
          opened.close();
        }
      };
      const rowsByUser = (userId: string): { n: number } => {
        const opened = openDatabase(testApp.databasePath);
        try {
          return opened.connection
            .prepare(
              "SELECT COUNT(*) AS n FROM journey_replays WHERE user_id = ?",
            )
            .get(userId) as { n: number };
        } finally {
          opened.close();
        }
      };

      // B control arms: journey detail 200, replay renders 201.
      const victimDetail = await testApp.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${victimJourneyId}`,
        headers: victimHeaders,
      });
      expect(victimDetail.statusCode).toBe(200);
      const victimRender = await testApp.app.inject({
        method: "POST",
        url: `/api/v1/journeys/${victimJourneyId}/replay`,
        headers: victimHeaders,
        payload: {},
      });
      expect(victimRender.statusCode).toBe(201);
      const victimRows = replayRowsFor(victimJourneyId).n;
      expect(victimRows).toBe(1);

      // A reads B's journey detail: 404 UNKNOWN_JOURNEY, indistinguishable
      // from a nonexistent id on the same route.
      const attackerDetail = await testApp.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${victimJourneyId}`,
        headers: attackerHeaders,
      });
      expect(attackerDetail.statusCode).toBe(404);
      expect(
        attackerDetail.json<{ error: { code: string } }>().error.code,
      ).toBe("UNKNOWN_JOURNEY");
      const missingDetail = await testApp.app.inject({
        method: "GET",
        url: "/api/v1/journeys/jrn_regressmissing1234567",
        headers: attackerHeaders,
      });
      expect(normalizeRequestId(attackerDetail.body)).toBe(
        normalizeRequestId(missingDetail.body),
      );

      // A reads B's replay: 404, same route family.
      const attackerReplay = await testApp.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${victimJourneyId}/replay`,
        headers: attackerHeaders,
      });
      expect(attackerReplay.statusCode).toBe(404);
      expect(
        attackerReplay.json<{ error: { code: string } }>().error.code,
      ).toBe("UNKNOWN_JOURNEY");

      // A POSTs a replay for B's journey: denied like a missing journey…
      const attackerRender = await testApp.app.inject({
        method: "POST",
        url: `/api/v1/journeys/${victimJourneyId}/replay`,
        headers: attackerHeaders,
        payload: {},
      });
      expect(attackerRender.statusCode).toBe(404);
      expect(
        attackerRender.json<{ error: { code: string } }>().error.code,
      ).toBe("UNKNOWN_JOURNEY");
      // …and the reverse-proof: nothing was created for B's journey by A.
      expect(replayRowsFor(victimJourneyId).n).toBe(victimRows);
      expect(rowsByUser(attackerId).n).toBe(0);

      // B's replay still serves after the attack.
      const victimReplayAfter = await testApp.app.inject({
        method: "GET",
        url: `/api/v1/journeys/${victimJourneyId}/replay`,
        headers: victimHeaders,
      });
      expect(victimReplayAfter.statusCode).toBe(200);

      // A's own list never contains B's journey.
      const attackerList = await testApp.app.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: attackerHeaders,
      });
      expect(attackerList.statusCode).toBe(200);
      expect(
        attackerList
          .json<{ items: readonly { journeyId: string }[] }>()
          .items.some((item) => item.journeyId === victimJourneyId),
      ).toBe(false);
    },
  );
});
