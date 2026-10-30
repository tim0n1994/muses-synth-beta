import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

import { AudioAdjustmentSchema } from "../policy/contracts.js";

const IsoDateTimeSchema = Type.String({
  pattern:
    "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$",
});

export const AutomationActionIdSchema = Type.Literal("audio.adjust");
export type AutomationActionId = Static<typeof AutomationActionIdSchema>;

export const EffectStatusSchema = Type.Union([
  Type.Literal("issued"),
  Type.Literal("applied"),
  Type.Literal("skipped"),
  Type.Literal("failed"),
  Type.Literal("reverted"),
]);
export type EffectStatus = Static<typeof EffectStatusSchema>;

export const EffectRequestSchema = Type.Object(
  {
    effectId: Type.String({ minLength: 1, maxLength: 128 }),
    decisionId: Type.String({ minLength: 1, maxLength: 128 }),
    actionId: AutomationActionIdSchema,
    adjustment: AudioAdjustmentSchema,
    issuedAt: IsoDateTimeSchema,
    status: Type.Literal("issued"),
  },
  { additionalProperties: false },
);
export type EffectRequest = Static<typeof EffectRequestSchema>;

export const EffectOutcomeSchema = Type.Object(
  {
    outcomeId: Type.String({ minLength: 1, maxLength: 128 }),
    effectId: Type.String({ minLength: 1, maxLength: 128 }),
    status: Type.Union([
      Type.Literal("applied"),
      Type.Literal("skipped"),
      Type.Literal("failed"),
      Type.Literal("reverted"),
    ]),
    reason: Type.String({ minLength: 1, maxLength: 128 }),
    detail: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
    observedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);
export type EffectOutcome = Static<typeof EffectOutcomeSchema>;

/**
 * Reserved `EffectOutcome.reason` tokens that mark an outcome as the result of
 * a deliberate human action rather than automation. The browser posts one of
 * these when the user drives the transport, which is how the server learns a
 * manual override happened at all — `EffectOutcomeSchema` is
 * `additionalProperties: false` with a fixed field set, so a reserved reason is
 * the seam that does not require widening the contract.
 *
 * The policy engine's MANUAL_COOLDOWN branch depends on this: without it,
 * `lastManualOverrideAt` is always null and the branch is unreachable.
 */
export const MANUAL_OVERRIDE_REASONS = Object.freeze([
  "MANUAL_START",
  "MANUAL_PAUSE",
  "MANUAL_VOLUME",
  "MANUAL_REVERT",
] as const);
export type ManualOverrideReason = (typeof MANUAL_OVERRIDE_REASONS)[number];

export function isManualOverrideReason(
  reason: string,
): reason is ManualOverrideReason {
  return MANUAL_OVERRIDE_REASONS.some((candidate) => candidate === reason);
}

export const EffectLedgerEntrySchema = Type.Object(
  {
    request: EffectRequestSchema,
    latestOutcome: Type.Union([EffectOutcomeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type EffectLedgerEntry = Static<typeof EffectLedgerEntrySchema>;

export const CurrentEffectResponseSchema = Type.Object(
  {
    effect: Type.Union([EffectLedgerEntrySchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type CurrentEffectResponse = Static<typeof CurrentEffectResponseSchema>;

export const RecordEffectOutcomeResponseSchema = Type.Object(
  {
    effect: EffectLedgerEntrySchema,
  },
  { additionalProperties: false },
);
export type RecordEffectOutcomeResponse = Static<
  typeof RecordEffectOutcomeResponseSchema
>;

export const EffectErrorResponseSchema = Type.Object(
  {
    error: Type.Literal("UNKNOWN_EFFECT"),
  },
  { additionalProperties: false },
);
export type EffectErrorResponse = Static<typeof EffectErrorResponseSchema>;
