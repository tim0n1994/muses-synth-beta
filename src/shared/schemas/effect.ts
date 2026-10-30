import { Type, type Static } from "@sinclair/typebox";
import {
  EntityIdSchema,
  SchemaVersionSchema,
  ShortIdSchema,
  UtcIsoTimestampSchema,
} from "./common";

export const AudioPlayEffectSpecSchema = Type.Object(
  {
    type: Type.Literal("audio.play"),
    profileId: ShortIdSchema,
    fadeInMs: Type.Integer({ minimum: 0, maximum: 10_000 }),
  },
  { additionalProperties: false },
);

export const AudioPauseEffectSpecSchema = Type.Object(
  {
    type: Type.Literal("audio.pause"),
    fadeOutMs: Type.Integer({ minimum: 0, maximum: 10_000 }),
  },
  { additionalProperties: false },
);

export const AudioSetProfileEffectSpecSchema = Type.Object(
  {
    type: Type.Literal("audio.set_profile"),
    profileId: ShortIdSchema,
    crossfadeMs: Type.Integer({ minimum: 0, maximum: 10_000 }),
  },
  { additionalProperties: false },
);

export const AudioSetVolumeEffectSpecSchema = Type.Object(
  {
    type: Type.Literal("audio.set_volume"),
    volume: Type.Number({ minimum: 0, maximum: 1 }),
    rampMs: Type.Integer({ minimum: 0, maximum: 10_000 }),
  },
  { additionalProperties: false },
);

export const NotificationShowEffectSpecSchema = Type.Object(
  {
    type: Type.Literal("notification.show"),
    title: Type.String({ minLength: 1, maxLength: 120 }),
    body: Type.String({ minLength: 1, maxLength: 500 }),
    severity: Type.Union([
      Type.Literal("INFO"),
      Type.Literal("WARNING"),
      Type.Literal("CRITICAL"),
    ]),
    expiresInSeconds: Type.Integer({ minimum: 1, maximum: 3_600 }),
  },
  { additionalProperties: false },
);

export const EffectSpecSchema = Type.Union([
  AudioPlayEffectSpecSchema,
  AudioPauseEffectSpecSchema,
  AudioSetProfileEffectSpecSchema,
  AudioSetVolumeEffectSpecSchema,
  NotificationShowEffectSpecSchema,
]);

export const EffectFailureSchema = Type.Object(
  {
    code: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Z][A-Z0-9_]*$",
    }),
    message: Type.String({ minLength: 1, maxLength: 280 }),
    retryable: Type.Boolean(),
  },
  { additionalProperties: false },
);

const EffectCommonProperties = {
  schemaVersion: SchemaVersionSchema,
  kind: Type.Literal("effect"),
  id: EntityIdSchema,
  decisionId: EntityIdSchema,
  idempotencyKey: EntityIdSchema,
  createdAt: UtcIsoTimestampSchema,
  updatedAt: UtcIsoTimestampSchema,
  reversible: Type.Literal(true),
  spec: EffectSpecSchema,
} as const;

export const PendingEffectSchema = Type.Object(
  {
    ...EffectCommonProperties,
    status: Type.Literal("PENDING"),
  },
  { additionalProperties: false },
);

export const AppliedEffectSchema = Type.Object(
  {
    ...EffectCommonProperties,
    status: Type.Literal("APPLIED"),
    appliedAt: UtcIsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const RevertedEffectSchema = Type.Object(
  {
    ...EffectCommonProperties,
    status: Type.Literal("REVERTED"),
    appliedAt: UtcIsoTimestampSchema,
    revertedAt: UtcIsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const FailedEffectSchema = Type.Object(
  {
    ...EffectCommonProperties,
    status: Type.Literal("FAILED"),
    appliedAt: Type.Optional(UtcIsoTimestampSchema),
    failure: EffectFailureSchema,
  },
  { additionalProperties: false },
);

export const EffectSchema = Type.Union(
  [
    PendingEffectSchema,
    AppliedEffectSchema,
    RevertedEffectSchema,
    FailedEffectSchema,
  ],
  { $id: "MusesEffect" },
);

export type AudioPlayEffectSpec = Static<typeof AudioPlayEffectSpecSchema>;
export type AudioPauseEffectSpec = Static<typeof AudioPauseEffectSpecSchema>;
export type AudioSetProfileEffectSpec = Static<
  typeof AudioSetProfileEffectSpecSchema
>;
export type AudioSetVolumeEffectSpec = Static<
  typeof AudioSetVolumeEffectSpecSchema
>;
export type NotificationShowEffectSpec = Static<
  typeof NotificationShowEffectSpecSchema
>;
export type EffectSpec = Static<typeof EffectSpecSchema>;
export type EffectFailure = Static<typeof EffectFailureSchema>;
export type PendingEffect = Static<typeof PendingEffectSchema>;
export type AppliedEffect = Static<typeof AppliedEffectSchema>;
export type RevertedEffect = Static<typeof RevertedEffectSchema>;
export type FailedEffect = Static<typeof FailedEffectSchema>;
export type Effect = Static<typeof EffectSchema>;
