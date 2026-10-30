import type { JourneyNode, ReplayPlan, ReplaySegment } from "./types.js";

/**
 * Timeline review (V8): mapping a replay playback position back onto the
 * journey so the UI can highlight the state segment and event nodes the
 * listener is "at". The mapping is piecewise-linear per segment — within a
 * segment, journey time advances proportionally to replay time. Positions
 * inside a crossfade overlap belong to the INCOMING segment (the one with
 * the greater replayStartSec), so the highlight switches exactly when the
 * new clip starts. Round-trip alignment error is bounded by construction
 * and asserted <= 5s by __tests__/timeline.test.ts (the acceptance gate).
 */

const EPSILON = 1e-9;

/** The segment active at a replay position (incoming wins in overlaps). */
export const segmentAt = (
  plan: ReplayPlan,
  positionSec: number,
): ReplaySegment => {
  const segments = plan.segments;
  let chosen = segments[0]!;
  for (const segment of segments) {
    if (segment.replayStartSec <= positionSec + EPSILON) {
      chosen = segment;
    }
  }
  return chosen;
};

/** The segment whose journey span contains a journey offset. */
export const segmentCovering = (
  plan: ReplayPlan,
  journeyOffsetSec: number,
): ReplaySegment => {
  const segments = plan.segments;
  let chosen = segments[0]!;
  for (const segment of segments) {
    if (segment.journeyStartSec <= journeyOffsetSec + EPSILON) {
      chosen = segment;
    }
  }
  return chosen;
};

/** Maps a replay position to the journey timestamp it represents. */
export const journeyTimeAt = (
  plan: ReplayPlan,
  positionSec: number,
): number => {
  const total = plan.totalDurationSec;
  const clamped = Math.min(Math.max(positionSec, 0), total);
  const segment = segmentAt(plan, clamped);
  const journeySpan = segment.journeyEndSec - segment.journeyStartSec;
  const ratio = (clamped - segment.replayStartSec) / segment.durationSec;
  return (
    segment.journeyStartSec + Math.min(Math.max(ratio, 0), 1) * journeySpan
  );
};

/** Inverse mapping: the replay position that represents a journey time. */
export const replayPositionAt = (
  plan: ReplayPlan,
  journeyOffsetSec: number,
): number => {
  const totalJourney = plan.segments.reduce(
    (span, segment) => Math.max(span, segment.journeyEndSec),
    0,
  );
  const clamped = Math.min(Math.max(journeyOffsetSec, 0), totalJourney);
  const segment = segmentCovering(plan, clamped);
  const journeySpan = Math.max(
    segment.journeyEndSec - segment.journeyStartSec,
    EPSILON,
  );
  const ratio = (clamped - segment.journeyStartSec) / journeySpan;
  return (
    segment.replayStartSec +
    Math.min(Math.max(ratio, 0), 1) * segment.durationSec
  );
};

export interface ReplayHighlight {
  readonly segmentId: string;
  readonly bucket: string;
  readonly nodeIds: readonly string[];
}

/**
 * What the timeline UI highlights at a replay position: the active segment
 * plus every node whose journey offset falls inside that segment's journey
 * span (boundary nodes count for both neighbors; the end node counts for
 * the last segment).
 */
export const highlightAt = (
  plan: ReplayPlan,
  nodes: readonly JourneyNode[],
  positionSec: number,
): ReplayHighlight => {
  const segment = segmentAt(plan, positionSec);
  const isLast = plan.segments[plan.segments.length - 1] === segment;
  const nodeIds = nodes
    .filter((node) => {
      const afterStart = node.offsetSec >= segment.journeyStartSec - EPSILON;
      const beforeEnd = isLast
        ? node.offsetSec <= segment.journeyEndSec + EPSILON
        : node.offsetSec < segment.journeyEndSec - EPSILON;
      return afterStart && beforeEnd;
    })
    .map((node) => node.nodeId);
  return { segmentId: segment.segmentId, bucket: segment.bucket, nodeIds };
};
