import { Type, type Static } from "@sinclair/typebox";

/** Wire contracts for the journey/replay routes (batch-2 frozen shapes). */

export const JourneyNodeTypeSchema = Type.Union([
  Type.Literal("flow_entered"),
  Type.Literal("bug_valley"),
  Type.Literal("tests_green"),
  Type.Literal("rest_started"),
]);

export const LevelSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

export const JourneySignalSampleSchema = Type.Object({
  offsetSec: Type.Integer({ minimum: 0 }),
  pace: LevelSchema,
  intensity: LevelSchema,
  eventCount: Type.Integer({ minimum: 0 }),
});

export const JourneyNodeSchema = Type.Object({
  nodeId: Type.String({ minLength: 1, maxLength: 64 }),
  type: JourneyNodeTypeSchema,
  offsetSec: Type.Integer({ minimum: 0 }),
  evidenceEventIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
    maxItems: 8,
  }),
});

export const JourneySnapshotSchema = Type.Object({
  journeyId: Type.String({ minLength: 1, maxLength: 64 }),
  sessionStartedAt: Type.String({ minLength: 1 }),
  sessionEndedAt: Type.String({ minLength: 1 }),
  durationSec: Type.Integer({ minimum: 0 }),
  eventCount: Type.Integer({ minimum: 0 }),
  derivedAt: Type.String({ minLength: 1 }),
  retentionDays: Type.Integer({ minimum: 1, maximum: 3_650 }),
  samples: Type.Array(JourneySignalSampleSchema, { maxItems: 512 }),
  nodes: Type.Array(JourneyNodeSchema, { maxItems: 256 }),
});

export const JourneySummarySchema = Type.Object({
  journeyId: Type.String({ minLength: 1, maxLength: 64 }),
  sessionStartedAt: Type.String({ minLength: 1 }),
  sessionEndedAt: Type.String({ minLength: 1 }),
  durationSec: Type.Integer({ minimum: 0 }),
  eventCount: Type.Integer({ minimum: 0 }),
  nodeCount: Type.Integer({ minimum: 0 }),
  retentionDays: Type.Integer({ minimum: 1, maximum: 3_650 }),
  derivedAt: Type.String({ minLength: 1 }),
});

export const ReplaySegmentSchema = Type.Object({
  segmentId: Type.String({ minLength: 1, maxLength: 64 }),
  bucket: Type.String({ minLength: 1, maxLength: 64 }),
  trackId: Type.String({ minLength: 1, maxLength: 256 }),
  clipStartSec: Type.Integer({ minimum: 0 }),
  durationSec: Type.Integer({ minimum: 1 }),
  replayStartSec: Type.Integer({ minimum: 0 }),
  crossfadeSec: Type.Integer({ minimum: 0 }),
  journeyStartSec: Type.Integer({ minimum: 0 }),
  journeyEndSec: Type.Integer({ minimum: 0 }),
});

export const ReplayPlanSchema = Type.Object({
  replayId: Type.String({ minLength: 1, maxLength: 64 }),
  journeyId: Type.String({ minLength: 1, maxLength: 64 }),
  generatedAt: Type.String({ minLength: 1 }),
  totalDurationSec: Type.Integer({ minimum: 1 }),
  segments: Type.Array(ReplaySegmentSchema, { maxItems: 512 }),
});

export const JourneyListResponseSchema = Type.Object({
  items: Type.Array(JourneySummarySchema),
});

export const JourneyDetailResponseSchema = Type.Object({
  journey: JourneySnapshotSchema,
});

export const ReplayTrackSchema = Type.Object({
  trackId: Type.String({ minLength: 1, maxLength: 256 }),
  /** Same-origin static library path (HTTP Range, never transcoded). */
  url: Type.String({ minLength: 1, maxLength: 512 }),
  title: Type.String({ minLength: 1, maxLength: 512 }),
  artist: Type.String({ minLength: 1, maxLength: 512 }),
  license: Type.String({ minLength: 1, maxLength: 128 }),
  licenseUrl: Type.String({ minLength: 1, maxLength: 512 }),
  durationMs: Type.Integer({ minimum: 1 }),
});

export const ReplayResponseSchema = Type.Object({
  replay: ReplayPlanSchema,
  /** Playable metadata, one entry per distinct segment trackId. */
  tracks: Type.Array(ReplayTrackSchema, { maxItems: 512 }),
});

export const JourneyIdParamsSchema = Type.Object({
  journeyId: Type.String({ minLength: 1, maxLength: 128 }),
});

export type JourneyListResponse = Static<typeof JourneyListResponseSchema>;
export type JourneyDetailResponse = Static<typeof JourneyDetailResponseSchema>;
export type ReplayResponse = Static<typeof ReplayResponseSchema>;
