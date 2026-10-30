import { Type, type Static, type TSchema } from "@sinclair/typebox";
import {
  EntityIdSchema,
  JsonValueSchema,
  SchemaVersionSchema,
  UtcIsoTimestampSchema,
} from "./common";

export const ApiErrorCodeSchema = Type.Union([
  Type.Literal("VALIDATION_FAILED"),
  Type.Literal("UNKNOWN_SCHEMA_VERSION"),
  Type.Literal("PAYLOAD_TOO_LARGE"),
  Type.Literal("TTL_OUT_OF_RANGE"),
  Type.Literal("SENSITIVITY_TTL_VIOLATION"),
  Type.Literal("PROBABILITY_NOT_NORMALIZED"),
  Type.Literal("DUPLICATE_ID"),
  Type.Literal("DANGEROUS_KEY"),
  Type.Literal("EXECUTABLE_PAYLOAD"),
  Type.Literal("INVALID_TIMESTAMP"),
  Type.Literal("HASH_INPUT_INVALID"),
  Type.Literal("CHECKSUM_MISMATCH"),
  Type.Literal("REFERENCE_NOT_FOUND"),
  Type.Literal("CONFLICT"),
  Type.Literal("NOT_FOUND"),
  Type.Literal("INTERNAL_ERROR"),
]);

export const ApiErrorIssueSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 256 }),
    code: ApiErrorCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 280 }),
    keyword: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export const ApiErrorBodySchema = Type.Object(
  {
    code: ApiErrorCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 280 }),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    retryable: Type.Boolean(),
    issues: Type.Optional(
      Type.Array(ApiErrorIssueSchema, { minItems: 1, maxItems: 64 }),
    ),
  },
  { additionalProperties: false },
);

export const ApiMetaSchema = Type.Object(
  {
    serverTime: UtcIsoTimestampSchema,
    etag: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

export const ApiErrorEnvelopeSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    ok: Type.Literal(false),
    requestId: EntityIdSchema,
    error: ApiErrorBodySchema,
  },
  { additionalProperties: false, $id: "MusesApiErrorEnvelope" },
);

export function createApiSuccessEnvelopeSchema<T extends TSchema>(
  dataSchema: T,
) {
  return Type.Object(
    {
      schemaVersion: SchemaVersionSchema,
      ok: Type.Literal(true),
      requestId: EntityIdSchema,
      data: dataSchema,
      meta: Type.Optional(ApiMetaSchema),
    },
    { additionalProperties: false },
  );
}

export function createApiEnvelopeSchema<T extends TSchema>(dataSchema: T) {
  return Type.Union([
    createApiSuccessEnvelopeSchema(dataSchema),
    ApiErrorEnvelopeSchema,
  ]);
}

export const JsonApiSuccessEnvelopeSchema =
  createApiSuccessEnvelopeSchema(JsonValueSchema);
export const JsonApiEnvelopeSchema = createApiEnvelopeSchema(JsonValueSchema);

export type ApiErrorCode = Static<typeof ApiErrorCodeSchema>;
export type ApiErrorIssue = Static<typeof ApiErrorIssueSchema>;
export type ApiErrorBody = Static<typeof ApiErrorBodySchema>;
export type ApiMeta = Static<typeof ApiMetaSchema>;
export type ApiErrorEnvelope = Static<typeof ApiErrorEnvelopeSchema>;
export type JsonApiSuccessEnvelope = Static<
  typeof JsonApiSuccessEnvelopeSchema
>;
export type JsonApiEnvelope = Static<typeof JsonApiEnvelopeSchema>;
