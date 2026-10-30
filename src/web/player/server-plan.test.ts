import { describe, expect, it } from "vitest";

import { createServerPlanSource } from "./server-plan.js";

const planDto = {
  steps: [
    {
      track: {
        trackId: "t1",
        url: "/library/self/self_mid_mid/t1.opus",
        title: "Title",
        artist: "Artist",
        license: "CC-BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        durationMs: 180_000,
      },
      crossfadeMs: 6000,
    },
  ],
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createServerPlanSource", () => {
  it("loads and validates a well-formed plan", async () => {
    const source = createServerPlanSource({
      fetchFn: async () => jsonResponse(planDto),
    });
    expect(source.kind).toBe("server-api");
    const plan = await source.load();
    expect(plan.steps[0]!.track.trackId).toBe("t1");
    expect(plan.steps[0]!.crossfadeMs).toBe(6000);
  });

  it("requests the plan API path with JSON accept", async () => {
    let seenUrl = "";
    let seenAccept = "";
    const source = createServerPlanSource({
      fetchFn: async (input, init) => {
        seenUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        seenAccept = String(new Headers(init?.headers).get("accept"));
        return jsonResponse(planDto);
      },
    });
    await source.load();
    expect(seenUrl).toBe("/api/v1/self-track/plan");
    expect(seenAccept).toBe("application/json");
  });

  it("surfaces the HTTP status when the switch is off (404)", async () => {
    const source = createServerPlanSource({
      fetchFn: async () =>
        jsonResponse(
          { error: { code: "NOT_FOUND", message: "Route not found" } },
          404,
        ),
    });
    await expect(source.load()).rejects.toThrow(
      "Self-track plan unavailable (404)",
    );
  });

  it("surfaces the empty-library state (503)", async () => {
    const source = createServerPlanSource({
      fetchFn: async () =>
        jsonResponse(
          {
            error: {
              code: "SELF_TRACK_LIBRARY_EMPTY",
              message: "The pilot library has not been ingested.",
            },
          },
          503,
        ),
    });
    await expect(source.load()).rejects.toThrow(
      "Self-track plan unavailable (503)",
    );
  });

  it("rejects malformed payloads before they reach the engine", async () => {
    const source = createServerPlanSource({
      fetchFn: async () => jsonResponse({ steps: [{ track: {} }] }),
    });
    await expect(source.load()).rejects.toThrow("Plan step was malformed");
  });

  it("rejects plans that fail client-side URL validation", async () => {
    const source = createServerPlanSource({
      fetchFn: async () =>
        jsonResponse({
          steps: [
            {
              track: {
                ...planDto.steps[0]!.track,
                url: "https://evil.example/t1.opus",
              },
              crossfadeMs: 6000,
            },
          ],
        }),
    });
    await expect(source.load()).rejects.toThrow(
      "Plan rejected by client validation",
    );
  });
});
