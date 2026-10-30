import { Type, type TSchema } from "@sinclair/typebox";

import { BELIEF_STATE_NAMES } from "../../server/belief/vocabulary";

const shortText = Type.String({ minLength: 1, maxLength: 240 });
const titleText = Type.String({ minLength: 1, maxLength: 80 });
const identifier = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: "^[A-Za-z0-9._:-]+$",
});
const probability = Type.Number({ minimum: 0, maximum: 1 });

export const stateHeroSchema = Type.Object(
  {
    title: Type.Optional(titleText),
    status: Type.Union(BELIEF_STATE_NAMES.map((name) => Type.Literal(name))),
    statusLabel: Type.Optional(titleText),
    confidence: probability,
    summary: shortText,
    updatedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    unknownReason: Type.Optional(shortText),
  },
  { additionalProperties: false },
);

export const beliefDistributionSchema = Type.Object(
  {
    title: Type.Optional(titleText),
    factors: Type.Array(
      Type.Object(
        {
          id: identifier,
          label: titleText,
          probability,
          direction: Type.Union([
            Type.Literal(-1),
            Type.Literal(0),
            Type.Literal(1),
          ]),
          evidenceCount: Type.Integer({ minimum: 0, maximum: 100000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 12 },
    ),
  },
  { additionalProperties: false },
);

export const evidenceListSchema = Type.Object(
  {
    title: Type.Optional(titleText),
    evidence: Type.Array(
      Type.Object(
        {
          id: identifier,
          label: shortText,
          source: titleText,
          weight: Type.Number({ minimum: -1, maximum: 1 }),
          observedAt: Type.Optional(
            Type.String({ minLength: 1, maxLength: 64 }),
          ),
          explanation: Type.Optional(shortText),
        },
        { additionalProperties: false },
      ),
      { maxItems: 24 },
    ),
  },
  { additionalProperties: false },
);

export const eventsTimelineSchema = Type.Object(
  {
    title: Type.Optional(titleText),
    events: Type.Array(
      Type.Object(
        {
          id: identifier,
          kind: titleText,
          title: shortText,
          occurredAt: Type.String({ minLength: 1, maxLength: 64 }),
          summary: Type.Optional(shortText),
        },
        { additionalProperties: false },
      ),
      { maxItems: 50 },
    ),
  },
  { additionalProperties: false },
);

export const decisionCardSchema = Type.Object(
  {
    title: Type.Optional(titleText),
    decision: Type.Union([
      Type.Literal("NO_ACTION"),
      Type.Literal("SUGGEST_AUDIO"),
      Type.Literal("PAUSE_AUDIO"),
      Type.Literal("ADJUST_VOLUME"),
      Type.Literal("UNKNOWN"),
    ]),
    confidence: probability,
    rationale: shortText,
    reversible: Type.Boolean(),
    expiresAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export const audioControlSchema = Type.Object(
  {
    title: Type.Optional(titleText),
    playing: Type.Boolean(),
    trackTitle: Type.Optional(titleText),
    volume: Type.Integer({ minimum: 0, maximum: 100 }),
    muted: Type.Boolean(),
    disabledReason: Type.Optional(shortText),
  },
  { additionalProperties: false },
);

export const metricsGridSchema = Type.Object(
  {
    title: Type.Optional(titleText),
    metrics: Type.Array(
      Type.Object(
        {
          id: identifier,
          label: titleText,
          value: Type.String({ minLength: 1, maxLength: 48 }),
          trend: Type.Union([
            Type.Literal("up"),
            Type.Literal("down"),
            Type.Literal("flat"),
            Type.Literal("unknown"),
          ]),
          helpText: Type.Optional(shortText),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 16 },
    ),
  },
  { additionalProperties: false },
);

export const privacyStatusSchema = Type.Object(
  {
    title: Type.Optional(titleText),
    localOnly: Type.Boolean(),
    sensors: Type.Array(titleText, { maxItems: 24, uniqueItems: true }),
    retention: Type.String({ minLength: 1, maxLength: 80 }),
    lastExportAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    pendingDeletionCount: Type.Integer({ minimum: 0, maximum: 1000000 }),
  },
  { additionalProperties: false },
);

export const llmNarrationSchema = Type.Object(
  {
    available: Type.Boolean(),
    model: Type.String({ minLength: 1, maxLength: 80 }),
    reason: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false },
);

export const dashboardConfigSchema: TSchema = Type.Object(
  {
    schemaVersion: Type.String({ minLength: 1, maxLength: 16 }),
    dashboardId: identifier,
    title: Type.Optional(titleText),
    sections: Type.Array(
      Type.Object(
        {
          id: identifier,
          type: Type.String({ minLength: 1, maxLength: 64 }),
          schemaVersion: Type.String({ minLength: 1, maxLength: 16 }),
          props: Type.Unknown(),
          layout: Type.Object(
            {
              columnSpan: Type.Object(
                {
                  sm: Type.Integer({ minimum: 1, maximum: 4 }),
                  md: Type.Integer({ minimum: 1, maximum: 8 }),
                  lg: Type.Integer({ minimum: 1, maximum: 12 }),
                },
                { additionalProperties: false },
              ),
              order: Type.Optional(
                Type.Integer({ minimum: -1000, maximum: 1000 }),
              ),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
