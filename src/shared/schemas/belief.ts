import { Type, type Static } from "@sinclair/typebox";
import {
  ConfidenceSchema,
  EntityIdSchema,
  ProbabilitySchema,
  SchemaVersionSchema,
  SensitivitySchema,
  ShortIdSchema,
  UtcIsoTimestampSchema,
} from "./common";

export const EvidenceDirectionSchema = Type.Union([
  Type.Literal("SUPPORTS"),
  Type.Literal("CONTRADICTS"),
  Type.Literal("NEUTRAL"),
]);

export const BeliefEvidenceSchema = Type.Object(
  {
    id: EntityIdSchema,
    eventId: EntityIdSchema,
    factorId: ShortIdSchema,
    observedAt: UtcIsoTimestampSchema,
    direction: EvidenceDirectionSchema,
    weight: ProbabilitySchema,
    summary: Type.Optional(Type.String({ minLength: 1, maxLength: 280 })),
    sensitivity: SensitivitySchema,
  },
  { additionalProperties: false },
);

export const FreshnessSchema = Type.Object(
  {
    observedAt: UtcIsoTimestampSchema,
    expiresAt: UtcIsoTimestampSchema,
    score: ProbabilitySchema,
  },
  { additionalProperties: false },
);

export const BeliefStateProbabilitySchema = Type.Object(
  {
    stateId: ShortIdSchema,
    label: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    probability: ProbabilitySchema,
  },
  { additionalProperties: false },
);

export const BeliefFactorSchema = Type.Object(
  {
    id: ShortIdSchema,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    probabilities: Type.Array(BeliefStateProbabilitySchema, {
      minItems: 0,
      maxItems: 32,
    }),
    unknownProbability: ProbabilitySchema,
    confidence: ConfidenceSchema,
    freshness: FreshnessSchema,
    evidenceIds: Type.Array(EntityIdSchema, {
      minItems: 0,
      maxItems: 256,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

const BeliefCommonProperties = {
  schemaVersion: SchemaVersionSchema,
  kind: Type.Literal("belief"),
  id: EntityIdSchema,
  subjectId: EntityIdSchema,
  generatedAt: UtcIsoTimestampSchema,
  revision: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
  confidence: ConfidenceSchema,
  factors: Type.Array(BeliefFactorSchema, { minItems: 1, maxItems: 64 }),
  evidence: Type.Array(BeliefEvidenceSchema, { minItems: 0, maxItems: 512 }),
} as const;

export const KnownBeliefSchema = Type.Object(
  {
    ...BeliefCommonProperties,
    status: Type.Literal("KNOWN"),
  },
  { additionalProperties: false },
);

export const UnknownBeliefSchema = Type.Object(
  {
    ...BeliefCommonProperties,
    status: Type.Literal("UNKNOWN"),
    unknownReason: Type.Union([
      Type.Literal("NO_OBSERVATIONS"),
      Type.Literal("INSUFFICIENT_EVIDENCE"),
      Type.Literal("STALE_EVIDENCE"),
      Type.Literal("CONFLICTING_EVIDENCE"),
      Type.Literal("UNSUPPORTED_SUBJECT"),
      Type.Literal("POLICY_REDACTION"),
    ]),
  },
  { additionalProperties: false },
);

export const BeliefSchema = Type.Union(
  [KnownBeliefSchema, UnknownBeliefSchema],
  {
    $id: "MusesBelief",
  },
);

export type EvidenceDirection = Static<typeof EvidenceDirectionSchema>;
export type BeliefEvidence = Static<typeof BeliefEvidenceSchema>;
export type Freshness = Static<typeof FreshnessSchema>;
export type BeliefStateProbability = Static<
  typeof BeliefStateProbabilitySchema
>;
export type BeliefFactor = Static<typeof BeliefFactorSchema>;
export type KnownBelief = Static<typeof KnownBeliefSchema>;
export type UnknownBelief = Static<typeof UnknownBeliefSchema>;
export type Belief = Static<typeof BeliefSchema>;
