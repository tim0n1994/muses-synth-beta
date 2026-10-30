import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { Type, type Static, type TSchema } from "@sinclair/typebox";

const nonEmptyId = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9._:-]+$",
});

export const WorkStateSchema = Type.Union([
  Type.Literal("EXPLORE"),
  Type.Literal("BUILD"),
  Type.Literal("DEBUG"),
  Type.Literal("REVIEW"),
  Type.Literal("WAIT"),
  Type.Literal("BREAK"),
  Type.Literal("UNKNOWN"),
]);
export type WorkState = Static<typeof WorkStateSchema>;

export const WidgetTypeSchema = Type.Union([
  Type.Literal("state.hero"),
  Type.Literal("belief.distribution"),
  Type.Literal("evidence.list"),
  Type.Literal("events.timeline"),
  Type.Literal("decision.card"),
  Type.Literal("audio.control"),
  Type.Literal("metrics.grid"),
  Type.Literal("privacy.status"),
  Type.Literal("llm.narration"),
]);
export type WidgetType = Static<typeof WidgetTypeSchema>;

const StateHeroWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("state.hero"),
    showConfidence: Type.Boolean(),
    showUnknownReason: Type.Boolean(),
  },
  { additionalProperties: false },
);

const BeliefDistributionWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("belief.distribution"),
    maxStates: Type.Integer({ minimum: 2, maximum: 7 }),
    showFactorContributions: Type.Boolean(),
  },
  { additionalProperties: false },
);

const EvidenceListWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("evidence.list"),
    limit: Type.Integer({ minimum: 1, maximum: 100 }),
    showSource: Type.Boolean(),
  },
  { additionalProperties: false },
);

const EventsTimelineWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("events.timeline"),
    limit: Type.Integer({ minimum: 1, maximum: 500 }),
    showPayloadSummary: Type.Boolean(),
  },
  { additionalProperties: false },
);

const DecisionCardWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("decision.card"),
    showNoAction: Type.Boolean(),
    showUndoAvailability: Type.Boolean(),
  },
  { additionalProperties: false },
);

const AudioControlWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("audio.control"),
    allowManualOverride: Type.Boolean(),
    showMasterVolume: Type.Boolean(),
  },
  { additionalProperties: false },
);

const MetricsGridWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("metrics.grid"),
    metrics: Type.Array(
      Type.Union([
        Type.Literal("belief.confidence"),
        Type.Literal("belief.stability"),
        Type.Literal("events.rate"),
        Type.Literal("effects.reversalRate"),
      ]),
      { minItems: 1, maxItems: 4, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
);

const PrivacyStatusWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("privacy.status"),
    showRetention: Type.Boolean(),
    showExcludedApplications: Type.Boolean(),
  },
  { additionalProperties: false },
);

