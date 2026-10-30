/**
 * Web-side mirror of the batch-2 server contracts (kept separate from the
 * server tree so the browser bundle never imports server code).
 */

export type PaceLevel = "low" | "medium" | "high";
export type IntensityLevel = "low" | "medium" | "high";

export type JourneyNodeType =
  "flow_entered" | "bug_valley" | "tests_green" | "rest_started";

export interface JourneyNode {
  readonly nodeId: string;
  readonly type: JourneyNodeType;
  /** Seconds into the session this node sits at. */
  readonly offsetSec: number;
  readonly evidenceEventIds: readonly string[];
}

export interface JourneySignalSample {
  readonly offsetSec: number;
  readonly pace: PaceLevel;
  readonly intensity: IntensityLevel;
  readonly eventCount: number;
}

/** Full snapshot shape served by GET /api/v1/journeys/:id. */
export interface JourneySnapshot {
  readonly journeyId: string;
  readonly sessionStartedAt: string;
  readonly sessionEndedAt: string;
  readonly durationSec: number;
  readonly eventCount: number;
  readonly derivedAt: string;
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

export interface ReplaySegment {
  readonly segmentId: string;
  readonly bucket: string;
  readonly trackId: string;
  readonly clipStartSec: number;
  readonly replayStartSec: number;
  readonly durationSec: number;
  /** Crossfade into the NEXT segment; 0 after the last. */
  readonly crossfadeSec: number;
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

/**
 * Playable metadata for one track (mirror of the server's ReplayTrackSchema,
 * Round-2 defect #2): the static library URL plus the attribution fields
 * the shared player's validatePlan requires. One entry per distinct
 * segment trackId in the replay response.
 */
export interface ReplayTrack {
  readonly trackId: string;
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly durationMs: number;
}
