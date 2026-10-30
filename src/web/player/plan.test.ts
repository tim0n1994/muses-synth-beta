import { describe, expect, it } from "vitest";

import type { PlaybackPlan, PlanTrack } from "./contracts.js";
import { buildTimeline, interpretAt, validatePlan } from "./plan.js";

function track(overrides: Partial<PlanTrack> = {}): PlanTrack {
  return {
    trackId: "t-1",
    url: "/library/tracks/t-1.opus",
    title: "Pulse Study",
    artist: "A. Composer",
    license: "CC-BY 4.0",
    licenseUrl: "https://example.org/licenses/cc-by-4.0",
    durationMs: 180_000,
    ...overrides,
  };
}

function plan(): PlaybackPlan {
  return {
    steps: [
      { track: track(), crossfadeMs: 4_000 },
      {
        track: track({ trackId: "t-2", url: "/library/tracks/t-2.opus" }),
        crossfadeMs: 4_000,
      },
      {
        track: track({ trackId: "t-3", url: "/library/tracks/t-3.opus" }),
        crossfadeMs: 0,
      },
    ],
  };
}

/** Immutable step replacement for building invalid plans in tests. */
function withStep(
  base: PlaybackPlan,
  index: number,
  patch: { track?: PlanTrack; crossfadeMs?: number },
): PlaybackPlan {
  return {
    steps: base.steps.map((step, i) =>
      i === index ? { ...step, ...patch } : step,
    ),
  };
}

describe("plan validation", () => {
  it("accepts a well-formed plan", () => {
    expect(validatePlan(plan())).toEqual([]);
  });

  it("rejects steps without tracks", () => {
    const bad = withStep(plan(), 0, {
      track: null as unknown as PlanTrack,
    });
    expect(validatePlan(bad)).toContainEqual(expect.stringContaining("track"));
  });

  it("rejects absolute or cross-origin URLs (static library only)", () => {
    const bad = withStep(plan(), 1, {
      track: track({ url: "https://cdn.example.com/t-2.opus" }),
    });
    expect(validatePlan(bad).some((e) => e.includes("t-2"))).toBe(true);

    const bad2 = withStep(plan(), 1, {
      track: track({ url: "//cdn.example.com/t-2.opus" }),
    });
    expect(validatePlan(bad2).length).toBeGreaterThan(0);

    const bad3 = withStep(plan(), 1, {
      track: track({ url: "/api/transcode/t-2" }),
    });
    expect(validatePlan(bad3).some((e) => e.includes("t-2"))).toBe(true);
  });

  it("rejects non-positive durations and out-of-range crossfades", () => {
    const bad = withStep(plan(), 0, { track: track({ durationMs: 0 }) });
    expect(validatePlan(bad).length).toBeGreaterThan(0);

    const bad2 = withStep(plan(), 1, { crossfadeMs: 180_000 });
    expect(validatePlan(bad2).length).toBeGreaterThan(0);
  });
});

describe("timeline construction", () => {
  it("places each transition so the overlap ends exactly when the next track ends its predecessor", () => {
    const timeline = buildTimeline(plan());
    expect(timeline).toHaveLength(3);
    // t=0 start, first track 180s long, 4s overlap into track 2.
    expect(timeline[0]!.startMs).toBe(0);
    expect(timeline[1]!.startMs).toBe(180_000 - 4_000);
    // second step starts at 176s, runs 180s, hard cut (crossfade 0) into step 3.
    expect(timeline[2]!.startMs).toBe(176_000 + 180_000);
  });

  it("marks each step with its overlap duration", () => {
    const timeline = buildTimeline(plan());
    expect(timeline[1]!.overlapMs).toBe(4_000);
    expect(timeline[2]!.overlapMs).toBe(0);
  });
});

describe("plan interpretation at wall-clock offsets", () => {
  it("reports the playing step before any overlap", () => {
    const cursor = interpretAt(buildTimeline(plan()), 10_000);
    expect(cursor.stepIndex).toBe(0);
    expect(cursor.phase).toBe("playing");
    expect(cursor.msUntilNextTransition).toBe(180_000 - 4_000 - 10_000);
  });

  it("reports crossfading inside the overlap window", () => {
    const cursor = interpretAt(buildTimeline(plan()), 178_000);
    expect(cursor.stepIndex).toBe(0);
    expect(cursor.phase).toBe("crossfading");
    expect(cursor.crossfadeRemainingMs).toBe(180_000 - 178_000);
  });

  it("follows into later steps including hard cuts", () => {
    const cursor = interpretAt(buildTimeline(plan()), 500_000);
    expect(cursor.stepIndex).toBe(2);
    expect(cursor.phase).toBe("playing");
  });

  it("reports ended past the last track", () => {
    const timeline = buildTimeline(plan());
    const total = timeline[2]!.startMs + 180_000;
    const cursor = interpretAt(timeline, total + 1);
    expect(cursor.phase).toBe("ended");
  });
});
