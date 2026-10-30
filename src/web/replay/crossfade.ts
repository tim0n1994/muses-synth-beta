import type { ReplayPlan, ReplaySegment } from "./types.js";

/**
 * Browser-side crossfade for Replay v0 (V3): two audio decks alternate
 * clips; during the planned overlap the outgoing deck follows the cosine
 * (equal-power) fade-out while the incoming deck follows the sine fade-in,
 * so gainA^2 + gainB^2 stays at unity — no level dip, no click, no gap.
 * Audio itself comes from static library files over HTTP Range requests;
 * the server never transcodes or mixes (V8).
 *
 * The tests in __tests__/crossfade.test.ts verify the automated
 * equivalents of "no audible gap/pop" (equal-power curve, gapless
 * schedule, non-silent instantaneous power) — they are equivalent
 * evidence, not a perceptual test.
 */

export type DeckName = "A" | "B";

export interface DeckClip {
  readonly segmentId: string;
  readonly deck: DeckName;
  /** Absolute replay time this clip starts (including its fade-in tail). */
  readonly startAtSec: number;
  readonly clipStartSec: number;
  readonly durationSec: number;
  /** Length of the fade-in from the previous crossfade (0 for the first). */
  readonly fadeInSec: number;
  /** Length of the fade-out into the next segment (0 for the last). */
  readonly fadeOutSec: number;
}

/** Equal-power pair for a normalized fade position x in [0, 1]. */
export const equalPowerCurve = (x: number): [number, number] => {
  const clamped = Math.min(Math.max(x, 0), 1);
  if (clamped <= 0) {
    return [1, 0];
  }
  if (clamped >= 1) {
    return [0, 1];
  }
  return [Math.cos(clamped * (Math.PI / 2)), Math.sin(clamped * (Math.PI / 2))];
};

export const deckSchedule = (plan: ReplayPlan): readonly DeckClip[] =>
  plan.segments.map((segment: ReplaySegment, index) => ({
    segmentId: segment.segmentId,
    deck: index % 2 === 0 ? "A" : "B",
    startAtSec: segment.replayStartSec,
    clipStartSec: segment.clipStartSec,
    durationSec: segment.durationSec,
    fadeInSec: index === 0 ? 0 : plan.segments[index - 1]!.crossfadeSec,
    fadeOutSec: segment.crossfadeSec,
  }));

/** True when consecutive clips do not overlap by exactly their crossfade. */
export const hasScheduleGap = (schedule: readonly DeckClip[]): boolean => {
  for (let index = 1; index < schedule.length; index += 1) {
    const previous = schedule[index - 1]!;
    const current = schedule[index]!;
    const expected =
      previous.startAtSec + previous.durationSec - previous.fadeOutSec;
    if (Math.abs(current.startAtSec - expected) > 1e-6) {
      return true;
    }
  }
  return false;
};

const gainOf = (
  clip: DeckClip,
  positionSec: number,
  previousCrossfade: number,
): number => {
  const start = clip.startAtSec;
  const end = clip.startAtSec + clip.durationSec;
  if (positionSec < start - 1e-9 || positionSec > end + 1e-9) {
    return 0;
  }
  const fadeIn = Math.min(clip.fadeInSec, previousCrossfade);
  if (fadeIn > 0 && positionSec < start + fadeIn) {
    return equalPowerCurve((positionSec - start) / fadeIn)[1];
  }
  const fadeOut = clip.fadeOutSec;
  if (fadeOut > 0 && positionSec > end - fadeOut) {
    return equalPowerCurve((positionSec - (end - fadeOut)) / fadeOut)[0];
  }
  return 1;
};

/**
 * Summed squared gain of all decks at a replay position: 1.0 during single
 * clip playback, ~1.0 through every equal-power overlap. Dips below ~0.97
 * would be audible level drops; near 0 is a dropout.
 */
export const combinedPowerAt = (
  plan: ReplayPlan,
  positionSec: number,
): number => {
  let power = 0;
  for (const [index, segment] of plan.segments.entries()) {
    const previousCrossfade =
      index === 0 ? 0 : plan.segments[index - 1]!.crossfadeSec;
    const clip: DeckClip = {
      segmentId: segment.segmentId,
      deck: index % 2 === 0 ? "A" : "B",
      startAtSec: segment.replayStartSec,
      clipStartSec: segment.clipStartSec,
      durationSec: segment.durationSec,
      fadeInSec: previousCrossfade,
      fadeOutSec: segment.crossfadeSec,
    };
    const gain = gainOf(clip, positionSec, previousCrossfade);
    power += gain * gain;
  }
  return power;
};
