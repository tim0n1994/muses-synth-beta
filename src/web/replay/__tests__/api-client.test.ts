import { describe, expect, it } from "vitest";

import { createReplayApiClient, ReplayApiError } from "../index.js";

/**
 * Typed browser client for the journey/replay API (batch-2 contract):
 * GET /api/v1/journeys, GET /api/v1/journeys/:id,
 * POST/GET /api/v1/journeys/:id/replay. Bearer token from the auth store;
 * error envelopes surface as ReplayApiError with the server's code.
 */

const jsonDouble = (
  status: number,
  body: unknown,
): ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
  return async (_input, init) => {
    void init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
};

const recordingDouble = (
  status: number,
  body: unknown,
): {
  fetcher: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      ...(init === undefined ? {} : { init }),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetcher, calls };
};

describe("replay api client", () => {
  it("sends the bearer token and parses the journey list", async () => {
    const { fetcher, calls } = recordingDouble(200, {
      items: [
        { journeyId: "jrn_abc", sessionStartedAt: "2026-10-20T09:00:00Z" },
      ],
    });
    const client = createReplayApiClient({
      baseUrl: "https://muses.example",
      token: "tok-1",
      fetchFn: fetcher,
    });
    const items = await client.listJourneys();
    expect(items[0]?.journeyId).toBe("jrn_abc");
    expect(calls[0]?.url).toBe("https://muses.example/api/v1/journeys");
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer tok-1",
    });
  });

  it("posts an empty JSON body for replay rendering", async () => {
    const { fetcher, calls } = recordingDouble(201, {
      replay: { replayId: "rpl_1", segments: [] },
      tracks: [
        {
          trackId: "t-1",
          url: "/library/self/self_slow_low/t-1.opus",
          title: "Slow Low One",
          artist: "Pilot Author",
          license: "CC-BY 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          durationMs: 240_000,
        },
      ],
    });
    const client = createReplayApiClient({
      baseUrl: "https://muses.example",
      token: "tok-1",
      fetchFn: fetcher,
    });
    const replay = await client.renderReplay("jrn_abc");
    expect(replay.plan.replayId).toBe("rpl_1");
    expect(replay.tracks[0]?.trackId).toBe("t-1");
    expect(replay.tracks[0]?.url).toBe("/library/self/self_slow_low/t-1.opus");
    expect(calls[0]?.url).toBe(
      "https://muses.example/api/v1/journeys/jrn_abc/replay",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe("{}");
  });

  it("surfaces the error envelope code on 404", async () => {
    const client = createReplayApiClient({
      baseUrl: "https://muses.example",
      token: "tok-1",
      fetchFn: jsonDouble(404, {
        error: {
          code: "UNKNOWN_JOURNEY",
          message: "Journey not found",
          requestId: "req_x",
        },
      }),
    });
    const error = await client
      .getJourney("jrn_missing")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReplayApiError);
    expect((error as ReplayApiError).code).toBe("UNKNOWN_JOURNEY");
    expect((error as ReplayApiError).status).toBe(404);
  });

  it("treats a non-envelope error body as an unknown failure", async () => {
    const client = createReplayApiClient({
      baseUrl: "https://muses.example",
      token: "tok-1",
      fetchFn: jsonDouble(502, "bad gateway text"),
    });
    const error = await client.getReplay("jrn_abc").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReplayApiError);
    expect((error as ReplayApiError).code).toBe("REPLAY_API_HTTP_ERROR");
    expect((error as ReplayApiError).status).toBe(502);
  });
});
