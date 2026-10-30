import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { ContextClock } from "../../context/model.js";
import type { PulseSnapshot } from "../model.js";
import { record } from "../../belief/__fixtures__/replay-fixtures.js";
import { projectPulse } from "../projector.js";
import { pulseRoutes } from "../routes.js";
import { PulseService } from "../service.js";

const AS_OF = "2026-07-30T12:00:00.000Z";

const clock: ContextClock = {
  now: () => new Date(AS_OF),
};

const fixture = [
  record(1, "edit-1", "muses.editor.activity", "2026-07-30T11:59:10.000Z", {
    action: "edit",
  }),
  record(2, "edit-2", "muses.editor.activity", "2026-07-30T11:59:20.000Z", {
    action: "save",
  }),
  record(3, "edit-3", "muses.editor.activity", "2026-07-30T11:59:30.000Z", {
    action: "edit",
  }),
  record(4, "edit-4", "muses.editor.activity", "2026-07-30T11:59:40.000Z", {
    action: "edit",
  }),
  record(5, "test-5", "muses.test.run.completed", "2026-07-30T11:59:50.000Z", {
    status: "passed",
  }),
] as const;

const applications: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close()),
  );
});

const buildApp = async (
  options: Parameters<typeof pulseRoutes>[1],
): Promise<FastifyInstance> => {
  const application = Fastify({ logger: false });
  applications.push(application);
  await application.register(pulseRoutes, options);
  return application;
};

describe("pulse routes", () => {
  it("serves a deterministic current projection under /api/v1/belief/pulse", async () => {
    const seenUserIds: (string | null)[] = [];
    const application = await buildApp({
      forUser: (userId) => {
        seenUserIds.push(userId);
        return new PulseService(
          { readRecentForPulse: async () => fixture },
          { clock },
        );
      },
    });

    const response = await application.inject({
      method: "GET",
      url: "/api/v1/belief/pulse/current",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<PulseSnapshot>();
    expect(body).toMatchObject({
      asOf: AS_OF,
      rulesetVersion: "muses-pulse-rules/0.1.0",
    });
    expect(body.rhythm.value).toBe("SLOW");
    expect(body.emotion.tone).toBe("POSITIVE");
    expect(seenUserIds).toEqual([null]);
  });

  it("matches POST /replay field-for-field with the pure projector (C2)", async () => {
    const application = await buildApp({
      service: new PulseService(
        { readRecentForPulse: async () => fixture },
        { clock },
      ),
    });

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/belief/pulse/replay",
      payload: { asOf: AS_OF },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(projectPulse(fixture, AS_OF));
  });

  it("keeps GET current and POST replay digests identical without new events (C2)", async () => {
    const application = await buildApp({
      service: new PulseService(
        { readRecentForPulse: async () => fixture },
        { clock },
      ),
    });

    const current = await application.inject({
      method: "GET",
      url: "/api/v1/belief/pulse/current",
    });
    const replay = await application.inject({
      method: "POST",
      url: "/api/v1/belief/pulse/replay",
      payload: { asOf: AS_OF },
    });

    expect(current.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    const currentBody = current.json<PulseSnapshot>();
    const replayBody = replay.json<PulseSnapshot>();
    expect(replayBody.inputDigest).toBe(currentBody.inputDigest);
  });

  it("maps domain errors to HTTP status codes", async () => {
    const many = Array.from({ length: 3 }, (_, index) =>
      record(
        index + 1,
        `edit-${index + 1}`,
        "muses.editor.activity",
        "2026-07-30T11:59:30.000Z",
        { action: "edit" },
      ),
    );
    const application = await buildApp({
      service: new PulseService(
        { readRecentForPulse: async () => many },
        { clock, defaultMaxEvents: 2 },
      ),
    });

    const invalidAsOf = await application.inject({
      method: "POST",
      url: "/api/v1/belief/pulse/replay",
      payload: { asOf: "garbage" },
    });
    expect(invalidAsOf.statusCode).toBe(400);
    expect(invalidAsOf.json()).toMatchObject({
      error: { code: "PULSE_INVALID_REQUEST" },
    });

    const exceeded = await application.inject({
      method: "GET",
      url: "/api/v1/belief/pulse/current",
    });
    expect(exceeded.statusCode).toBe(413);
    expect(exceeded.json()).toMatchObject({
      error: { code: "PULSE_REPLAY_LIMIT_EXCEEDED" },
    });
  });

  it("hides internal failures behind a safe 500", async () => {
    const application = await buildApp({
      service: {
        current: async () => {
          throw new Error("internal detail");
        },
        replay: async () => {
          throw new Error("internal detail");
        },
      },
    });

    const response = await application.inject({
      method: "GET",
      url: "/api/v1/belief/pulse/current",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: { code: "PULSE_INTERNAL_ERROR" },
    });
    expect(response.body).not.toContain("internal detail");
  });

  it("strips unknown extra body fields (fastify removeAdditional default)", async () => {
    const application = await buildApp({
      service: new PulseService(
        { readRecentForPulse: async () => fixture },
        { clock },
      ),
    });

    // Fastify's default ajv removes additional properties instead of
    // rejecting them — the same contract the v0.6 belief replay body has.
    const clean = await application.inject({
      method: "POST",
      url: "/api/v1/belief/pulse/replay",
      payload: { asOf: AS_OF },
    });
    const noisy = await application.inject({
      method: "POST",
      url: "/api/v1/belief/pulse/replay",
      payload: { asOf: AS_OF, unexpected: true },
    });

    expect(noisy.statusCode).toBe(200);
    const noisyBody = noisy.json<PulseSnapshot>();
    const cleanBody = clean.json<PulseSnapshot>();
    expect(noisyBody.inputDigest).toBe(cleanBody.inputDigest);
  });
});
