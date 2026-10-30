import { createHash } from "node:crypto";

import {
  selfTrackBucket,
  type JourneySnapshot,
  type ReplayPlan,
  type ReplaySegment,
} from "./model.js";

/**
 * Replay v0 planner (V8): playlist + timestamps only. The journey is
 * segmented by state runs; each segment binds a 60-120s clip from a
 * self-track bucket (V2's nine pace x intensity buckets; mood modulates
 * the transitions, not the bucket); neighbors crossfade; the whole day
 * compresses to 30-45 minutes. Deterministic: identical snapshot +
 * catalog + generatedAt produce an identical plan.
 *
 * Frozen planner contract (mirrored in __tests__/replay-planner.test.ts):
 *   - journeys >= 45 min compress to total replay duration in [1800, 2700]
 *   - segment clip durations within [60, 120] (short sessions may shrink
 *     the floor proportionally, never below 10s)
 *   - crossfade: 4s between same-bucket neighbors, 8s across a bucket
 *     change or within 60s of a bug_valley node (negative-mood softening),
 *     capped at 40% of the shorter neighbor and always leaving at least
 *     1s of un-faded audio; 0 after the last segment
 *   - no-gap scheduling: replayStart[i+1] = replayStart[i] + duration[i]
 *     - crossfade[i]
 *   - journey coverage tiles [0, durationSec] exactly
 */

const TARGET_TOTAL_SEC = 2_250;
const MIN_TOTAL_SEC = 1_800;
const MAX_TOTAL_SEC = 2_700;
const SEGMENT_MAX_SEC = 120;
const SEGMENT_MIN_SEC = 60;
const SHORT_JOURNEY_SEC = 1_800;
const CROSSFADE_SAME = 4;
const CROSSFADE_CHANGE = 8;
const CROSSFADE_CAP_RATIO = 0.4;
const BUG_VALLEY_INFLUENCE_SEC = 60;
const MIN_RUN_SEC = 60;

export type TrackCatalog = Readonly<Record<string, readonly string[]>>;

export interface PlanReplayOptions {
  readonly catalog: TrackCatalog;
  readonly generatedAt: string;
  /**
   * Re-render counter (Round-2 defect #3): each re-render passes the number
   * of replays already stored for the journey. Rotation 0 (and the omitted
   * option) keep the frozen v0 seeds byte-identically; rotation r > 0
   * rotates both the track pick and the clip offset while explicitly
   * excluding the previous roll's pick, so a same-bucket re-roll never
   * lands back on the same offset (R1 report:305 measured the unexcluded
   * collision at 1/bucket-size — 1/4 with the production 4-track buckets).
   */
  readonly rotation?: number;
}

interface Run {
  startSec: number;
  endSec: number;
  bucket: string;
}

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

const hashIndex = (seed: string, modulo: number): number => {
  if (modulo <= 1) {
    return 0;
  }
  return parseInt(sha256Hex(seed).slice(0, 8), 16) % modulo;
};

const rotationSeed = (base: string, rotation: number): string =>
  rotation === 0 ? base : `${base}:${rotation}`;

/**
 * Deterministic pick that never equals the PREVIOUS ROTATION'S FINAL pick.
 * The chain is replayed from rotation 0 because an earlier roll's final
 * pick may itself have been bumped — comparing raw hashes lets a collision
 * slip through two rolls apart (caught by the rotation spec: seg 11 held
 * trk-a2 at rotations 1 and 2). O(rotation) recompute, deterministic.
 */
const pickWithAvoidance = (
  base: string,
  modulo: number,
  rotation: number,
): number => {
  if (modulo <= 1) {
    return 0;
  }
  let previous: number | null = null;
  let pick = 0;
  for (let step = 0; step <= rotation; step += 1) {
    pick = hashIndex(rotationSeed(base, step), modulo);
    if (previous !== null && pick === previous) {
      pick = (pick + 1) % modulo;
    }
    previous = pick;
  }
  return pick;
};

const spanOf = (run: Run): number => run.endSec - run.startSec;

const mergeSameBucket = (input: readonly Run[]): Run[] => {
  const merged: Run[] = [];
  for (const run of input) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.bucket === run.bucket) {
      last.endSec = run.endSec;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
};

