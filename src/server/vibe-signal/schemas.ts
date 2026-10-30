import { Type } from "@sinclair/typebox";

import { INTENSITY_LEVELS, RHYTHM_LEVELS } from "./model.js";

const RhythmValueSchema = Type.Union(
  RHYTHM_LEVELS.map((level) => Type.Literal(level)),
);
const IntensityValueSchema = Type.Union(
  INTENSITY_LEVELS.map((level) => Type.Literal(level)),
);

const PulseEvidenceSchema = Type.Object(
  {
    ruleId: Type.String(),
    source: Type.String(),
    eventId: Type.String(),
    serverSequence: Type.Integer({ minimum: 1 }),
    occurredAt: Type.String(),
    contribution: Type.Number(),
    factor: Type.Union([
      Type.Literal("rhythm"),
      Type.Literal("intensity"),
      Type.Literal("emotion"),
    ]),
  },
  { additionalProperties: false },
);

const RhythmSchema = Type.Object(
  {
    value: RhythmValueSchema,
    score: Type.Number({ minimum: 0 }),
    evidence: Type.Array(PulseEvidenceSchema),
  },
  { additionalProperties: false },
);

const IntensitySchema = Type.Object(
  {
    value: IntensityValueSchema,
    score: Type.Number({ minimum: 0, maximum: 1 }),
    evidence: Type.Array(PulseEvidenceSchema),
  },
  { additionalProperties: false },
);

const TransitionModulationSchema = Type.Object(
  {
    crossfadeMs: Type.Integer({ minimum: 0 }),
    energyBias: Type.Integer({ minimum: -1, maximum: 1 }),
    hardCut: Type.Boolean(),
  },
  { additionalProperties: false },
);

const EmotionSchema = Type.Object(
  {
    value: Type.Union([
      Type.Number({ minimum: -1, maximum: 1 }),
      Type.Literal("UNKNOWN"),
    ]),
    tone: Type.Union([
      Type.Literal("POSITIVE"),
      Type.Literal("NEGATIVE"),
      Type.Literal("NEUTRAL"),
      Type.Literal("UNKNOWN"),
    ]),
    transitionModulation: TransitionModulationSchema,
    evidence: Type.Array(PulseEvidenceSchema),
  },
  { additionalProperties: false },
);

export const PulseSnapshotSchema = Type.Object(
  {
    asOf: Type.String(),
    windowStartedAt: Type.String(),
    windowEndedAt: Type.String(),
    rhythm: RhythmSchema,
    intensity: IntensitySchema,
    emotion: EmotionSchema,
    evidence: Type.Array(PulseEvidenceSchema),
    unknownReasons: Type.Array(Type.String()),
    explanation: Type.Array(Type.String()),
    rulesetVersion: Type.String(),
    inputDigest: Type.String(),
    lastServerSequence: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const PulseReplayBodySchema = Type.Object(
  {
    asOf: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    maxEvents: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  },
  { additionalProperties: false },
);

export interface PulseReplayBodyDto {
  readonly asOf?: string;
  readonly maxEvents?: number;
}

export const PulseErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
        details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
