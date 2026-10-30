import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ContextClock } from "../../context/model.js";
import { sustainedEditingFixture } from "../__fixtures__/replay-fixtures.js";
import type { BeliefEventWindow, BeliefSnapshot } from "../model.js";
import { projectBelief } from "../projector.js";
import { beliefRoutes } from "../routes.js";
import { BeliefService } from "../service.js";

const AS_OF = "2026-07-30T00:04:00.000Z";

const clock: ContextClock = {
  now: () => new Date(AS_OF),
};

const wholeStream = (): BeliefEventWindow => ({
  events: sustainedEditingFixture,
  total: sustainedEditingFixture.length,
});

const applications: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close()),
  );
});

describe("belief routes", () => {
  it("returns a deterministic current projection", async () => {
    const application = Fastify({ logger: false });
    applications.push(application);
    const service = new BeliefService(
      { readForBelief: async () => wholeStream() },
      { clock },
    );
    await application.register(beliefRoutes, { service });

    const response = await application.inject({
      method: "GET",
      url: "/api/v1/belief/current",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: "BUILD",
      rulesetVersion: "muses-belief-rules/0.1.0",
    });
  });

  it("serves the most recent window with 200 instead of 413 when the stream exceeds the limit", async () => {
    const application = Fastify({ logger: false });
    applications.push(application);
    // The stream holds 3 events; both routes are bounded to a 2-event window.
    const service = new BeliefService(
      { readForBelief: async () => wholeStream() },
      { clock, defaultMaxEvents: 2 },
    );
    await application.register(beliefRoutes, { service });
    const expected = projectBelief(sustainedEditingFixture.slice(-2), AS_OF);

    const replay = await application.inject({
      method: "POST",
      url: "/api/v1/belief/replay",
      payload: { maxEvents: 2 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<BeliefSnapshot>()).toEqual(expected);

    const current = await application.inject({
      method: "GET",
      url: "/api/v1/belief/current",
    });
    expect(current.statusCode).toBe(200);
    expect(current.json<BeliefSnapshot>()).toEqual(expected);
  });
});
