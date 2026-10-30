import type { PlaybackPlan, PlanStep, PlanTrack } from "./contracts.js";

/**
 * Pure playback-plan interpretation. Everything here is deterministic and
 * side-effect free so transition timing can be tested without audio.
 */

const LIBRARY_URL_PATTERN = /^\/library\/[A-Za-z0-9._\-/]+$/;

export interface PlanProblem {
  readonly stepIndex: number;
  readonly trackId: string | null;
  readonly message: string;
}

/** Structural + URL-contract validation. Returns one message per problem. */
export function validatePlan(plan: PlaybackPlan): string[] {
  const problems: PlanProblem[] = [];
  const { steps } = plan;
  if (steps.length === 0) {
    return ["plan has no steps"];
  }
  steps.forEach((step: PlanStep, index: number) => {
    const track: PlanTrack | null = step?.track ?? null;
    const trackId = track?.trackId ?? null;
    if (track === null || typeof track !== "object") {
      problems.push({ stepIndex: index, trackId, message: "missing track" });
      return;
    }
    if (
      typeof track.trackId !== "string" ||
      track.trackId.length === 0 ||
      typeof track.title !== "string" ||
      typeof track.artist !== "string" ||
      typeof track.license !== "string" ||
      typeof track.licenseUrl !== "string"
    ) {
      problems.push({
        stepIndex: index,
        trackId,
        message: "incomplete track metadata",
      });
    }
    if (typeof track.url !== "string" || !LIBRARY_URL_PATTERN.test(track.url)) {
      problems.push({
        stepIndex: index,
        trackId,
        message: `track url must be a same-origin static path under /library/ (got ${String(track.url)})`,
      });
    }
    if (
      typeof track.durationMs !== "number" ||
      !Number.isFinite(track.durationMs) ||
      track.durationMs <= 0
    ) {
      problems.push({
        stepIndex: index,
        trackId,
        message: "durationMs must be a positive number",
      });
    }
    if (
      typeof step.crossfadeMs !== "number" ||
      !Number.isFinite(step.crossfadeMs) ||
      step.crossfadeMs < 0
    ) {
      problems.push({
        stepIndex: index,
        trackId,
        message: "crossfadeMs must be a non-negative number",
      });
    }
  });
  // Crossfade bounds need valid neighbours, checked in a second pass.
  for (let i = 1; i < steps.length; i += 1) {
    const previous = steps[i - 1]?.track;
    const current = steps[i]?.track;
    const crossfadeMs = steps[i]?.crossfadeMs ?? -1;
    if (
      previous !== null &&
      previous !== undefined &&
      current !== null &&
      current !== undefined &&
      typeof previous.durationMs === "number" &&
      typeof current.durationMs === "number" &&
      crossfadeMs >= Math.min(previous.durationMs, current.durationMs)
    ) {
      problems.push({
        stepIndex: i,
        trackId: current.trackId ?? null,
        message: `crossfadeMs ${crossfadeMs} must stay shorter than both neighbouring tracks`,
      });
    }
  }
  return problems.map(
    (p) =>
      `step ${p.stepIndex}${p.trackId === null ? "" : ` (${p.trackId})`}: ${p.message}`,
  );
}

const SELF_BUCKET_IN_URL =
  /^\/library\/self\/(self_(?:slow|mid|fast)_(?:low|mid|high))\//;

/**
 * The V2 signature bucket a plan targets, read off the first track's static
 * URL (`/library/self/self_<pace>_<energy>/<id>.opus`). Server plans carry
 * the bucket in every track URL; the mid-playback refresh loop uses this to
 * decide whether the pulse has moved to a NEW bucket — the only change that
 * restarts playback — so a same-bucket seed re-roll never interrupts the
 * music. Returns null for URLs without a bucket (stubs, foreign shapes).
 */
export function planSignatureBucket(plan: PlaybackPlan): string | null {
  const url = plan.steps[0]?.track.url ?? "";
  const match = SELF_BUCKET_IN_URL.exec(url);
  return match === null ? null : match[1]!;
}

/** A step placed on the absolute plan timeline (ms since plan start). */
export interface TimelineStep {
  readonly stepIndex: number;
  readonly startMs: number;
  readonly endMs: number;
  /** Overlap with the previous step (0 for the first / hard cuts). */
  readonly overlapMs: number;
}

export function buildTimeline(plan: PlaybackPlan): readonly TimelineStep[] {
  const timeline: TimelineStep[] = [];
  let cursor = 0;
  plan.steps.forEach((step, index) => {
    const overlapMs = index === 0 ? 0 : step.crossfadeMs;
    const startMs = index === 0 ? 0 : cursor - overlapMs;
    const endMs = startMs + step.track.durationMs;
    timeline.push({ stepIndex: index, startMs, endMs, overlapMs });
    cursor = endMs;
  });
  return timeline;
}

export type PlanPhase = "playing" | "crossfading" | "ended";

export interface PlanCursor {
  readonly stepIndex: number;
  readonly phase: PlanPhase;
  readonly crossfadeRemainingMs: number | undefined;
  /** ms from `atMs` until the next transition starts (or the plan ends). */
  readonly msUntilNextTransition: number;
}

export function interpretAt(
  timeline: readonly TimelineStep[],
  atMs: number,
): PlanCursor {
  const last = timeline[timeline.length - 1];
  if (last === undefined) {
    throw new Error("interpretAt needs a non-empty timeline.");
  }
  if (atMs >= last.endMs) {
    return {
      stepIndex: last.stepIndex,
      phase: "ended",
      crossfadeRemainingMs: undefined,
      msUntilNextTransition: 0,
    };
  }
  // The current step is the LAST one that has started: inside an overlap
  // window the next step has already started, but playback is still led by
  // the outgoing track, so report that step as "crossfading".
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const step = timeline[i]!;
    if (atMs < step.startMs) {
      continue;
    }
    if (i > 0 && step.overlapMs > 0) {
      const outgoing = timeline[i - 1]!;
      if (atMs < outgoing.endMs) {
        return {
          stepIndex: outgoing.stepIndex,
          phase: "crossfading",
          crossfadeRemainingMs: outgoing.endMs - atMs,
          msUntilNextTransition: 0,
        };
      }
    }
    const next = timeline[i + 1];
    const boundary =
      next !== undefined && next.overlapMs > 0 ? next.startMs : step.endMs;
    return {
      stepIndex: step.stepIndex,
      phase: "playing",
      crossfadeRemainingMs: undefined,
      msUntilNextTransition: boundary - atMs,
    };
  }
  // Unreachable when atMs < last.endMs, but keeps the return total.
  return {
    stepIndex: last.stepIndex,
    phase: "ended",
    crossfadeRemainingMs: undefined,
    msUntilNextTransition: 0,
  };
}
