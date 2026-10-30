import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  authedHeaders,
  buildJourneyApp,
  ingestEvents,
  registerUser,
  type JourneyTestApp,
} from "./journey-app-fixture.js";

/**
 * Trailing-slash equivalence (Round-3 defect #1): a trailing slash must not
 * change what a journey/replay URL answers. The expectation for the slashed
 * form is exactly the no-slash form's actual response — same status code,
 * and on errors the same business code, so the authz indistinguishability
 * contract (UNKNOWN_JOURNEY, see the authz regression file) cannot be probed
 * through route shape: pre-fix `/api/v1/journeys/` fell through to the
 * parametric detail route with an empty journeyId (400 VALIDATION_FAILED
 * where the list answers 200), and the slashed detail/replay forms fell to
 * the generic NOT_FOUND envelope where the slashless forms answer 200/201
 * or the business 404s.
 *
 * Frozen pairs (slashed expectation == slashless actual):
 *   GET  /api/v1/journeys/                   == GET  /api/v1/journeys
 *   POST /api/v1/journeys/                   == POST /api/v1/journeys
 *   GET  /api/v1/journeys/:id/               == GET  /api/v1/journeys/:id
 *   POST /api/v1/journeys/:id/replay/        == POST /api/v1/journeys/:id/replay
 *   GET  /api/v1/journeys/:id/replay/        == GET  /api/v1/journeys/:id/replay
 * and the same three :id routes for a cross-user attacker.
 */

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

const VICTIM = "slash-b@example.com";
const ATTACKER = "slash-a@example.com";

interface PairDivergence {
  readonly label: string;
  readonly slashless: string;
  readonly slashed: string;
}

const slashPairsOf = async (
  instance: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  token: string,
): Promise<PairDivergence | null> => {
  const send = async (target: string) => {
    const response = await instance.inject({
      method,
      url: target,
      headers: authedHeaders(token),
      ...(method === "POST" ? { payload: {} } : {}),
    });
    const code =
      response.statusCode >= 400
        ? response.json<{ error?: { code: string } }>().error?.code
        : undefined;
    return `${response.statusCode}${code === undefined ? "" : ` ${code}`}`;
  };
  const slashless = await send(url);
  const slashed = await send(`${url}/`);
  return slashless === slashed
    ? null
    : { label: `${method} ${url}`, slashless, slashed };
};

const expectSlashEquivalent = async (
  instance: FastifyInstance,
  divergences: PairDivergence[],
  method: "GET" | "POST",
  url: string,
  token: string,
): Promise<void> => {
  const divergence = await slashPairsOf(instance, method, url, token);
  if (divergence !== null) {
    divergences.push(divergence);
  }
};

describe("journey/replay trailing-slash equivalence", () => {
  it(
    "every journey/replay URL answers the slashless code and business code",
    { timeout: 60_000 },
    async () => {
      const testApp: JourneyTestApp = await buildJourneyApp({
        v07: "1",
        replay: "1",
      });
      cleanups.push(() => testApp.cleanup());
      const instance = testApp.app;
      const victim = await registerUser(instance, VICTIM);
      const attacker = await registerUser(instance, ATTACKER);

      await ingestEvents(instance, victim.token, [
        { id: "slash-v1", type: "muses.editor.activity", secondsAgo: 3_000 },
        { id: "slash-v2", type: "muses.editor.activity", secondsAgo: 2_975 },
        { id: "slash-v3", type: "muses.editor.activity", secondsAgo: 2_950 },
        { id: "slash-v4", type: "muses.editor.activity", secondsAgo: 2_925 },
        { id: "slash-v5", type: "muses.editor.activity", secondsAgo: 2_900 },
      ]);
      await ingestEvents(instance, attacker.token, [
        { id: "slash-a1", type: "muses.editor.activity", secondsAgo: 2_500 },
        { id: "slash-a2", type: "muses.editor.activity", secondsAgo: 2_475 },
        { id: "slash-a3", type: "muses.editor.activity", secondsAgo: 2_450 },
      ]);

      const list = await instance.inject({
        method: "GET",
        url: "/api/v1/journeys",
        headers: authedHeaders(victim.token),
      });
      expect(list.statusCode).toBe(200);
      const journeyId = list
        .json<{ items: readonly { journeyId: string }[] }>()
        .items.find((item) => item.journeyId.match(/^jrn_/))!.journeyId;

      // Owner arms — the positive surface first, in dependency order
      // (render, then read the rendered replay). Divergences accumulate;
      // the single assertion at the end reports every violating pair.
      const divergences: PairDivergence[] = [];
      await expectSlashEquivalent(
        instance,
        divergences,
        "POST",
        `/api/v1/journeys/${journeyId}/replay`,
        victim.token,
      );
      await expectSlashEquivalent(
        instance,
        divergences,
        "GET",
        `/api/v1/journeys/${journeyId}/replay`,
        victim.token,
      );
      await expectSlashEquivalent(
        instance,
        divergences,
        "GET",
        `/api/v1/journeys/${journeyId}`,
        victim.token,
      );
      await expectSlashEquivalent(
        instance,
        divergences,
        "GET",
        "/api/v1/journeys",
        victim.token,
      );
      // POST on the collection is not a route; its slashed twin must not
      // become one either (both answer the foundation NOT_FOUND envelope).
      await expectSlashEquivalent(
        instance,
        divergences,
        "POST",
        "/api/v1/journeys",
        victim.token,
      );

      // Attacker arms — the slash must not downgrade UNKNOWN_JOURNEY to the
      // generic NOT_FOUND envelope (route-shape leak).
      await expectSlashEquivalent(
        instance,
        divergences,
        "GET",
        `/api/v1/journeys/${journeyId}`,
        attacker.token,
      );
      await expectSlashEquivalent(
        instance,
        divergences,
        "GET",
        `/api/v1/journeys/${journeyId}/replay`,
        attacker.token,
      );
      await expectSlashEquivalent(
        instance,
        divergences,
        "POST",
        `/api/v1/journeys/${journeyId}/replay`,
        attacker.token,
      );

      expect(divergences, "trailing-slash pairs answering differently").toEqual(
        [],
      );

      // Baseline pins: the equivalence above must not "pass" by both sides
      // drifting — pin the slashless actuals the contract freezes.
      const detail = await instance.inject({
        method: "GET",
        url: `/api/v1/journeys/${journeyId}`,
        headers: authedHeaders(victim.token),
      });
      expect(detail.statusCode).toBe(200);
      const attackerDetail = await instance.inject({
        method: "GET",
        url: `/api/v1/journeys/${journeyId}`,
        headers: authedHeaders(attacker.token),
      });
      expect(attackerDetail.statusCode).toBe(404);
      expect(
        attackerDetail.json<{ error: { code: string } }>().error.code,
      ).toBe("UNKNOWN_JOURNEY");
    },
  );
});
