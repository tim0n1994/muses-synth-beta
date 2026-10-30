import { Type, type Static } from "@sinclair/typebox";
import {
  EntityIdSchema,
  EventTypeSchema,
  SensitivitySchema,
  ShortIdSchema,
} from "./common";

const ComponentCommonProperties = {
  id: ShortIdSchema,
  order: Type.Integer({ minimum: 0, maximum: 10_000 }),
  visible: Type.Boolean(),
} as const;

export const StateHeroComponentSchema = Type.Object(
  {
    ...ComponentCommonProperties,
    type: Type.Literal("state.hero"),
    props: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 120 }),
        subjectId: EntityIdSchema,
        showConfidence: Type.Boolean(),
        showFreshness: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const BeliefDistributionComponentSchema = Type.Object(
  {
    ...ComponentCommonProperties,
    type: Type.Literal("belief.distribution"),
    props: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 120 }),
        beliefId: EntityIdSchema,
        factorIds: Type.Optional(
          Type.Array(ShortIdSchema, {
            minItems: 1,
            maxItems: 32,
            uniqueItems: true,
          }),
        ),
        showUnknown: Type.Boolean(),
        precision: Type.Integer({ minimum: 0, maximum: 4 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const EvidenceListComponentSchema = Type.Object(
  {
    ...ComponentCommonProperties,
    type: Type.Literal("evidence.list"),
    props: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 120 }),
        beliefId: EntityIdSchema,
        limit: Type.Integer({ minimum: 1, maximum: 100 }),
        showNeutral: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const EventsTimelineComponentSchema = Type.Object(
  {
    ...ComponentCommonProperties,
    type: Type.Literal("events.timeline"),
    props: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 120 }),
        eventTypes: Type.Optional(
          Type.Array(EventTypeSchema, {
            minItems: 1,
            maxItems: 64,
            uniqueItems: true,
          }),
        ),
        limit: Type.Integer({ minimum: 1, maximum: 500 }),
        sensitivityCeiling: SensitivitySchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const DecisionCardComponentSchema = Type.Object(
  {
    ...ComponentCommonProperties,
    type: Type.Literal("decision.card"),
    props: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 120 }),
        decisionId: Type.Optional(EntityIdSchema),
        showRationale: Type.Boolean(),
        showRollback: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AudioControlComponentSchema = Type.Object(
  {
    ...ComponentCommonProperties,
    type: Type.Literal("audio.control"),
    props: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 120 }),
        showPlayPause: Type.Boolean(),
        showVolume: Type.Boolean(),
        showProfile: Type.Boolean(),
        confirmProfileChange: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const MetricDefinitionSchema = Type.Object(
  {
    id: ShortIdSchema,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    unit: Type.Optional(Type.String({ minLength: 1, maxLength: 24 })),
    precision: Type.Integer({ minimum: 0, maximum: 4 }),
  },
  { additionalProperties: false },
);

export const MetricsGridComponentSchema = Type.Object(
  {
    ...ComponentCommonProperties,
    type: Type.Literal("metrics.grid"),
    props: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 120 }),
        metrics: Type.Array(MetricDefinitionSchema, {
          minItems: 1,
          maxItems: 24,
        }),
        columns: Type.Integer({ minimum: 1, maximum: 4 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PrivacyStatusComponentSchema = Type.Object(
  {
    ...ComponentCommonProperties,
    type: Type.Literal("privacy.status"),
    props: Type.Object(
      {
        title: Type.String({ minLength: 1, maxLength: 120 }),
        showRetention: Type.Boolean(),
        showSensitivity: Type.Boolean(),
        showStorage: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const DashboardComponentSchema = Type.Union([
  StateHeroComponentSchema,
  BeliefDistributionComponentSchema,
  EvidenceListComponentSchema,
  EventsTimelineComponentSchema,
  DecisionCardComponentSchema,
  AudioControlComponentSchema,
  MetricsGridComponentSchema,
  PrivacyStatusComponentSchema,
]);

export type StateHeroComponent = Static<typeof StateHeroComponentSchema>;
export type BeliefDistributionComponent = Static<
  typeof BeliefDistributionComponentSchema
>;
export type EvidenceListComponent = Static<typeof EvidenceListComponentSchema>;
export type EventsTimelineComponent = Static<
  typeof EventsTimelineComponentSchema
>;
export type DecisionCardComponent = Static<typeof DecisionCardComponentSchema>;
export type AudioControlComponent = Static<typeof AudioControlComponentSchema>;
export type MetricDefinition = Static<typeof MetricDefinitionSchema>;
export type MetricsGridComponent = Static<typeof MetricsGridComponentSchema>;
export type PrivacyStatusComponent = Static<
  typeof PrivacyStatusComponentSchema
>;
export type DashboardComponent = Static<typeof DashboardComponentSchema>;
