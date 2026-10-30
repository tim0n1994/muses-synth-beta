import { Type, type Static } from "@sinclair/typebox";
import {
  ConfidenceSchema,
  EntityIdSchema,
  SchemaVersionSchema,
  Sha256HexSchema,
  ShortIdSchema,
  UtcIsoTimestampSchema,
} from "./common";
import { DashboardComponentSchema } from "./dashboard";

export const AudioProfileSchema = Type.Object(
  {
    id: ShortIdSchema,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    localAssetId: EntityIdSchema,
    volume: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export const SettingsDocumentSchema = Type.Object(
  {
    dashboard: Type.Object(
      {
        components: Type.Array(DashboardComponentSchema, {
          minItems: 1,
          maxItems: 64,
        }),
      },
      { additionalProperties: false },
    ),
    decisionPolicy: Type.Object(
      {
        allowAutomaticEffects: Type.Boolean(),
        minimumDecisionConfidence: ConfidenceSchema,
        confirmationThreshold: ConfidenceSchema,
        defaultRollbackWindowSeconds: Type.Integer({
          minimum: 1,
          maximum: 86_400,
        }),
      },
      { additionalProperties: false },
    ),
    audio: Type.Object(
      {
        enabled: Type.Boolean(),
        maxVolume: Type.Number({ minimum: 0, maximum: 1 }),
        defaultProfileId: Type.Optional(ShortIdSchema),
        profiles: Type.Array(AudioProfileSchema, { minItems: 0, maxItems: 64 }),
      },
      { additionalProperties: false },
    ),
    privacy: Type.Object(
      {
        localOnly: Type.Literal(true),
        telemetry: Type.Literal("OFF"),
        redactSensitiveEvidence: Type.Boolean(),
        persistence: Type.Union([
          Type.Literal("EPHEMERAL"),
          Type.Literal("SQLITE"),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const SettingsDraftSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("settings.draft"),
    id: EntityIdSchema,
    status: Type.Literal("DRAFT"),
    baseReleaseId: Type.Union([EntityIdSchema, Type.Null()]),
    revision: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
    createdAt: UtcIsoTimestampSchema,
    updatedAt: UtcIsoTimestampSchema,
    document: SettingsDocumentSchema,
    checksum: Sha256HexSchema,
  },
  { additionalProperties: false, $id: "MusesSettingsDraft" },
);

export const SettingsPreviewWarningSchema = Type.Object(
  {
    code: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Z][A-Z0-9_]*$",
    }),
    message: Type.String({ minLength: 1, maxLength: 280 }),
    path: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);

export const SettingsPreviewSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("settings.preview"),
    draftId: EntityIdSchema,
    generatedAt: UtcIsoTimestampSchema,
    document: SettingsDocumentSchema,
    documentChecksum: Sha256HexSchema,
    warnings: Type.Array(SettingsPreviewWarningSchema, {
      minItems: 0,
      maxItems: 64,
    }),
  },
  { additionalProperties: false, $id: "MusesSettingsPreview" },
);

export const SettingsReleaseSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("settings.release"),
    id: EntityIdSchema,
    sourceDraftId: EntityIdSchema,
    previousReleaseId: Type.Union([EntityIdSchema, Type.Null()]),
    sequence: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
    publishedAt: UtcIsoTimestampSchema,
    document: SettingsDocumentSchema,
    checksum: Sha256HexSchema,
  },
  { additionalProperties: false, $id: "MusesSettingsRelease" },
);

export const SettingsPublishHistoryEntrySchema = Type.Object(
  {
    id: EntityIdSchema,
    operation: Type.Literal("PUBLISH"),
    releaseId: EntityIdSchema,
    occurredAt: UtcIsoTimestampSchema,
    actor: Type.Literal("LOCAL_USER"),
  },
  { additionalProperties: false },
);

export const SettingsRollbackHistoryEntrySchema = Type.Object(
  {
    id: EntityIdSchema,
    operation: Type.Literal("ROLLBACK"),
    fromReleaseId: EntityIdSchema,
    toReleaseId: EntityIdSchema,
    occurredAt: UtcIsoTimestampSchema,
    actor: Type.Literal("LOCAL_USER"),
  },
  { additionalProperties: false },
);

export const SettingsHistoryEntrySchema = Type.Union([
  SettingsPublishHistoryEntrySchema,
  SettingsRollbackHistoryEntrySchema,
]);

export const SettingsHistorySchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("settings.history"),
    currentReleaseId: Type.Union([EntityIdSchema, Type.Null()]),
    entries: Type.Array(SettingsHistoryEntrySchema, {
      minItems: 0,
      maxItems: 10_000,
    }),
  },
  { additionalProperties: false, $id: "MusesSettingsHistory" },
);

export type AudioProfile = Static<typeof AudioProfileSchema>;
export type SettingsDocument = Static<typeof SettingsDocumentSchema>;
export type SettingsDraft = Static<typeof SettingsDraftSchema>;
export type SettingsPreviewWarning = Static<
  typeof SettingsPreviewWarningSchema
>;
export type SettingsPreview = Static<typeof SettingsPreviewSchema>;
export type SettingsRelease = Static<typeof SettingsReleaseSchema>;
export type SettingsPublishHistoryEntry = Static<
  typeof SettingsPublishHistoryEntrySchema
>;
export type SettingsRollbackHistoryEntry = Static<
  typeof SettingsRollbackHistoryEntrySchema
>;
export type SettingsHistoryEntry = Static<typeof SettingsHistoryEntrySchema>;
export type SettingsHistory = Static<typeof SettingsHistorySchema>;
