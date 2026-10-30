import type { LanguageCode, MessageKey } from "../../i18n";

/**
 * The client-side mirror of the server's `SettingsDocument`.
 *
 * The server is the authority (AGENTS.md: "Settings must be validated and
 * persisted by the local server"). This module exists so the workspace can
 * edit and preflight a document without inventing a second vocabulary — every
 * field here maps 1:1 onto `src/server/settings/schema.ts`. When the two
 * disagree, the server wins and its 422 violations are surfaced verbatim.
 */

export const SETTINGS_SCHEMA_VERSION = 4;

export const WORK_STATES = [
  "EXPLORE",
  "BUILD",
  "DEBUG",
  "REVIEW",
  "WAIT",
  "BREAK",
  "UNKNOWN",
] as const;
export type WorkState = (typeof WORK_STATES)[number];

export const SIGNAL_IDS = [
  "ide.activity",
  "git.activity",
  "app.focus",
  "terminal.activity",
  "manual.feedback",
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

export const WIDGET_TYPES = [
  "state.hero",
  "belief.distribution",
  "evidence.list",
  "events.timeline",
  "decision.card",
  "audio.control",
  "metrics.grid",
  "privacy.status",
  "llm.narration",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const METRIC_IDS = [
  "belief.confidence",
  "belief.stability",
  "events.rate",
  "effects.reversalRate",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export interface StateHeroWidget {
  id: string;
  type: "state.hero";
  showConfidence: boolean;
  showUnknownReason: boolean;
}

export interface BeliefDistributionWidget {
  id: string;
  type: "belief.distribution";
  maxStates: number;
  showFactorContributions: boolean;
}

export interface EvidenceListWidget {
  id: string;
  type: "evidence.list";
  limit: number;
  showSource: boolean;
}

export interface EventsTimelineWidget {
  id: string;
  type: "events.timeline";
  limit: number;
  showPayloadSummary: boolean;
}

export interface DecisionCardWidget {
  id: string;
  type: "decision.card";
  showNoAction: boolean;
  showUndoAvailability: boolean;
}

export interface AudioControlWidget {
  id: string;
  type: "audio.control";
  allowManualOverride: boolean;
  showMasterVolume: boolean;
}

export interface MetricsGridWidget {
  id: string;
  type: "metrics.grid";
  metrics: MetricId[];
}

export interface PrivacyStatusWidget {
  id: string;
  type: "privacy.status";
  showRetention: boolean;
  showExcludedApplications: boolean;
}

export interface LlmNarrationWidget {
  id: string;
  type: "llm.narration";
  showModel: boolean;
}

export type Widget =
  | StateHeroWidget
  | BeliefDistributionWidget
  | EvidenceListWidget
  | EventsTimelineWidget
  | DecisionCardWidget
  | AudioControlWidget
  | MetricsGridWidget
  | PrivacyStatusWidget
  | LlmNarrationWidget;

export interface Signal {
  id: SignalId;
  enabled: boolean;
  retainRaw: boolean;
  weight: number;
}

export interface StateAudioProfile {
  state: WorkState;
  soundscapeId: string | null;
  targetGain: number;
  transitionMs: number;
}

export interface QuietHours {
  enabled: boolean;
  startMinuteInclusive: number;
  endMinuteExclusive: number;
}

export interface AppearanceSection {
  productName: string;
  theme: "system" | "light" | "dark";
  accentColor: string;
  density: "comfortable" | "compact";
  reducedMotion: boolean;
  /** Interface language; the web catalog mirrors the server's v4 schema. */
  language: LanguageCode;
}

export interface BeliefSection {
  states: WorkState[];
  unknownState: "UNKNOWN";
  minimumConfidence: number;
  minimumMargin: number;
  stabilityWindowMs: number;
}

export interface DecisionSection {
  unknownOutcome: "NO_ACTION";
  lowConfidenceOutcome: "NO_ACTION";
  reversibleEffectsOnly: true;
  cooldownMs: number;
  manualUndoWindowMs: number;
  quietHours: QuietHours;
}

export interface AudioSection {
  enabled: boolean;
  masterGain: number;
  profiles: StateAudioProfile[];
}

export interface PrivacySection {
  localOnly: true;
  cloudSync: false;
  rawEventRetentionHours: number;
  sessionHistoryRetentionDays: number;
  excludedApplications: string[];
  captureScreenContent: boolean;
}

/**
 * The optional LLM narration enhancement — deliberately two scalars. The
 * gateway base URL and API key live only in the deployment environment and
 * never enter this document (it flows into release history and audit
 * events). `model` is a gateway alias; "auto" defers the pick per request.
 */
export interface LlmSection {
  enabled: boolean;
  model: string;
}

export interface SettingsDocument {
  schemaVersion: number;
  profile: { id: string; name: string };
  appearance: AppearanceSection;
  belief: BeliefSection;
  decision: DecisionSection;
  signals: Signal[];
  audio: AudioSection;
  privacy: PrivacySection;
  llm: LlmSection;
  surface: { widgets: Widget[] };
}

export const SETTINGS_SECTIONS = [
  "appearance",
  "belief",
  "decision",
  "signals",
  "audio",
  "privacy",
  "llm",
  "surface",
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsDraft {
  id: "primary";
  baseReleaseId: string | null;
  revision: number;
  schemaVersion: number;
  document: SettingsDocument;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsRelease {
  id: string;
  releaseNumber: number;
  parentReleaseId: string | null;
  rollbackOfReleaseId: string | null;
  sourceDraftRevision: number;
  schemaVersion: number;
  document: SettingsDocument;
  checksum: string;
  actor: string;
  reason: string;
  publishedAt: string;
  createdAt: string;
}

export interface SettingsSnapshot {
  draft: SettingsDraft;
  currentRelease: SettingsRelease;
}

export interface SettingsPreview {
  valid: true;
  checksum: string;
  againstReleaseId: string;
  againstChecksum: string;
  changedPaths: string[];
  changed: boolean;
  document: SettingsDocument;
}

export interface PublishResult {
  release: SettingsRelease;
  draft: SettingsDraft;
}

export interface FieldViolation {
  path: string;
  message: string;
  code: string;
}

// --- guards -----------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Shallow structural check. The server already validated the document against
 * the full JSON Schema before sending it; this guard exists to reject a
 * response that is not a settings payload at all (a proxy error page, an
 * unexpected envelope), not to re-implement schema validation in the browser.
 */
export function isSettingsDocument(value: unknown): value is SettingsDocument {
  if (!isRecord(value)) {
    return false;
  }
  const sections = [
    "profile",
    "appearance",
    "belief",
    "decision",
    "audio",
    "privacy",
    "llm",
    "surface",
  ];
  return (
    typeof value["schemaVersion"] === "number" &&
    Array.isArray(value["signals"]) &&
    sections.every((section) => isRecord(value[section])) &&
    Array.isArray((value["surface"] as Record<string, unknown>)["widgets"])
  );
}

export function isSettingsDraft(value: unknown): value is SettingsDraft {
  return (
    isRecord(value) &&
    value["id"] === "primary" &&
    typeof value["revision"] === "number" &&
    typeof value["checksum"] === "string" &&
    isSettingsDocument(value["document"])
  );
}

export function isSettingsRelease(value: unknown): value is SettingsRelease {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["releaseNumber"] === "number" &&
    typeof value["checksum"] === "string" &&
    isSettingsDocument(value["document"])
  );
}

export function isSettingsSnapshot(value: unknown): value is SettingsSnapshot {
  return (
    isRecord(value) &&
    isSettingsDraft(value["draft"]) &&
    isSettingsRelease(value["currentRelease"])
  );
}

export function isSettingsPreview(value: unknown): value is SettingsPreview {
  return (
    isRecord(value) &&
    value["valid"] === true &&
    Array.isArray(value["changedPaths"]) &&
    isSettingsDocument(value["document"])
  );
}

export function isReleaseArray(value: unknown): value is SettingsRelease[] {
  return Array.isArray(value) && value.every(isSettingsRelease);
}

export function isPublishResult(value: unknown): value is PublishResult {
  return (
    isRecord(value) &&
    isSettingsRelease(value["release"]) &&
    isSettingsDraft(value["draft"])
  );
}

// --- helpers ----------------------------------------------------------------

export function cloneSettingsDocument(
  document: SettingsDocument,
): SettingsDocument {
  return structuredClone(document);
}

export function releaseLabel(release: SettingsRelease): string {
  return `r${release.releaseNumber}`;
}

export function draftLabel(draft: SettingsDraft): string {
  return `draft ${draft.revision}`;
}

export function minutesToClock(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function clockToMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (match === null) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export interface WidgetDefinition {
  type: WidgetType;
  /** Message-catalog key, translated at the render site. */
  label: MessageKey;
  /** Message-catalog key, translated at the render site. */
  description: MessageKey;
  create: (id: string) => Widget;
}

export const WIDGET_DEFINITIONS: readonly WidgetDefinition[] = [
  {
    type: "state.hero",
    label: "settings.widget.stateHero.label",
    description: "settings.widget.stateHero.description",
    create: (id) => ({
      id,
      type: "state.hero",
      showConfidence: true,
      showUnknownReason: true,
    }),
  },
  {
    type: "belief.distribution",
    label: "settings.widget.beliefDistribution.label",
    description: "settings.widget.beliefDistribution.description",
    create: (id) => ({
      id,
      type: "belief.distribution",
      maxStates: 5,
      showFactorContributions: true,
    }),
  },
  {
    type: "evidence.list",
    label: "settings.widget.evidenceList.label",
    description: "settings.widget.evidenceList.description",
    create: (id) => ({
      id,
      type: "evidence.list",
      limit: 10,
      showSource: true,
    }),
  },
  {
    type: "events.timeline",
    label: "settings.widget.eventsTimeline.label",
    description: "settings.widget.eventsTimeline.description",
    create: (id) => ({
      id,
      type: "events.timeline",
      limit: 50,
      showPayloadSummary: true,
    }),
  },
  {
    type: "decision.card",
    label: "settings.widget.decisionCard.label",
    description: "settings.widget.decisionCard.description",
    create: (id) => ({
      id,
      type: "decision.card",
      showNoAction: true,
      showUndoAvailability: true,
    }),
  },
  {
    type: "audio.control",
    label: "settings.widget.audioControl.label",
    description: "settings.widget.audioControl.description",
    create: (id) => ({
      id,
      type: "audio.control",
      allowManualOverride: true,
      showMasterVolume: true,
    }),
  },
  {
    type: "metrics.grid",
    label: "settings.widget.metricsGrid.label",
    description: "settings.widget.metricsGrid.description",
    create: (id) => ({
      id,
      type: "metrics.grid",
      metrics: ["belief.confidence", "events.rate"],
    }),
  },
  {
    type: "privacy.status",
    label: "settings.widget.privacyStatus.label",
    description: "settings.widget.privacyStatus.description",
    create: (id) => ({
      id,
      type: "privacy.status",
      showRetention: true,
      showExcludedApplications: true,
    }),
  },
  {
    type: "llm.narration",
    label: "settings.widget.llmNarration.label",
    description: "settings.widget.llmNarration.description",
    create: (id) => ({
      id,
      type: "llm.narration",
      showModel: true,
    }),
  },
];

export function widgetDefinition(type: WidgetType): WidgetDefinition {
  const found = WIDGET_DEFINITIONS.find(
    (definition) => definition.type === type,
  );
  if (found === undefined) {
    throw new Error(`Unknown widget type ${type}`);
  }
  return found;
}

export function createWidget(type: WidgetType, existing: Widget[]): Widget {
  const taken = new Set(existing.map((widget) => widget.id));
  const base = type.replace(".", "-");
  let suffix = 1;
  let id = base;
  while (taken.has(id)) {
    suffix += 1;
    id = `${base}-${suffix}`;
  }
  return widgetDefinition(type).create(id);
}

/**
 * Client preflight mirroring the server's semantic invariants
 * (`validateSemanticInvariants`). Catching these in the browser turns a 422
 * round trip into inline field errors; the server still re-checks every one.
 */
export function validateSettingsDocument(
  document: SettingsDocument,
): FieldViolation[] {
  const violations: FieldViolation[] = [];

  const stateSet = new Set(document.belief.states);
  for (const state of WORK_STATES) {
    if (!stateSet.has(state)) {
      violations.push({
        path: "belief.states",
        code: "MISSING_STATE",
        message: `Missing required state ${state}.`,
      });
    }
  }

  const profileStates = new Set(
    document.audio.profiles.map((profile) => profile.state),
  );
  for (const state of WORK_STATES) {
    if (!profileStates.has(state)) {
      violations.push({
        path: "audio.profiles",
        code: "MISSING_AUDIO_PROFILE",
        message: `Missing audio profile for ${state}.`,
      });
    }
  }
  if (profileStates.size !== document.audio.profiles.length) {
    violations.push({
      path: "audio.profiles",
      code: "DUPLICATE_AUDIO_PROFILE",
      message: "Audio profile states must be unique.",
    });
  }

  const unknownProfile = document.audio.profiles.find(
    (profile) => profile.state === "UNKNOWN",
  );
  if (
    unknownProfile !== undefined &&
    (unknownProfile.soundscapeId !== null || unknownProfile.targetGain !== 0)
  ) {
    violations.push({
      path: "audio.profiles",
      code: "UNKNOWN_NOT_SILENT",
      message: "UNKNOWN must map to silence: no soundscape and zero gain.",
    });
  }

  const signalIds = new Set(document.signals.map((signal) => signal.id));
  if (signalIds.size !== document.signals.length) {
    violations.push({
      path: "signals",
      code: "DUPLICATE_SIGNAL",
      message: "Signal ids must be unique.",
    });
  }

  const widgetIds = new Set(document.surface.widgets.map((w) => w.id));
  if (widgetIds.size !== document.surface.widgets.length) {
    violations.push({
      path: "surface.widgets",
      code: "DUPLICATE_WIDGET",
      message: "Widget ids must be unique.",
    });
  }
  if (document.surface.widgets.length === 0) {
    violations.push({
      path: "surface.widgets",
      code: "EMPTY_SURFACE",
      message: "The dashboard needs at least one widget.",
    });
  }

  return violations;
}
