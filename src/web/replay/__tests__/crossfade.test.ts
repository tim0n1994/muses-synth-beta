import { describe, expect, it } from "vitest";

import {
  combinedPowerAt,
  deckSchedule,
  equalPowerCurve,
  hasScheduleGap,
  type ReplayPlan,
  type ReplaySegment,
} from "../index.js";

/**
 * Browser crossfade for Replay v0 (V3/V8: browser-side mixing, static audio
 * files + HTTP Range, zero server transcoding).
 *
 * The claim "no audible gap or click" is verified here by its automated
 * equivalents (honestly labeled — this is not a perceptual test):
 *   - equal-power curves: gainA^2 + gainB^2 stays ~1 through the fade, so
 *     perceived loudness is constant and the curve never collapses to zero
 *   - no scheduling gaps: every pair of consecutive clips overlaps by
 *     exactly the planned crossfade
 *   - at every instant at least one deck carries signal >= 0.05
 */

const plan = (crossfades: readonly number[]): ReplayPlan => {
  const segments: ReplaySegment[] = [];
  let replayCursor = 0;
  for (const [index, crossfade] of crossfades.entries()) {
    const durationSec = 100 + (index % 2) * 20;
    segments.push({
      segmentId: `seg_${index}`,
      bucket: "self:high:low",
      trackId: `trk-${index % 3}`,
      clipStartSec: 10,
      replayStartSec: replayCursor,
      durationSec,
      crossfadeSec: crossfade,
      journeyStartSec: index * 3_600,
      journeyEndSec: (index + 1) * 3_600,
    });
    replayCursor += durationSec - crossfade;
  }
  const last = segments[segments.length - 1]!;
  return {
    replayId: "rpl_crossfade",
    journeyId: "jrn_crossfade",
    generatedAt: "2026-10-20T21:00:00.000Z",
    totalDurationSec: last.replayStartSec + last.durationSec,
    segments,
  };
};

describe("equal-power crossfade curves", () => {
  it("keeps the summed power at unity and never touches double-zero", () => {
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const [aGain, bGain] = equalPowerCurve(x);
      expect(aGain).toBeGreaterThanOrEqual(0);
      expect(aGain).toBeLessThanOrEqual(1);
      expect(bGain).toBeGreaterThanOrEqual(0);
      expect(bGain).toBeLessThanOrEqual(1);
      expect(aGain * aGain + bGain * bGain).toBeGreaterThanOrEqual(0.99);
      expect(aGain * aGain + bGain * bGain).toBeLessThanOrEqual(1.01);
      expect(Math.max(aGain, bGain)).toBeGreaterThanOrEqual(Math.SQRT1_2);
    }
    expect(equalPowerCurve(0)).toEqual([1, 0]);
    expect(equalPowerCurve(1)).toEqual([0, 1]);
  });
});

describe("replay deck schedule", () => {
  it("alternates two decks with fade envelopes matching the plan", () => {
    const schedule = deckSchedule(plan([4, 8, 4, 0]));
    expect(schedule.length).toBe(4);
    expect(schedule[0]?.deck).toBe("A");
    expect(schedule[1]?.deck).toBe("B");
    expect(schedule[2]?.deck).toBe("A");
    expect(schedule[3]?.deck).toBe("B");
    // First clip fades in from silence, last clip fades out to silence.
    expect(schedule[0]?.fadeInSec).toBe(0);
    expect(schedule[3]?.fadeOutSec).toBe(0);
    // Interior fades match the planned crossfades: clip 1 fades in over
    // clip 0's crossfade (4s) and out over its own (8s).
    expect(schedule[1]?.fadeInSec).toBe(4);
    expect(schedule[1]?.fadeOutSec).toBe(8);
  });

  it("has no scheduling gaps between consecutive clips", () => {
    const instance = plan([4, 8, 4, 0]);
    expect(hasScheduleGap(deckSchedule(instance))).toBe(false);
    // A broken plan (crossfade larger than the overlap) must be detected.
    const broken: ReplayPlan = {
      ...instance,
      segments: instance.segments.map((segment, index) => ({
        ...segment,
        replayStartSec:
          index === 1
            ? segment.replayStartSec + 2 // a 2s hole before clip 2
            : segment.replayStartSec,
      })),
    };
    expect(hasScheduleGap(deckSchedule(broken))).toBe(true);
  });

  it("keeps combined power continuous across every transition", () => {
    const instance = plan([4, 8, 6, 4, 8, 0]);
    for (let pos = 0; pos <= instance.totalDurationSec; pos += 0.25) {
      const power = combinedPowerAt(instance, pos);
      expect(power).toBeLessThanOrEqual(1.03);
      // During pure single-clip playback power is exactly 1; through fades
      // the equal-power pair sums to ~1. Anything below 0.97 would be an
      // audible dip; anything near 0 is a dropout.
      expect(power).toBeGreaterThanOrEqual(0.97);
    }
  });
});
