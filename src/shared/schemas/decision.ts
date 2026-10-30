import { Type, type Static } from "@sinclair/typebox";
import {
  ConfidenceSchema,
  EntityIdSchema,
  SchemaVersionSchema,
  ShortIdSchema,
  UtcIsoTimestampSchema,
} from "./common";
import { EffectSpecSchema } from "./effect";

export const DecisionRationaleItemSchema = Type.Object(
  {
    factorId: ShortIdSchema,
    contribution: Type.Number({ minimum: -1, maximum: 1 }),
    explanation: Type.String({ minLength: 1, maxLength: 280 }),
    evidenceIds: Type.Array(EntityIdSchema, {
      minItems: 0,
      maxItems: 64,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

const DecisionCommonProperties = {
  schemaVersion: SchemaVersionSchema,
  kind: Type.Literal("decision"),
  id: EntityIdSchema,
  beliefId: EntityIdSchema,
  createdAt: UtcIsoTimestampSchema,
  confidence: ConfidenceSchema,
  rationale: Type.Array(DecisionRationaleItemSchema, {
    minItems: 1,
    maxItems: 64,
  }),
} as const;

export const NoActionDecisionSchema = Type.Object(
  {
    ...DecisionCommonProperties,
    decisionType: Type.Literal("NO_ACTION"),
    reason: Type.Union([
      Type.Literal("UNKNOWN_BELIEF"),
      Type.Literal("LOW_CONFIDENCE"),
      Type.Literal("NO_MATERIAL_BENEFIT"),
      Type.Literal("POLICY_BLOCKED"),
      Type.Literal("ALREADY_SATISFIED"),
    ]),
  },
  { additionalProperties: false },
);

export const RecommendDecisionSchema = Type.Object(
  {
    ...DecisionCommonProperties,
    decisionType: Type.Literal("RECOMMEND"),
    recommendation: Type.String({ minLength: 1, maxLength: 280 }),
    proposedEffect: EffectSpecSchema,
  },
  { additionalProperties: false },
);

export const RequestConfirmationDecisionSchema = Type.Object(
  {
    ...DecisionCommonProperties,
    decisionType: Type.Literal("REQUEST_CONFIRMATION"),
    prompt: Type.String({ minLength: 1, maxLength: 280 }),
    proposedEffect: EffectSpecSchema,
    expiresAt: UtcIsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const ApplyEffectDecisionSchema = Type.Object(
  {
    ...DecisionCommonProperties,
    decisionType: Type.Literal("APPLY_EFFECT"),
    effectId: EntityIdSchema,
    effect: EffectSpecSchema,
    rollbackWindowSeconds: Type.Integer({ minimum: 1, maximum: 86_400 }),
  },
  { additionalProperties: false },
);

export const RevertEffectDecisionSchema = Type.Object(
  {
    ...DecisionCommonProperties,
    decisionType: Type.Literal("REVERT_EFFECT"),
    targetEffectId: EntityIdSchema,
    reason: Type.String({ minLength: 1, maxLength: 280 }),
  },
  { additionalProperties: false },
);

export const DecisionSchema = Type.Union(
  [
    NoActionDecisionSchema,
    RecommendDecisionSchema,
    RequestConfirmationDecisionSchema,
    ApplyEffectDecisionSchema,
    RevertEffectDecisionSchema,
  ],
  { $id: "MusesDecision" },
);

export type DecisionRationaleItem = Static<typeof DecisionRationaleItemSchema>;
export type NoActionDecision = Static<typeof NoActionDecisionSchema>;
export type RecommendDecision = Static<typeof RecommendDecisionSchema>;
export type RequestConfirmationDecision = Static<
  typeof RequestConfirmationDecisionSchema
>;
export type ApplyEffectDecision = Static<typeof ApplyEffectDecisionSchema>;
export type RevertEffectDecision = Static<typeof RevertEffectDecisionSchema>;
export type Decision = Static<typeof DecisionSchema>;
