import { Type, type Static } from "@sinclair/typebox";
import {
  EntityIdSchema,
  EventTypeSchema,
  JsonObjectSchema,
  SchemaVersionSchema,
  SensitivitySchema,
  ShortIdSchema,
  UtcIsoTimestampSchema,
} from "./common";

export const EventSourceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("SYSTEM"),
      Type.Literal("EDITOR"),
      Type.Literal("BROWSER"),
      Type.Literal("FILE_SYSTEM"),
      Type.Literal("USER"),
      Type.Literal("INTERNAL"),
    ]),
    name: Type.String({ minLength: 1, maxLength: 64 }),
    version: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  },
  { additionalProperties: false },
);

export const ContextEventSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("event"),
    id: EntityIdSchema,
    type: EventTypeSchema,
    source: EventSourceSchema,
    occurredAt: UtcIsoTimestampSchema,
    observedAt: UtcIsoTimestampSchema,
    sensitivity: SensitivitySchema,
    ttlSeconds: Type.Integer({ minimum: 1, maximum: 2_592_000 }),
    payload: JsonObjectSchema,
    correlationId: Type.Optional(EntityIdSchema),
    causationId: Type.Optional(EntityIdSchema),
    tags: Type.Optional(
      Type.Array(ShortIdSchema, {
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
      }),
    ),
  },
  { additionalProperties: false, $id: "MusesContextEvent" },
);

export type EventSource = Static<typeof EventSourceSchema>;
export type ContextEvent = Static<typeof ContextEventSchema>;
