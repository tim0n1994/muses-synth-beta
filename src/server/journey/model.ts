/**
 * Journey / Replay domain model (v0.7 batch 2, V7 + V8).
 *
 * A Journey is a per-session DERIVED timeline over the v0.6 event store:
 * a signal series plus key nodes. Raw events are never copied into it —
 * nodes keep evidence event ids pointing back at context_event_store.
 *
 * A Replay is a playlist + timestamps: the Journey segmented by state, each
 * segment bound to a 60-120s clip of a self-track, crossfaded neighbors,
 * the day compressed to 30-45 minutes. No audio is rendered, stored or
 * exported server-side.
 */

export type PaceLevel = "low" | "medium" | "high";
export type IntensityLevel = "low" | "medium" | "high";

export type JourneyNodeType =
  "flow_entered" | "bug_valley" | "tests_green" | "rest_started";

export interface JourneySignalSample {
  /** Seconds from the session's first event. */
  readonly offsetSec: number;
  readonly pace: PaceLevel;
  readonly intensity: IntensityLevel;
  readonly eventCount: number;
}

export interface JourneyNode {
  readonly nodeId: string;
  readonly type: JourneyNodeType;
  /** Seconds from the session's first event. */
  readonly offsetSec: number;
  /** Event ids in the v0.6 store this node was derived from (explainability). */
  readonly evidenceEventIds: readonly string[];
}

export interface JourneySnapshot {
  readonly journeyId: string;
  readonly sessionStartedAt: string;
  readonly sessionEndedAt: string;
  readonly durationSec: number;
  readonly eventCount: number;
  readonly derivedAt: string;
  /** Default 90-day retention policy (V7). */
  readonly retentionDays: number;
  readonly samples: readonly JourneySignalSample[];
  readonly nodes: readonly JourneyNode[];
}

export interface JourneySummary {
  readonly journeyId: string;
  readonly sessionStartedAt: string;
  readonly sessionEndedAt: string;
  readonly durationSec: number;
  readonly eventCount: number;
  readonly nodeCount: number;
  readonly retentionDays: number;
  readonly derivedAt: string;
}

export const selfTrackBucket = (
  pace: PaceLevel,
  intensity: IntensityLevel,
): string => `self:${pace}:${intensity}`;

/**
 * V2 library bucket vocabulary (license-gate SELF_TRACK_BUCKETS): the same
 * 3x3 self grid in different words — pace slow|mid|fast where the journey
 * says low|medium|high, intensity low|mid|high where the journey says
 * low|medium|high. The planner speaks the journey vocabulary while the
 * library stores the V2 names, so the runtime injection adapts the
 * library-keyed catalog onto journey keys (Round-2 defect #1: without the
 * adaptation no key ever matched and every segment fell to the explicit
 * "unassigned" default — production replay rpl_18e90d2e4fd49ec22999582c,
 * 32/32 unassigned, read-only SQL 2026-10-21).
 */
const LIBRARY_PACE: Readonly<Record<PaceLevel, "slow" | "mid" | "fast">> = {
  low: "slow",
  medium: "mid",
  high: "fast",
};
const LIBRARY_INTENSITY: Readonly<
  Record<IntensityLevel, "low" | "mid" | "high">
> = {
  low: "low",
  medium: "mid",
  high: "high",
};

export const librarySelfBucket = (
  pace: PaceLevel,
  intensity: IntensityLevel,
): string => `self_${LIBRARY_PACE[pace]}_${LIBRARY_INTENSITY[intensity]}`;

/** Inverse of librarySelfBucket; null for anything that is not a self key. */
export const journeyBucketFromLibrary = (
  libraryBucket: string,
): string | null => {
  const match = /^self_(slow|mid|fast)_(low|mid|high)$/.exec(libraryBucket);
  if (match === null) {
    return null;
  }
  const pace: PaceLevel =
    match[1] === "slow" ? "low" : match[1] === "mid" ? "medium" : "high";
  const intensity: IntensityLevel =
    match[2] === "low" ? "low" : match[2] === "mid" ? "medium" : "high";
  return selfTrackBucket(pace, intensity);
};

/**
 * Remap a library-keyed self-track catalog (tracks-store.selfTrackCatalog)
 * onto the planner's "self:<pace>:<intensity>" keys. Keys that are not V2
 * self buckets pass through untouched (foreign catalogs keep working);
 * empty in, empty out.
 */
export const catalogFromLibraryBuckets = (
  libraryCatalog: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> => {
  const adapted: Record<string, readonly string[]> = {};
  for (const [bucket, trackIds] of Object.entries(libraryCatalog)) {
    const journeyBucket = journeyBucketFromLibrary(bucket);
    if (journeyBucket === null) {
      adapted[bucket] = trackIds;
      continue;
    }
    adapted[journeyBucket] = [...(adapted[journeyBucket] ?? []), ...trackIds];
  }
  return adapted;
};

export interface ReplaySegment {
  readonly segmentId: string;
  /** V2 self-track bucket: "self:<pace>:<intensity>". */
  readonly bucket: string;
  readonly trackId: string;
  /** Offset into the source track where the clip starts. */
  readonly clipStartSec: number;
  /** Position on the replay timeline (crossfades overlap neighbors). */
  readonly replayStartSec: number;
  readonly durationSec: number;
  /** Crossfade into the NEXT segment; 0 after the last. */
  readonly crossfadeSec: number;
  /** Journey-time span this segment represents. */
  readonly journeyStartSec: number;
  readonly journeyEndSec: number;
}

export interface ReplayPlan {
  readonly replayId: string;
  readonly journeyId: string;
  readonly generatedAt: string;
  readonly totalDurationSec: number;
  readonly segments: readonly ReplaySegment[];
}