const LlmNarrationWidgetSchema = Type.Object(
  {
    id: nonEmptyId,
    type: Type.Literal("llm.narration"),
    showModel: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const WidgetSchema = Type.Union([
  StateHeroWidgetSchema,
  BeliefDistributionWidgetSchema,
  EvidenceListWidgetSchema,
  EventsTimelineWidgetSchema,
  DecisionCardWidgetSchema,
  AudioControlWidgetSchema,
  MetricsGridWidgetSchema,
  PrivacyStatusWidgetSchema,
  LlmNarrationWidgetSchema,
]);
export type Widget = Static<typeof WidgetSchema>;

const SignalSchema = Type.Object(
  {
    id: Type.Union([
      Type.Literal("ide.activity"),
      Type.Literal("git.activity"),
      Type.Literal("app.focus"),
      Type.Literal("terminal.activity"),
      Type.Literal("manual.feedback"),
    ]),
    enabled: Type.Boolean(),
    retainRaw: Type.Boolean(),
    weight: Type.Number({ minimum: 0, maximum: 2 }),
  },
  { additionalProperties: false },
);

const StateAudioProfileSchema = Type.Object(
  {
    state: WorkStateSchema,
    soundscapeId: Type.Union([nonEmptyId, Type.Null()]),
    targetGain: Type.Number({ minimum: 0, maximum: 1 }),
    transitionMs: Type.Integer({ minimum: 0, maximum: 60_000 }),
  },
  { additionalProperties: false },
);

/**
 * The UI language for display copy and generated narration. A closed enum by
 * design: adding a language is a schema change, not a free-form setting, so a stored
 * document can never name a language the web bundle has no catalog for.
 */
export const LanguageCodeSchema = Type.Union([
  Type.Literal("en"),
  Type.Literal("zh"),
  Type.Literal("ja"),
  Type.Literal("fr"),
  Type.Literal("es"),
]);
export type LanguageCode = Static<typeof LanguageCodeSchema>;

/**
 * Appearance is the one PRD-v0.1 §5.3 section the v1 document never had a home
 * for, so the web settings workspace kept its own parallel copy. It is server
 * authority now like every other section.
 */
const AppearanceSchema = Type.Object(
  {
    productName: Type.String({ minLength: 1, maxLength: 80 }),
    theme: Type.Union([
      Type.Literal("system"),
      Type.Literal("light"),
      Type.Literal("dark"),
    ]),
    accentColor: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
    density: Type.Union([Type.Literal("comfortable"), Type.Literal("compact")]),
    reducedMotion: Type.Boolean(),
    language: LanguageCodeSchema,
  },
  { additionalProperties: false },
);

/**
 * Mirrors the policy engine's `QuietHours` contract field-for-field so
 * `settingsToPolicySettings` can forward it without a translation step.
 * Minutes are local-clock minutes since midnight; start === end means "always
 * quiet", and start > end wraps across midnight.
 */
const QuietHoursSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    startMinuteInclusive: Type.Integer({ minimum: 0, maximum: 1_439 }),
    endMinuteExclusive: Type.Integer({ minimum: 0, maximum: 1_439 }),
  },
  { additionalProperties: false },
);

/**
 * The optional LLM narration enhancement. Deliberately two scalars and nothing
 * else: the gateway base URL and API key live only in the deployment
 * environment (MODULE-03 forbids remote URLs and credentials in this document,
 * and the canonical-JSON document flows into release history and audit
 * events). `model` is a gateway alias; "auto" defers the choice to the gateway
 * per request. The pattern bans spaces and specials, which also closes the
 * obvious injection vectors before they can reach prompt assembly.
 */
export const LlmSectionSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    model: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:/@-]+$",
    }),
  },
  { additionalProperties: false },
);
export type LlmSection = Static<typeof LlmSectionSchema>;

export const SETTINGS_SCHEMA_VERSION = 4;

