import { describe, expect, it } from "vitest";

import {
  journeyTimeAt,
  replayPositionAt,
  highlightAt,
  type ReplayPlan,
  type ReplaySegment,
  type JourneyNode,
} from "../index.js";

/**
 * Replay timeline review (V8 / acceptance "状态节点对齐误差 ≤ 5 秒"):
 * the browser maps a replay playback position back onto the journey
 * timeline and highlights the state/event node it corresponds to. The
 * mapping is piecewise-linear per segment; the alignment error against an
 * independently computed ground truth must stay within 5 seconds everywhere,
 * including inside crossfade overlap regions.
 */

interface SegmentSpec {
  readonly journeySpanSec: number;
  readonly bucket: string;
}

const buildPlan = (
  specs: readonly SegmentSpec[],
  crossfadeSec = 5,
): { plan: ReplayPlan; nodes: readonly JourneyNode[] } => {
  // Independent ground-truth assembly (deliberately NOT the planner):
  // proportional compression aiming at ~2250s, per-segment clamps.
  const totalJourney = specs.reduce((sum, s) => sum + s.journeySpanSec, 0);
  const scale = 2_250 / totalJourney;
  const segments: ReplaySegment[] = [];
  let journeyCursor = 0;
  let replayCursor = 0;
  for (const [index, spec] of specs.entries()) {
    const duration = Math.min(
      120,
      Math.max(60, Math.round(spec.journeySpanSec * scale)),
    );
    segments.push({
      segmentId: `seg_${String(index + 1).padStart(4, "0")}`,
      bucket: spec.bucket,
      trackId: `trk-${index}`,
      clipStartSec: 0,
      replayStartSec: replayCursor,
      durationSec: duration,
      crossfadeSec: crossfadeSec,
      journeyStartSec: journeyCursor,
      journeyEndSec: journeyCursor + spec.journeySpanSec,
    });
    journeyCursor += spec.journeySpanSec;
    replayCursor += duration - crossfadeSec;
  }
  const last = segments[segments.length - 1]!;
  const plan: ReplayPlan = {
    replayId: "rpl_groundtruth",
    journeyId: "jrn_groundtruth",
    generatedAt: "2026-10-20T21:00:00.000Z",
    totalDurationSec: last.replayStartSec + last.durationSec,
    segments,
  };

  const nodes: JourneyNode[] = [];
  let nodeJourney = 0;
  for (const spec of specs) {
    nodes.push({
      nodeId: `node_${nodes.length}`,
      type: "flow_entered",
      offsetSec: nodeJourney + Math.floor(spec.journeySpanSec / 2),
      evidenceEventIds: [`e${nodes.length}`],
    });
    nodeJourney += spec.journeySpanSec;
  }
  return { plan, nodes };
};

/** Independent reference mapping: piecewise linear inside each segment. */
const groundTruthJourneyTime = (plan: ReplayPlan, pos: number): number => {
  const clamped = Math.min(Math.max(pos, 0), plan.totalDurationSec);
  let chosen = plan.segments[0]!;
  for (const segment of plan.segments) {
    if (segment.replayStartSec <= clamped) {
      chosen = segment;
    }
  }
  const journeySpan = chosen.journeyEndSec - chosen.journeyStartSec;
  return (
    chosen.journeyStartSec +
    ((clamped - chosen.replayStartSec) / chosen.durationSec) * journeySpan
  );
};

const EIGHT_HOURS: readonly SegmentSpec[] = [
  { journeySpanSec: 1_800, bucket: "self:low:low" },
  { journeySpanSec: 3_600, bucket: "self:high:low" },
  { journeySpanSec: 2_400, bucket: "self:high:low" },
  { journeySpanSec: 1_200, bucket: "self:medium:high" },
  { journeySpanSec: 1_800, bucket: "self:medium:low" },
  { journeySpanSec: 900, bucket: "self:low:low" },
  { journeySpanSec: 3_600, bucket: "self:high:medium" },
  { journeySpanSec: 1_200, bucket: "self:medium:low" },
  { journeySpanSec: 1_800, bucket: "self:low:low" },
  { journeySpanSec: 600, bucket: "self:low:medium" },
  { journeySpanSec: 1_500, bucket: "self:medium:medium" },
  { journeySpanSec: 4_500, bucket: "self:high:low" },
];

