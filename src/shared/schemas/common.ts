import { Type, type Static } from "@sinclair/typebox";
import { SCHEMA_VERSION } from "../constants";

export const SAFE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";
export const SAFE_SHORT_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$";
export const EVENT_TYPE_PATTERN = "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$";
export const UTC_ISO_TIMESTAMP_PATTERN =
  "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{3}Z$";
export const JSON_KEY_PATTERN = "^[^\\u0000-\\u001F\\u007F]{1,128}$";

export const SchemaVersionSchema = Type.Literal(SCHEMA_VERSION);
export type SchemaVersionValue = Static<typeof SchemaVersionSchema>;

export const EntityIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: SAFE_ID_PATTERN,
});
export const ShortIdSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: SAFE_SHORT_ID_PATTERN,
});
export const EventTypeSchema = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: EVENT_TYPE_PATTERN,
});
export const UtcIsoTimestampSchema = Type.String({
  format: "date-time",
  minLength: 24,
  maxLength: 24,
  pattern: UTC_ISO_TIMESTAMP_PATTERN,
});
export const Sha256HexSchema = Type.String({
  minLength: 64,
  maxLength: 64,
  pattern: "^[a-f0-9]{64}$",
});
export const ProbabilitySchema = Type.Number({ minimum: 0, maximum: 1 });
export const ConfidenceSchema = Type.Number({ minimum: 0, maximum: 1 });
export const SensitivitySchema = Type.Union([
  Type.Literal("PUBLIC"),
  Type.Literal("INTERNAL"),
  Type.Literal("SENSITIVE"),
  Type.Literal("RESTRICTED"),
]);

export const JsonValueSchema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String({ maxLength: 1_000_000 }),
      Type.Array(Self, { maxItems: 2_048 }),
      Type.Record(Type.String({ pattern: JSON_KEY_PATTERN }), Self, {
        maxProperties: 512,
      }),
    ]),
  { $id: "MusesJsonValue" },
);

export const JsonObjectSchema = Type.Record(
  Type.String({ pattern: JSON_KEY_PATTERN }),
  JsonValueSchema,
  { maxProperties: 512 },
);

export type EntityId = Static<typeof EntityIdSchema>;
export type UtcIsoTimestamp = Static<typeof UtcIsoTimestampSchema>;
export type SensitivityValue = Static<typeof SensitivitySchema>;
export type JsonValue = Static<typeof JsonValueSchema>;
export type JsonObject = Static<typeof JsonObjectSchema>;
