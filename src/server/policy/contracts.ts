import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

const IsoDateTimeSchema = Type.String({
  pattern:
    "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$",
});

export const BeliefStateSchema = Type.Union([
  Type.Literal("DIVERGE"),
  Type.Literal("FLOW"),
  Type.Literal("AUDIT"),
  Type.Literal("DEBUG"),
  Type.Literal("UNKNOWN"),
]);
export type BeliefState = Static<typeof BeliefStateSchema>;

export const AudioProfileIdSchema = Type.Union([
  Type.Literal("diverge"),
  Type.Literal("flow"),
  Type.Literal("audit"),
  Type.Literal("debug"),
]);
export type AudioProfileId = Static<typeof AudioProfileIdSchema>;

export const DecisionKindSchema = Type.Union([
  Type.Literal("NO_ACTION"),
  Type.Literal("AUDIO_DIVERGE"),
  Type.Literal("AUDIO_FLOW"),
  Type.Literal("AUDIO_AUDIT"),
  Type.Literal("AUDIO_DEBUG"),
]);
export type DecisionKind = Static<typeof DecisionKindSchema>;

export const NoActionReasonSchema = Type.Union([
  Type.Literal("AUTOMATION_DISABLED"),
  Type.Literal("MANUAL_COOLDOWN"),
  Type.Literal("QUIET_HOURS"),
  Type.Literal("STALE_BELIEF"),
  Type.Literal("UNKNOWN_BELIEF"),
  Type.Literal("LOW_CONFIDENCE"),
  Type.Literal("PROFILE_UNCHANGED"),
]);
export type NoActionReason = Static<typeof NoActionReasonSchema>;

export const BeliefFactorSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    contribution: Type.Number({ minimum: -1, maximum: 1 }),
    evidenceIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      maxItems: 32,
    }),
  },
  { additionalProperties: false },
);
export type BeliefFactor = Static<typeof BeliefFactorSchema>;

export const PolicyBeliefSchema = Type.Object(
  {
    beliefId: Type.String({ minLength: 1, maxLength: 128 }),
    state: BeliefStateSchema,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    observedAt: IsoDateTimeSchema,
    factors: Type.Array(BeliefFactorSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type PolicyBelief = Static<typeof PolicyBeliefSchema>;

export const QuietHoursSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    startMinuteInclusive: Type.Integer({ minimum: 0, maximum: 1439 }),
    endMinuteExclusive: Type.Integer({ minimum: 0, maximum: 1439 }),
  },
  { additionalProperties: false },
);
export type QuietHours = Static<typeof QuietHoursSchema>;

const ProfileTargetSchema = Type.Object(
  {
    targetGain: Type.Number({ minimum: 0, maximum: 0.35 }),
    rampMs: Type.Integer({ minimum: 250, maximum: 5000 }),
  },
  { additionalProperties: false },
);
export type ProfileTarget = Static<typeof ProfileTargetSchema>;

export const PolicySettingsSchema = Type.Object(
  {
    automationEnabled: Type.Boolean(),
    minimumConfidence: Type.Number({ minimum: 0, maximum: 1 }),
    maximumBeliefAgeMs: Type.Integer({ minimum: 1000, maximum: 86_400_000 }),
    manualCooldownMs: Type.Integer({ minimum: 0, maximum: 86_400_000 }),
    quietHours: QuietHoursSchema,
    profileTargets: Type.Object(
      {
        diverge: ProfileTargetSchema,
        flow: ProfileTargetSchema,
        audit: ProfileTargetSchema,
        debug: ProfileTargetSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type PolicySettings = Static<typeof PolicySettingsSchema>;

export const PolicyContextSchema = Type.Object(
  {
    currentProfile: Type.Union([AudioProfileIdSchema, Type.Null()]),
    lastManualOverrideAt: Type.Union([IsoDateTimeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type PolicyContext = Static<typeof PolicyContextSchema>;

export const PolicyInputSchema = Type.Object(
  {
    belief: PolicyBeliefSchema,
    settings: PolicySettingsSchema,
    context: PolicyContextSchema,
  },
  { additionalProperties: false },
);
export type PolicyInput = Static<typeof PolicyInputSchema>;

export const DecisionExplanationSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1, maxLength: 280 }),
    factors: Type.Array(BeliefFactorSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type DecisionExplanation = Static<typeof DecisionExplanationSchema>;

export const AudioAdjustmentSchema = Type.Object(
  {
    actionId: Type.Literal("audio.adjust"),
    profile: AudioProfileIdSchema,
    targetGain: Type.Number({ minimum: 0, maximum: 0.35 }),
    rampMs: Type.Integer({ minimum: 250, maximum: 5000 }),
  },
  { additionalProperties: false },
);
export type AudioAdjustment = Static<typeof AudioAdjustmentSchema>;

const DecisionBaseProperties = {
  decisionId: Type.String({ minLength: 1, maxLength: 128 }),
  beliefId: Type.String({ minLength: 1, maxLength: 128 }),
  beliefObservedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  explanation: DecisionExplanationSchema,
} as const;

export const NoActionDecisionSchema = Type.Object(
  {
    ...DecisionBaseProperties,
    kind: Type.Literal("NO_ACTION"),
    reason: NoActionReasonSchema,
    effect: Type.Null(),
  },
  { additionalProperties: false },
);
export type NoActionDecision = Static<typeof NoActionDecisionSchema>;

const createAudioDecisionSchema = <
  TKind extends "AUDIO_DIVERGE" | "AUDIO_FLOW" | "AUDIO_AUDIT" | "AUDIO_DEBUG",
  TProfile extends AudioProfileId,
>(
  kind: TKind,
  profile: TProfile,
) =>
  Type.Object(
    {
      ...DecisionBaseProperties,
      kind: Type.Literal(kind),
      reason: Type.Literal("BELIEF_STATE_MATCH"),
      // Flatten the adjustment instead of intersecting it. The intersect form
      // merges a profile union literal with a single literal, which
      // fast-json-stringify cannot compile ("Failed to merge const keyword
      // schemas") when the schema is registered on a response. A flat object
      // with a single profile literal serializes identically and compiles.
      effect: Type.Object(
        {
          actionId: Type.Literal("audio.adjust"),
          profile: Type.Literal(profile),
          targetGain: Type.Number({ minimum: 0, maximum: 0.35 }),
          rampMs: Type.Integer({ minimum: 250, maximum: 5000 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  );

export const AudioDivergeDecisionSchema = createAudioDecisionSchema(
  "AUDIO_DIVERGE",
  "diverge",
);
export const AudioFlowDecisionSchema = createAudioDecisionSchema(
  "AUDIO_FLOW",
  "flow",
);
export const AudioAuditDecisionSchema = createAudioDecisionSchema(
  "AUDIO_AUDIT",
  "audit",
);
export const AudioDebugDecisionSchema = createAudioDecisionSchema(
  "AUDIO_DEBUG",
  "debug",
);

export const DecisionSchema = Type.Union([
  NoActionDecisionSchema,
  AudioDivergeDecisionSchema,
  AudioFlowDecisionSchema,
  AudioAuditDecisionSchema,
  AudioDebugDecisionSchema,
]);
export type Decision = Static<typeof DecisionSchema>;

export const CurrentDecisionResponseSchema = Type.Object(
  {
    decision: Type.Union([DecisionSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type CurrentDecisionResponse = Static<
  typeof CurrentDecisionResponseSchema
>;