export const SettingsDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SETTINGS_SCHEMA_VERSION),
    profile: Type.Object(
      {
        id: nonEmptyId,
        name: Type.String({ minLength: 1, maxLength: 80 }),
      },
      { additionalProperties: false },
    ),
    appearance: AppearanceSchema,
    belief: Type.Object(
      {
        states: Type.Array(WorkStateSchema, {
          minItems: 7,
          maxItems: 7,
          uniqueItems: true,
        }),
        unknownState: Type.Literal("UNKNOWN"),
        minimumConfidence: Type.Number({ minimum: 0.5, maximum: 1 }),
        minimumMargin: Type.Number({ minimum: 0, maximum: 1 }),
        stabilityWindowMs: Type.Integer({ minimum: 1_000, maximum: 3_600_000 }),
      },
      { additionalProperties: false },
    ),
    decision: Type.Object(
      {
        unknownOutcome: Type.Literal("NO_ACTION"),
        lowConfidenceOutcome: Type.Literal("NO_ACTION"),
        reversibleEffectsOnly: Type.Literal(true),
        cooldownMs: Type.Integer({ minimum: 0, maximum: 3_600_000 }),
        manualUndoWindowMs: Type.Integer({
          minimum: 1_000,
          maximum: 86_400_000,
        }),
        quietHours: QuietHoursSchema,
      },
      { additionalProperties: false },
    ),
    signals: Type.Array(SignalSchema, {
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
    }),
    audio: Type.Object(
      {
        enabled: Type.Boolean(),
        masterGain: Type.Number({ minimum: 0, maximum: 1 }),
        profiles: Type.Array(StateAudioProfileSchema, {
          minItems: 7,
          maxItems: 7,
        }),
      },
      { additionalProperties: false },
    ),
    privacy: Type.Object(
      {
        localOnly: Type.Literal(true),
        cloudSync: Type.Literal(false),
        rawEventRetentionHours: Type.Integer({ minimum: 0, maximum: 24 * 90 }),
        sessionHistoryRetentionDays: Type.Integer({ minimum: 1, maximum: 365 }),
        excludedApplications: Type.Array(
          Type.String({ minLength: 1, maxLength: 255 }),
          {
            maxItems: 200,
            uniqueItems: true,
          },
        ),
        captureScreenContent: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    llm: LlmSectionSchema,
    surface: Type.Object(
      {
        widgets: Type.Array(WidgetSchema, { minItems: 1, maxItems: 32 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type SettingsDocument = Static<typeof SettingsDocumentSchema>;

export interface ValidationIssue {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

function createValidator<T>(schema: TSchema): ValidateFunction<T> {
  const ajv = new Ajv({
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    strict: true,
  });
  return ajv.compile<T>(schema);
}

const validateSettingsDocument = createValidator<SettingsDocument>(
  SettingsDocumentSchema,
);

function mapIssue(error: ErrorObject): ValidationIssue {
  return {
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? "validation failed",
  };
}

function validateSemanticInvariants(
  document: SettingsDocument,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const requiredStates: readonly WorkState[] = [
    "EXPLORE",
    "BUILD",
    "DEBUG",
    "REVIEW",
    "WAIT",
    "BREAK",
    "UNKNOWN",
  ];
  const stateSet = new Set(document.belief.states);
  for (const state of requiredStates) {
    if (!stateSet.has(state)) {
      issues.push({
        instancePath: "/belief/states",
        keyword: "semantic",
        message: `missing required state ${state}`,
      });
    }
  }

  const profileStates = new Set(
    document.audio.profiles.map((profile) => profile.state),
  );
  for (const state of requiredStates) {
    if (!profileStates.has(state)) {
      issues.push({
        instancePath: "/audio/profiles",
        keyword: "semantic",
        message: `missing audio profile for ${state}`,
      });
    }
  }
  if (profileStates.size !== document.audio.profiles.length) {
    issues.push({
      instancePath: "/audio/profiles",
      keyword: "semantic",
      message: "audio profile states must be unique",
    });
  }

  const signalIds = new Set(document.signals.map((signal) => signal.id));
  if (signalIds.size !== document.signals.length) {
    issues.push({
      instancePath: "/signals",
      keyword: "semantic",
      message: "signal ids must be unique",
    });
  }

  const widgetIds = new Set(
    document.surface.widgets.map((widget) => widget.id),
  );
  if (widgetIds.size !== document.surface.widgets.length) {
    issues.push({
      instancePath: "/surface/widgets",
      keyword: "semantic",
      message: "widget ids must be unique",
    });
  }

  const unknownProfile = document.audio.profiles.find(
    (profile) => profile.state === "UNKNOWN",
  );
  if (
    unknownProfile?.soundscapeId !== null ||
    unknownProfile.targetGain !== 0
  ) {
    issues.push({
      instancePath: "/audio/profiles",
      keyword: "semantic",
      message: "UNKNOWN must map to silence (null soundscape and zero gain)",
    });
  }

  return issues;
}

export function validateSettings(value: unknown): ValidationResult {
  if (!validateSettingsDocument(value)) {
    return {
      valid: false,
      issues: (validateSettingsDocument.errors ?? []).map(mapIssue),
    };
  }
  const semanticIssues = validateSemanticInvariants(value);
  return { valid: semanticIssues.length === 0, issues: semanticIssues };
}

export const DEFAULT_APPEARANCE: Static<typeof AppearanceSchema> = {
  productName: "Muses",
  theme: "system",
  accentColor: "#6c8cff",
  density: "comfortable",
  reducedMotion: false,
  language: "en",
};

export const DEFAULT_QUIET_HOURS: Static<typeof QuietHoursSchema> = {
  enabled: false,
  startMinuteInclusive: 22 * 60,
  endMinuteExclusive: 8 * 60,
};

export const DEFAULT_LLM_SECTION: LlmSection = {
  enabled: false,
  model: "auto",
};

/**
 * Brings a stored document up to `SETTINGS_SCHEMA_VERSION`. Every step is a
 * strict widening that removes nothing, so no stored row has to be rewritten;
 * callers verify the checksum against the *stored* value before upgrading,
 * which keeps published releases byte-identical and their audit checksums
 * valid forever.
 *
 * The chain upgrades one version at a time, and each intermediate step stamps
 * a *numeric literal* — never `SETTINGS_SCHEMA_VERSION` — so bumping the
 * current version can never produce a "current version but missing section"
 * document that the read-path integrity check would then reject. v1 → v2 adds
 * `appearance` and `decision.quietHours`; v2 → v3 adds `llm`; v3 → v4
 * adds `appearance.language`.
 *
 * Upgrades inject constant defaults, never environment values: the stored
 * bytes must stay independent of the machine that reads them.
 *
 * Anything that is not a recognizable older document is passed through
 * untouched so the caller's schema validation produces the real error.
 */
export function upgradeSettingsDocument(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version === 1) {
    const v1 = value as Record<string, unknown>;
    const decision =
      typeof v1["decision"] === "object" &&
      v1["decision"] !== null &&
      !Array.isArray(v1["decision"])
        ? (v1["decision"] as Record<string, unknown>)
        : {};
    const v2 = {
      ...v1,
      // Numeric literal on purpose (see the docblock): an intermediate
      // document is a v2 document, whatever the current version is.
      schemaVersion: 2,
      appearance: DEFAULT_APPEARANCE,
      decision: { ...decision, quietHours: DEFAULT_QUIET_HOURS },
    };
    return upgradeFromV3(upgradeFromV2(v2));
  }
  if (version === 2) {
    return upgradeFromV3(upgradeFromV2(value as Record<string, unknown>));
  }
  if (version === 3) {
    return upgradeFromV3(value as Record<string, unknown>);
  }
  return value;
}

const upgradeFromV2 = (
  input: Record<string, unknown>,
): Record<string, unknown> => ({
  ...input,
  // Numeric literal on purpose (see the docblock): an intermediate document
  // is a v3 document, whatever the current version is.
  schemaVersion: 3,
  llm: DEFAULT_LLM_SECTION,
});

const upgradeFromV3 = (
  input: Record<string, unknown>,
): Record<string, unknown> => ({
  ...input,
  // Numeric literal on purpose (see the docblock): an intermediate document
  // is a v4 document, whatever the current version is.
  schemaVersion: 4,
  appearance: {
    ...(input["appearance"] as Record<string, unknown> | undefined),
    language: DEFAULT_APPEARANCE.language,
  },
});

export function parseSettings(value: unknown): SettingsDocument {
  const result = validateSettings(value);
  if (!result.valid) {
    const summary = result.issues
      .map((issue) => `${issue.instancePath || "/"}: ${issue.message}`)
      .join("; ");
    throw new TypeError(`Invalid settings document: ${summary}`);
  }
  return structuredClone(value as SettingsDocument);
}
