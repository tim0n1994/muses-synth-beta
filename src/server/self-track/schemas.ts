import { Type } from "@sinclair/typebox";

/**
 * Wire schemas for the playback plan. Field-for-field the web contract
 * (src/web/player/contracts.ts), which validates the same shape again —
 * the server is authoritative, the client re-validates defensively.
 */

export const PlanTrackSchema = Type.Object(
  {
    trackId: Type.String(),
    url: Type.String(),
    title: Type.String(),
    artist: Type.String(),
    license: Type.String(),
    licenseUrl: Type.String(),
    durationMs: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const PlanStepSchema = Type.Object(
  {
    track: PlanTrackSchema,
    crossfadeMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PlaybackPlanSchema = Type.Object(
  {
    steps: Type.Array(PlanStepSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const PlanErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