/** Merge same-bucket neighbors and absorb sub-minute slivers. */
const normalizeRuns = (input: readonly Run[]): Run[] => {
  let runs = mergeSameBucket(input);
  // A sliver opening the journey folds into the next run (too short to
  // define a state of its own).
  if (runs.length > 1 && spanOf(runs[0]!) < MIN_RUN_SEC) {
    const [head, next, ...rest] = runs;
    runs = mergeSameBucket([{ ...next!, startSec: head!.startSec }, ...rest]);
  }
  // Interior slivers absorb into the previous run.
  const absorbed: Run[] = [];
  for (const run of runs) {
    const last = absorbed[absorbed.length - 1];
    if (last !== undefined && spanOf(run) < MIN_RUN_SEC) {
      last.endSec = run.endSec;
      continue;
    }
    absorbed.push({ ...run });
  }
  return mergeSameBucket(absorbed);
};

const runsFromSnapshot = (snapshot: JourneySnapshot): Run[] => {
  if (snapshot.samples.length === 0) {
    return [
      {
        startSec: 0,
        endSec: Math.max(snapshot.durationSec, 1),
        bucket: selfTrackBucket("low", "low"),
      },
    ];
  }
  const runs: Run[] = snapshot.samples.map((sample, index) => ({
    startSec: sample.offsetSec,
    endSec:
      index + 1 < snapshot.samples.length
        ? snapshot.samples[index + 1]!.offsetSec
        : snapshot.durationSec,
    bucket: selfTrackBucket(sample.pace, sample.intensity),
  }));
  runs[0]!.startSec = 0;
  return normalizeRuns(runs);
};

interface Piece {
  startSec: number;
  endSec: number;
  bucket: string;
}

/** Split long runs so no run's proportional share exceeds one 120s clip. */
const splitRuns = (runs: readonly Run[], compression: number): Piece[] => {
  const pieces: Piece[] = [];
  for (const run of runs) {
    const span = run.endSec - run.startSec;
    const share = span * compression;
    const count = Math.max(1, Math.ceil(share / SEGMENT_MAX_SEC));
    const base = Math.floor(span / count);
    const remainder = span % count;
    let cursor = run.startSec;
    for (let index = 0; index < count; index += 1) {
      const pieceSpan = base + (index < remainder ? 1 : 0);
      pieces.push({
        startSec: cursor,
        endSec: cursor + pieceSpan,
        bucket: run.bucket,
      });
      cursor += pieceSpan;
    }
  }
  return pieces;
};

const bugValleyOffsets = (snapshot: JourneySnapshot): readonly number[] =>
  snapshot.nodes
    .filter((node) => node.type === "bug_valley")
    .map((node) => node.offsetSec);

const crossfadeForBoundary = (
  currentBucket: string,
  nextBucket: string,
  boundarySec: number,
  bugValleys: readonly number[],
  capSec: number,
): number => {
  const base = currentBucket === nextBucket ? CROSSFADE_SAME : CROSSFADE_CHANGE;
  const nearValley = bugValleys.some(
    (offset) => Math.abs(boundarySec - offset) <= BUG_VALLEY_INFLUENCE_SEC,
  );
  const wanted = nearValley ? CROSSFADE_CHANGE : base;
  return Math.max(0, Math.min(wanted, capSec));
};

