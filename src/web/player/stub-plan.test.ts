import { describe, expect, it } from "vitest";

import type { PlanTrack } from "./contracts.js";
import { createLocalStubPlanSource } from "./stub-plan.js";
import { validatePlan } from "./plan.js";

const tracks: readonly PlanTrack[] = [
  {
    trackId: "s-1",
    url: "/library/tracks/s-1.opus",
    title: "Focus Layer",
    artist: "CC Artist",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    durationMs: 120_000,
  },
  {
    trackId: "s-2",
    url: "/library/tracks/s-2.opus",
    title: "Calm Layer",
    artist: "CC Artist",
    license: "CC-BY 4.0",
    licenseUrl: "https://example.org/cc-by",
    durationMs: 150_000,
  },
];

describe("local stub plan source", () => {
  it("resolves a valid plan from a static track list", async () => {
    const source = createLocalStubPlanSource(tracks);
    const plan = await source.load();
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.steps.map((s) => s.track.trackId)).toEqual(["s-1", "s-2"]);
    expect(plan.steps[0]!.crossfadeMs).toBeGreaterThan(0);
  });

  it("exposes a stub notice so callers can label it in the UI", () => {
    const source = createLocalStubPlanSource(tracks);
    expect(source.kind).toBe("local-stub");
  });

  it("reuses the same plan instance until a reload is requested", async () => {
    const source = createLocalStubPlanSource(tracks);
    const first = await source.load();
    const second = await source.load();
    expect(second).toBe(first);
  });
});
