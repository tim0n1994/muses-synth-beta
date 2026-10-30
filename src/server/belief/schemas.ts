import { Type } from "@sinclair/typebox";
import { BELIEF_STATES } from "./model.js";

const BeliefStateSchema = Type.Union(
  BELIEF_STATES.map((state) => Type.Literal(state)),
);
const EvidenceSchema = Type.Object(
  {
    ruleId: Type.String(),
    source: Type.String(),
    eventId: Type.String(),
    serverSequence: Type.Integer({ minimum: 1 }),
    occurredAt: Type.String(),
    contribution: Type.Number(),
    factor: Type.Union([
      Type.Literal("activity"),
      Type.Literal("workMode"),
      Type.Literal("outcome"),
      Type.Literal("attention"),
      Type.Literal("state"),
    ]),
  },
  { additionalProperties: false },
);

const FactorSchema = Type.Object(
  {
    value: Type.String(),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    freshness: Type.Number({ minimum: 0, maximum: 1 }),
    evidence: Type.Array(EvidenceSchema),
  },
  { additionalProperties: false },
);

export const BeliefSnapshotSchema = Type.Object(
  {
    state: BeliefStateSchema,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    freshness: Type.Number({ minimum: 0, maximum: 1 }),
    distribution: Type.Record(
      Type.String(),
      Type.Number({ minimum: 0, maximum: 1 }),
    ),
    factors: Type.Object(
      {
        activity: FactorSchema,
        workMode: FactorSchema,
        outcome: FactorSchema,
        attention: FactorSchema,
      },
      { additionalProperties: false },
    ),
    evidence: Type.Array(EvidenceSchema),
    unknownReasons: Type.Array(Type.String()),
    explanation: Type.Array(Type.String()),
    asOf: Type.String(),
    rulesetVersion: Type.String(),
    inputDigest: Type.String(),
    lastServerSequence: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const BeliefReplayBodySchema = Type.Object(
  {
    asOf: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    maxEvents: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  },
  { additionalProperties: false },
);

export const BeliefErrorResponseSchema = Type.Object(
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

export interface BeliefReplayBodyDto {
  readonly asOf?: string;
  readonly maxEvents?: number;
}