export const planReplay = (
  snapshot: JourneySnapshot,
  options: PlanReplayOptions,
): ReplayPlan => {
  const journeySec = Math.max(1, snapshot.durationSec);
  const needsCompression = journeySec > MAX_TOTAL_SEC;
  const compression = needsCompression ? TARGET_TOTAL_SEC / journeySec : 1;

  const segmentFloor =
    journeySec >= SHORT_JOURNEY_SEC
      ? SEGMENT_MIN_SEC
      : Math.max(10, Math.floor(journeySec / 3));

  let pieces = splitRuns(runsFromSnapshot(snapshot), compression);

  const durations = (): number[] =>
    pieces.map((piece) => {
      const raw = (piece.endSec - piece.startSec) * compression;
      return Math.min(SEGMENT_MAX_SEC, Math.max(segmentFloor, Math.round(raw)));
    });

  const crossfadesOf = (durationsList: readonly number[]): number[] =>
    durationsList.map((duration, index) => {
      if (index === durationsList.length - 1) {
        return 0;
      }
      const next = durationsList[index + 1]!;
      const shorter = Math.min(duration, next);
      const cap = Math.floor(CROSSFADE_CAP_RATIO * shorter);
      // Always leave at least 1s of un-faded audio on the shorter clip.
      const safeCap = Math.max(0, Math.min(cap, shorter - 1));
      const boundary = pieces[index + 1]!.startSec;
      return crossfadeForBoundary(
        pieces[index]!.bucket,
        pieces[index + 1]!.bucket,
        boundary,
        bugValleyOffsets(snapshot),
        safeCap,
      );
    });

  const totalOf = (
    durationsList: readonly number[],
    crossfadeList: readonly number[],
  ): number =>
    durationsList.reduce((sum, value) => sum + value, 0) -
    crossfadeList.reduce((sum, value) => sum + value, 0);

  let currentDurations = durations();
  let currentCrossfades = crossfadesOf(currentDurations);
  let currentTotal = totalOf(currentDurations, currentCrossfades);

  if (needsCompression) {
    // Deterministic correction loops (bounded; integer arithmetic only).
    // Under target: grow the smallest clips first, 5s at a time.
    for (
      let guard = 0;
      guard < 2_000 && currentTotal < MIN_TOTAL_SEC;
      guard += 1
    ) {
      const growable = currentDurations
        .map((duration, index) => ({ duration, index }))
        .filter((entry) => entry.duration < SEGMENT_MAX_SEC);
      if (growable.length === 0) {
        break;
      }
      growable.sort((a, b) => a.duration - b.duration || a.index - b.index);
      const target = growable[0]!;
      const room = SEGMENT_MAX_SEC - target.duration;
      const budget = MIN_TOTAL_SEC - currentTotal;
      const step = Math.min(5, room, Math.max(1, budget));
      currentDurations[target.index] = target.duration + step;
      currentCrossfades = crossfadesOf(currentDurations);
      currentTotal = totalOf(currentDurations, currentCrossfades);
    }
    // Over target: shave the largest clips first, 5s at a time, never below
    // the floor; if everything is at the floor, merge the smallest adjacent
    // pair and start over.
    for (
      let guard = 0;
      guard < 4_000 && currentTotal > MAX_TOTAL_SEC;
      guard += 1
    ) {
      const shrinkable = currentDurations
        .map((duration, index) => ({ duration, index }))
        .filter((entry) => entry.duration > segmentFloor);
      if (shrinkable.length > 0) {
        shrinkable.sort((a, b) => b.duration - a.duration || a.index - b.index);
        const target = shrinkable[0]!;
        const room = target.duration - segmentFloor;
        const excess = currentTotal - MAX_TOTAL_SEC;
        const step = Math.min(5, room, Math.max(1, excess));
        currentDurations[target.index] = target.duration - step;
      } else if (pieces.length > 2) {
        // Merge the adjacent pair with the smallest combined span.
        let bestIndex = 0;
        let bestSpan = Number.POSITIVE_INFINITY;
        for (let index = 0; index + 1 < pieces.length; index += 1) {
          const span = pieces[index + 1]!.endSec - pieces[index]!.startSec;
          if (span < bestSpan) {
            bestSpan = span;
            bestIndex = index;
          }
        }
        const merged: Piece = {
          startSec: pieces[bestIndex]!.startSec,
          endSec: pieces[bestIndex + 1]!.endSec,
          bucket: pieces[bestIndex]!.bucket,
        };
        pieces = [
          ...pieces.slice(0, bestIndex),
          merged,
          ...pieces.slice(bestIndex + 2),
        ];
        currentDurations = durations();
      } else {
        break;
      }
      currentCrossfades = crossfadesOf(currentDurations);
      currentTotal = totalOf(currentDurations, currentCrossfades);
    }
  }

  // Schedule: no gaps, crossfades overlap exactly.
  const rotation = options.rotation ?? 0;
  const segments: ReplaySegment[] = [];
  let replayCursor = 0;
  for (const [index, piece] of pieces.entries()) {
    const durationSec = currentDurations[index]!;
    const crossfadeSec = currentCrossfades[index]!;
    const bucket = piece.bucket;
    const catalog = options.catalog[bucket];
    const trackId =
      catalog !== undefined && catalog.length > 0
        ? (catalog[
            pickWithAvoidance(
              `${snapshot.journeyId}:${index}`,
              catalog.length,
              rotation,
            )
          ] as string)
        : "unassigned";
    segments.push({
      segmentId: `seg_${String(index + 1).padStart(4, "0")}`,
      bucket,
      trackId,
      clipStartSec: pickWithAvoidance(
        `clip:${snapshot.journeyId}:${index}`,
        60,
        rotation,
      ),
      replayStartSec: replayCursor,
      durationSec,
      crossfadeSec,
      journeyStartSec: piece.startSec,
      journeyEndSec: piece.endSec,
    });
    replayCursor += durationSec - crossfadeSec;
  }

  const last = segments[segments.length - 1]!;
  const totalDurationSec = last.replayStartSec + last.durationSec;
  const canonical = `${snapshot.journeyId}|${JSON.stringify(segments)}`;
  const replayId = `rpl_${sha256Hex(canonical).slice(0, 24)}`;

  return {
    replayId,
    journeyId: snapshot.journeyId,
    generatedAt: options.generatedAt,
    totalDurationSec,
    segments,
  };
};