describe("replay timeline mapping", () => {
  it("maps replay positions to journey time within 5 seconds everywhere", () => {
    const { plan } = buildPlan(EIGHT_HOURS);
    expect(plan.totalDurationSec).toBeGreaterThan(600);
    let previous = -1;
    for (let pos = 0; pos <= plan.totalDurationSec; pos += 1) {
      const mapped = journeyTimeAt(plan, pos);
      expect(
        Math.abs(mapped - groundTruthJourneyTime(plan, pos)),
      ).toBeLessThanOrEqual(5);
      // Monotonic: replaying forward never rewinds the journey cursor.
      expect(mapped).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = mapped;
    }
    // Endpoints.
    expect(journeyTimeAt(plan, 0)).toBeCloseTo(0, 6);
    const totalJourney = EIGHT_HOURS.reduce(
      (sum, s) => sum + s.journeySpanSec,
      0,
    );
    expect(journeyTimeAt(plan, plan.totalDurationSec)).toBeCloseTo(
      totalJourney,
      0,
    );
    // Out-of-range positions clamp.
    expect(journeyTimeAt(plan, plan.totalDurationSec + 500)).toBeCloseTo(
      totalJourney,
      0,
    );
    expect(journeyTimeAt(plan, -100)).toBeCloseTo(0, 6);
  });

  it("aligns highlighted nodes within 5 seconds (acceptance gate)", () => {
    const { plan, nodes } = buildPlan(EIGHT_HOURS);
    for (const node of nodes) {
      const pos = replayPositionAt(plan, node.offsetSec);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(plan.totalDurationSec);
      const roundTrip = journeyTimeAt(plan, pos);
      expect(Math.abs(roundTrip - node.offsetSec)).toBeLessThanOrEqual(5);
    }
  });

  it("highlights the segment and nodes matching the current position", () => {
    const { plan, nodes } = buildPlan(EIGHT_HOURS);
    const totalJourney = EIGHT_HOURS.reduce(
      (sum, s) => sum + s.journeySpanSec,
      0,
    );
    for (const node of nodes) {
      const pos = replayPositionAt(plan, node.offsetSec);
      const highlight = highlightAt(plan, nodes, pos);
      expect(highlight.nodeIds).toContain(node.nodeId);
      // The highlighted segment's journey span contains the node offset.
      const segment = plan.segments.find(
        (candidate) => candidate.segmentId === highlight.segmentId,
      );
      expect(segment).toBeDefined();
      expect(node.offsetSec).toBeGreaterThanOrEqual(
        segment!.journeyStartSec - 5,
      );
      expect(node.offsetSec).toBeLessThanOrEqual(segment!.journeyEndSec + 5);
    }

    // A node at the exact journey start and exact end also aligns.
    const boundaryNodes: readonly JourneyNode[] = [
      {
        nodeId: "node_start",
        type: "rest_started",
        offsetSec: 0,
        evidenceEventIds: ["e-start"],
      },
      {
        nodeId: "node_end",
        type: "rest_started",
        offsetSec: totalJourney,
        evidenceEventIds: ["e-end"],
      },
    ];
    for (const node of boundaryNodes) {
      const pos = replayPositionAt(plan, node.offsetSec);
      expect(
        Math.abs(journeyTimeAt(plan, pos) - node.offsetSec),
      ).toBeLessThanOrEqual(5);
      expect(highlightAt(plan, boundaryNodes, pos).nodeIds).toContain(
        node.nodeId,
      );
    }
  });

  it("keeps alignment inside crossfade overlap regions", () => {
    const { plan, nodes } = buildPlan(EIGHT_HOURS, 8);
    // Sample the overlap windows densely: positions that sit in two clips
    // at once. Whichever segment the mapping picks, the round trip through
    // the journey timeline must stay within 5 seconds.
    for (const segment of plan.segments) {
      const overlapStart = segment.replayStartSec;
      const overlapEnd = segment.replayStartSec + 8;
      for (let pos = overlapStart; pos <= overlapEnd; pos += 0.5) {
        const mapped = journeyTimeAt(plan, pos);
        expect(
          Math.abs(mapped - groundTruthJourneyTime(plan, pos)),
        ).toBeLessThanOrEqual(5);
      }
    }
    void nodes;
  });
});
