import { Type } from "@sinclair/typebox";

export const CloudEventIngestSchema = Type.Object(
  {
    specversion: Type.Literal("1.0"),
    id: Type.String({ minLength: 1, maxLength: 256 }),
    source: Type.String({ minLength: 1, maxLength: 512 }),
    type: Type.String({ minLength: 1, maxLength: 256 }),
    subject: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    time: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    datacontenttype: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    dataschema: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    data: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);

export const ContextEventListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 200, default: 50 }),
    ),
    source: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    type: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    subject: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    includeExpired: Type.Optional(Type.Boolean({ default: false })),
    asOf: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export const ContextEventRecordSchema = Type.Object(
  {
    specversion: Type.Literal("1.0"),
    id: Type.String(),
    source: Type.String(),
    type: Type.String(),
    subject: Type.Optional(Type.String()),
    time: Type.Optional(Type.String()),
    datacontenttype: Type.Optional(Type.String()),
    dataschema: Type.Optional(Type.String()),
    data: Type.Optional(Type.Unknown()),
    ttlSeconds: Type.Optional(Type.Integer()),
    extensions: Type.Record(Type.String(), Type.Unknown()),
    contentHash: Type.String(),
    occurredAt: Type.String(),
    receivedAt: Type.String(),
    expiresAt: Type.String(),
    outOfOrder: Type.Boolean(),
    serverSequence: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const ContextIngestResponseSchema = Type.Object(
  {
    event: ContextEventRecordSchema,
    duplicate: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ContextEventPageSchema = Type.Object(
  {
    items: Type.Array(ContextEventRecordSchema),
    nextCursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ContextErrorResponseSchema = Type.Object(
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

export interface ContextEventListQueryDto {
  readonly cursor?: string;
  readonly limit?: number;
  readonly source?: string;
  readonly type?: string;
  readonly subject?: string;
  readonly includeExpired?: boolean;
  readonly asOf?: string;
}
