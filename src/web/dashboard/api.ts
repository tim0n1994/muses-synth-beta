import { describeBeliefState } from "../../server/belief/vocabulary";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  resolveLocale,
  type LanguageCode,
  type MessageKey,
} from "../i18n";
import type {
  AudioControlData,
  BeliefDistributionData,
  BeliefFactor,
  DashboardApi,
  DashboardError,
  DashboardSnapshot,
  DecisionCardData,
  DecisionKind,
  DecisionStatus,
  EffectCommandResult,
  EventPage,
  EvidenceDirection,
  EvidenceItem,
  EvidenceListData,
  JsonValue,
  LlmCapabilityData,
  LlmTextResult,
  MetricItem,
  MetricsGridData,
  EffectOutcomeInput,
  ObservatoryEvent,
  PendingEffect,
  PrivacyCapability,
  SurfaceWidget,
  PrivacyStatusData,
  StateHeroData,
} from "./types";

// One aggregate read per refresh (ADR-0001) instead of four parallel fetches.
const BOOTSTRAP_PATH = "/api/v1/bootstrap";
const EVENTS_PATH = "/api/v1/context/events";
const EFFECT_OUTCOMES_PATH = "/api/v1/effects/outcomes";
const LLM_NARRATION_PATH = "/api/v1/llm/narration";
const LLM_SUMMARY_PATH = "/api/v1/llm/summary";

/** English is canonical for error messages (logs, snapshots, tests). */
const tEn = createTranslator(DEFAULT_LANGUAGE);

const DEFAULT_STALE_AFTER_MS = 60_000;
const EVIDENCE_ITEM_LIMIT = 20;
const EVENT_DETAIL_LIMIT = 280;
const ERROR_SNIPPET_LIMIT = 280;
// Server clamps at 2,000; this client-side line of defence is deliberately
// independent of which server version is running.
const LLM_TEXT_LIMIT = 4_000;
const LLM_MODEL_LIMIT = 128;

import { createAuthorizedFetch } from "../auth/authorized-fetch.js";

export class DashboardApiError extends Error implements DashboardError {
  public readonly kind: DashboardError["kind"];
  public readonly statusCode: number | undefined;
  public readonly retryable: boolean;
  public readonly messageKey: MessageKey | undefined;
  public readonly messageParams:
    Readonly<Record<string, string | number>> | undefined;

  public constructor(error: DashboardError) {
    super(error.message);
    this.name = "DashboardApiError";
    this.kind = error.kind;
    this.statusCode = error.statusCode;
    this.retryable = error.retryable;
    this.messageKey = error.messageKey;
    this.messageParams = error.messageParams;
  }
}

/**
 * Localized display of any dashboard error: client-generated messages carry a
 * catalog key, verbatim upstream text (server strings, network exceptions)
 * falls back to the stored canonical message.
 */
export function formatDashboardError(
  t: (
    key: MessageKey,
    params?: Readonly<Record<string, string | number>>,
  ) => string,
  error: DashboardError | null,
): string {
  if (error === null) {
    return "";
  }
  if (error.messageKey !== undefined) {
    return t(error.messageKey, error.messageParams);
  }
  return error.message;
}

interface DashboardApiOptions {
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

function joinUrl(baseUrl: string, path: string): string {
  if (baseUrl.length === 0) {
    return path;
  }
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw invalidResponse("api.error.expectedString", { key });
  }
  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw invalidResponse("api.error.expectedStringWhenPresent", { key });
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidResponse("api.error.expectedFiniteNumber", { key });
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw invalidResponse("api.error.expectedBoolean", { key });
  }
  return value;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedObject", { key });
  }
  return value;
}

function readOptionalArray(
  record: Record<string, unknown>,
  key: string,
): readonly unknown[] {
  const value = record[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidResponse("api.error.expectedArrayWhenPresent", { key });
  }
  return value;
}

function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  key: string,
): T {
  if (!allowed.some((candidate) => candidate === value)) {
    throw invalidResponse("api.error.unsupportedValue", { key, value });
  }
  return value as T;
}

function assertUnitInterval(value: number, key: string): number {
  if (value < 0 || value > 1) {
    throw invalidResponse("api.error.expectedUnitInterval", { key });
  }
  return value;
}

function assertIsoDate(value: string, key: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw invalidResponse("api.error.expectedIsoDate", { key });
  }
  return value;
}

function invalidResponse(
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): DashboardApiError {
  return new DashboardApiError({
    kind: "invalid-response",
    message: tEn(key, params),
    retryable: false,
    messageKey: key,
    messageParams: params,
  });
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function parsePrivacyStatus(value: unknown): PrivacyStatusData {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedPrivacyObject");
  }
  const cloudCallsEnabled = readBoolean(value, "cloudCallsEnabled");
  const apiKeysPresent = readBoolean(value, "apiKeysPresent");
  const localOnly = readBoolean(value, "localOnly");
  if (cloudCallsEnabled || apiKeysPresent || !localOnly) {
    throw invalidResponse("api.error.privacyNotLocalOnly");
  }
  const capabilities: PrivacyCapability[] = readOptionalArray(
    value,
    "capabilities",
  ).map((capability) => {
    if (!isRecord(capability)) {
      throw invalidResponse("api.error.expectedCapabilityObject");
    }
    return {
      id: readString(capability, "id"),
      label: readString(capability, "label"),
      enabled: readBoolean(capability, "enabled"),
      detail: readString(capability, "detail"),
    };
  });
  return {
    level: assertEnum(
      readString(value, "level"),
      ["local-only", "restricted", "warning"] as const,
      "level",
    ),
    localOnly: true,
    cloudCallsEnabled: false,
    apiKeysPresent: false,
    retentionLabel: readString(value, "retentionLabel"),
    databaseLabel: readString(value, "databaseLabel"),
    capabilities,
    checkedAt: assertIsoDate(readString(value, "checkedAt"), "checkedAt"),
  };
}

// -- Server-side contract parsing -------------------------------------------

const BELIEF_STATES = [
  "SETUP",
  "EXPLORE",
  "BUILD",
  "DEBUG",
  "REVIEW",
  "WAIT",
  "BREAK",
  "UNKNOWN",
] as const;
type ServerBeliefState = (typeof BELIEF_STATES)[number];

interface ServerEvidenceRef {
  readonly ruleId: string;
  readonly source: string;
  readonly eventId: string;
  readonly serverSequence: number;
  readonly occurredAt: string;
  readonly contribution: number;
  readonly factor: string;
}

interface ServerFactorBelief {
  readonly value: string;
  readonly confidence: number;
  readonly freshness: number;
  readonly evidence: readonly ServerEvidenceRef[];
}

interface ServerBeliefSnapshot {
  readonly state: ServerBeliefState;
  readonly confidence: number;
  readonly freshness: number;
  readonly factors: Record<string, ServerFactorBelief>;
  readonly evidence: readonly ServerEvidenceRef[];
  readonly unknownReasons: readonly string[];
  readonly explanation: readonly string[];
  readonly asOf: string;
  readonly rulesetVersion: string;
  readonly lastServerSequence?: number | undefined;
}

const DECISION_KINDS = [
  "NO_ACTION",
  "AUDIO_DIVERGE",
  "AUDIO_FLOW",
  "AUDIO_AUDIT",
  "AUDIO_DEBUG",
] as const;
type ServerDecisionKind = (typeof DECISION_KINDS)[number];

interface ServerDecisionFactor {
  readonly name: string;
  readonly contribution: number;
  readonly evidenceIds: readonly string[];
}

interface ServerDecision {
  readonly decisionId: string;
  readonly kind: ServerDecisionKind;
  readonly reason: string;
  readonly createdAt: string;
  readonly confidence: number;
  readonly explanation: {
    readonly summary: string;
    readonly factors: readonly ServerDecisionFactor[];
  };
  readonly effect: {
    readonly actionId: string;
    readonly profile: string;
    readonly targetGain: number;
    readonly rampMs: number;
  } | null;
}

interface ServerEffectOutcome {
  readonly outcomeId: string;
  readonly effectId: string;
  readonly status: "applied" | "skipped" | "failed" | "reverted";
  readonly reason: string;
  readonly detail: string | null;
  readonly observedAt: string;
}

interface ServerEffectLedgerEntry {
  readonly request: {
    readonly effectId: string;
    readonly decisionId: string;
    readonly actionId: string;
    readonly adjustment: {
      readonly profile: string;
      readonly targetGain: number;
      readonly rampMs: number;
    };
    readonly issuedAt: string;
  };
  readonly latestOutcome: ServerEffectOutcome | null;
}

interface ServerSettingsDocument {
  readonly language: LanguageCode;
  readonly audio: {
    readonly enabled: boolean;
    readonly masterGain: number;
  };
  readonly widgets: readonly SurfaceWidget[];
  readonly privacy: {
    readonly localOnly: boolean;
    readonly rawEventRetentionHours: number;
    readonly sessionHistoryRetentionDays: number;
    readonly excludedApplications: readonly string[];
    readonly captureScreenContent: boolean;
  };
}

interface ServerSettingsResponse {
  readonly currentRelease: {
    readonly document: ServerSettingsDocument;
  } | null;
}

interface ServerContextEventRecord {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly subject?: string | undefined;
  readonly time?: string | undefined;
  readonly data?: unknown;
  readonly extensions?: Record<string, unknown> | undefined;
  readonly occurredAt: string;
  readonly serverSequence: number;
}

function readStringArray(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw invalidResponse("api.error.expectedStringArray", { key });
  }
  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw invalidResponse("api.error.expectedStringArrayEntries", { key });
    }
    return entry;
  });
}

function parseServerEvidenceRef(value: unknown): ServerEvidenceRef {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedEvidenceObject");
  }
  return {
    ruleId: readString(value, "ruleId"),
    source: readString(value, "source"),
    eventId: readString(value, "eventId"),
    serverSequence: readNumber(value, "serverSequence"),
    occurredAt: assertIsoDate(readString(value, "occurredAt"), "occurredAt"),
    contribution: readNumber(value, "contribution"),
    factor: readString(value, "factor"),
  };
}

function parseServerFactor(value: unknown): ServerFactorBelief {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedFactorObject");
  }
  return {
    value: readString(value, "value"),
    confidence: assertUnitInterval(
      readNumber(value, "confidence"),
      "factor.confidence",
    ),
    freshness: assertUnitInterval(
      readNumber(value, "freshness"),
      "factor.freshness",
    ),
    evidence: readOptionalArray(value, "evidence").map(parseServerEvidenceRef),
  };
}

function parseServerBelief(value: unknown): ServerBeliefSnapshot {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedBeliefObject");
  }
  const rawFactors = readRecord(value, "factors");
  const factors: Record<string, ServerFactorBelief> = {};
  for (const [key, factorValue] of Object.entries(rawFactors)) {
    factors[key] = parseServerFactor(factorValue);
  }
  return {
    state: assertEnum(readString(value, "state"), BELIEF_STATES, "state"),
    confidence: assertUnitInterval(
      readNumber(value, "confidence"),
      "confidence",
    ),
    freshness: assertUnitInterval(readNumber(value, "freshness"), "freshness"),
    factors,
    evidence: readOptionalArray(value, "evidence").map(parseServerEvidenceRef),
    unknownReasons:
      value.unknownReasons === undefined
        ? []
        : readStringArray(value.unknownReasons, "unknownReasons"),
    explanation:
      value.explanation === undefined
        ? []
        : readStringArray(value.explanation, "explanation"),
    asOf: assertIsoDate(readString(value, "asOf"), "asOf"),
    rulesetVersion: readString(value, "rulesetVersion"),
    lastServerSequence:
      value.lastServerSequence === undefined
        ? undefined
        : readNumber(value, "lastServerSequence"),
  };
}

function parseServerDecisionFactor(value: unknown): ServerDecisionFactor {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedDecisionFactorObject");
  }
  return {
    name: readString(value, "name"),
    contribution: readNumber(value, "contribution"),
    evidenceIds: readStringArray(value.evidenceIds, "evidenceIds"),
  };
}

function parseServerDecision(value: unknown): ServerDecision {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedDecisionObject");
  }
  const explanation = readRecord(value, "explanation");
  const effectValue = value.effect;
  let effect: ServerDecision["effect"] = null;
  if (effectValue !== null && effectValue !== undefined) {
    if (!isRecord(effectValue)) {
      throw invalidResponse("api.error.expectedEffectObjectOrNull");
    }
    effect = {
      actionId: readString(effectValue, "actionId"),
      profile: readString(effectValue, "profile"),
      targetGain: assertUnitInterval(
        readNumber(effectValue, "targetGain"),
        "effect.targetGain",
      ),
      rampMs: readNumber(effectValue, "rampMs"),
    };
  }
  return {
    decisionId: readString(value, "decisionId"),
    kind: assertEnum(readString(value, "kind"), DECISION_KINDS, "kind"),
    reason: readString(value, "reason"),
    createdAt: assertIsoDate(readString(value, "createdAt"), "createdAt"),
    confidence: assertUnitInterval(
      readNumber(value, "confidence"),
      "confidence",
    ),
    explanation: {
      summary: readString(explanation, "summary"),
      factors: readOptionalArray(explanation, "factors").map(
        parseServerDecisionFactor,
      ),
    },
    effect,
  };
}

function parseServerOutcome(value: unknown): ServerEffectOutcome {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedOutcomeObject");
  }
  const status = readString(value, "status");
  if (
    status !== "applied" &&
    status !== "skipped" &&
    status !== "failed" &&
    status !== "reverted"
  ) {
    throw invalidResponse("api.error.unsupportedOutcomeStatus", { status });
  }
  const detailValue = value.detail;
  return {
    outcomeId: readString(value, "outcomeId"),
    effectId: readString(value, "effectId"),
    status,
    reason: readString(value, "reason"),
    detail: detailValue === null ? null : readString(value, "detail"),
    observedAt: assertIsoDate(readString(value, "observedAt"), "observedAt"),
  };
}

function parseServerEffect(value: unknown): ServerEffectLedgerEntry {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedLedgerObject");
  }
  const request = readRecord(value, "request");
  const adjustment = readRecord(request, "adjustment");
  const outcomeValue = value.latestOutcome;
  return {
    request: {
      effectId: readString(request, "effectId"),
      decisionId: readString(request, "decisionId"),
      actionId: readString(request, "actionId"),
      adjustment: {
        profile: readString(adjustment, "profile"),
        targetGain: assertUnitInterval(
          readNumber(adjustment, "targetGain"),
          "adjustment.targetGain",
        ),
        rampMs: readNumber(adjustment, "rampMs"),
      },
      issuedAt: assertIsoDate(readString(request, "issuedAt"), "issuedAt"),
    },
    latestOutcome:
      outcomeValue === null || outcomeValue === undefined
        ? null
        : parseServerOutcome(outcomeValue),
  };
}

/**
 * Reads the published dashboard composition. Each widget is `{ id, type }`
 * plus its own scalar props; unknown types are kept as-is so the registry can
 * render its documented fallback rather than the dashboard silently dropping
 * a component the user published.
 */
function parseSurfaceWidgets(value: unknown): readonly SurfaceWidget[] {
  if (!isRecord(value) || !Array.isArray(value.widgets)) {
    return [];
  }
  return value.widgets.flatMap((entry): SurfaceWidget[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const { id, type, ...props } = entry;
    if (typeof id !== "string" || typeof type !== "string") {
      return [];
    }
    return [{ id, type, props: props as Record<string, JsonValue> }];
  });
}

function parseServerSettings(value: unknown): ServerSettingsResponse {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedSettingsObject");
  }
  const releaseValue = value.currentRelease;
  if (releaseValue === null || releaseValue === undefined) {
    return { currentRelease: null };
  }
  if (!isRecord(releaseValue)) {
    throw invalidResponse("api.error.expectedCurrentRelease");
  }
  const documentValue = releaseValue.document;
  if (!isRecord(documentValue)) {
    throw invalidResponse("api.error.expectedCurrentReleaseDocument");
  }
  const audio = documentValue.audio;
  const privacy = documentValue.privacy;
  if (!isRecord(audio) || !isRecord(privacy)) {
    throw invalidResponse("api.error.expectedAudioPrivacyObjects");
  }
  const appearance = documentValue.appearance;
  const language = resolveLocale(
    isRecord(appearance) ? appearance["language"] : undefined,
  );
  return {
    currentRelease: {
      document: {
        language,
        widgets: parseSurfaceWidgets(documentValue.surface),
        audio: {
          enabled: readBoolean(audio, "enabled"),
          masterGain: assertUnitInterval(
            readNumber(audio, "masterGain"),
            "audio.masterGain",
          ),
        },
        privacy: {
          localOnly: readBoolean(privacy, "localOnly"),
          rawEventRetentionHours: readNumber(privacy, "rawEventRetentionHours"),
          sessionHistoryRetentionDays: readNumber(
            privacy,
            "sessionHistoryRetentionDays",
          ),
          excludedApplications: readStringArray(
            privacy.excludedApplications ?? [],
            "excludedApplications",
          ),
          captureScreenContent: readBoolean(privacy, "captureScreenContent"),
        },
      },
    },
  };
}

function parseContextEventRecord(value: unknown): ServerContextEventRecord {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedContextEventObject");
  }
  const record: {
    id: string;
    source: string;
    type: string;
    occurredAt: string;
    serverSequence: number;
    subject?: string;
    time?: string;
    data?: unknown;
    extensions?: Record<string, unknown>;
  } = {
    id: readString(value, "id"),
    source: readString(value, "source"),
    type: readString(value, "type"),
    occurredAt: assertIsoDate(readString(value, "occurredAt"), "occurredAt"),
    serverSequence: readNumber(value, "serverSequence"),
  };
  const subject = readOptionalString(value, "subject");
  if (subject !== undefined) {
    record.subject = subject;
  }
  const time = readOptionalString(value, "time");
  if (time !== undefined) {
    record.time = time;
  }
  if (value.data !== undefined) {
    record.data = value.data;
  }
  if (value.extensions !== undefined && isRecord(value.extensions)) {
    record.extensions = value.extensions;
  }
  return record;
}

// -- Snapshot assembly -------------------------------------------------------

function humanizeLabel(value: string): string {
  return value
    .split(/[._:\-/]/u)
    .filter((segment) => segment.length > 0)
    .map(
      (segment) =>
        segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase(),
    )
    .join(" ");
}

function mapState(snapshot: ServerBeliefSnapshot): StateHeroData {
  const descriptor = describeBeliefState(snapshot.state);
  return {
    code: descriptor.state,
    label: descriptor.label,
    summary:
      snapshot.explanation[0] ??
      `Muses is monitoring; current belief state is ${snapshot.state}.`,
    confidence: snapshot.confidence,
    observedAt: snapshot.asOf,
    unknownReason:
      snapshot.state === "UNKNOWN"
        ? (snapshot.unknownReasons[0] ?? undefined)
        : undefined,
  };
}

function mapBelief(snapshot: ServerBeliefSnapshot): BeliefDistributionData {
  const factors: BeliefFactor[] = Object.entries(snapshot.factors).map(
    ([id, factor]) => ({
      id,
      label: humanizeLabel(id),
      probability: factor.confidence,
      contribution: factor.confidence,
      direction: factor.confidence >= 0.5 ? "positive" : "neutral",
      explanation: `Evidence: ${factor.evidence.length}`,
      evidenceCount: factor.evidence.length,
    }),
  );
  return {
    stateCode: describeBeliefState(snapshot.state).state,
    confidence: snapshot.confidence,
    factors,
    calibratedAt: snapshot.asOf,
    modelVersion: snapshot.rulesetVersion,
  };
}

function mapEvidence(snapshot: ServerBeliefSnapshot): EvidenceListData {
  const items: EvidenceItem[] = snapshot.evidence
    .slice(0, EVIDENCE_ITEM_LIMIT)
    .map((entry) => {
      const direction: EvidenceDirection =
        entry.contribution > 0
          ? "supports"
          : entry.contribution < 0
            ? "opposes"
            : "neutral";
      return {
        id: entry.eventId,
        title: humanizeLabel(entry.ruleId),
        detail: `${humanizeLabel(entry.factor)} contributed ${entry.contribution.toFixed(2)}`,
        sourceType: entry.source,
        sourceLabel: humanizeLabel(entry.source),
        observedAt: entry.occurredAt,
        weight: assertUnitInterval(
          Math.min(1, Math.abs(entry.contribution)),
          "weight",
        ),
        direction,
      };
    });
  return { items, total: snapshot.evidence.length };
}

const decisionKindMap: Record<ServerDecisionKind, DecisionKind> = {
  NO_ACTION: "NO_ACTION",
  AUDIO_DIVERGE: "PLAY_AUDIO",
  AUDIO_FLOW: "PLAY_AUDIO",
  AUDIO_AUDIT: "ADJUST_AUDIO",
  AUDIO_DEBUG: "ADJUST_AUDIO",
};

const decisionDisplayLabels: Record<ServerDecisionKind, string> = {
  NO_ACTION: "No audio change",
  AUDIO_DIVERGE: "Play the Diverge soundscape",
  AUDIO_FLOW: "Play the Flow soundscape",
  AUDIO_AUDIT: "Play the Audit soundscape",
  AUDIO_DEBUG: "Play the Debug soundscape",
};

function mapDecision(decision: ServerDecision | null): DecisionCardData | null {
  if (decision === null) {
    return null;
  }
  const status: DecisionStatus =
    decision.kind === "NO_ACTION" ? "SUPPRESSED" : "PROPOSED";
  return {
    id: decision.decisionId,
    kind: decisionKindMap[decision.kind],
    status,
    title: decisionDisplayLabels[decision.kind],
    rationale: decision.explanation.summary,
    confidence: decision.confidence,
    reversible: decision.effect !== null,
    undoAvailable: decision.effect !== null,
    createdAt: decision.createdAt,
    noActionReason: decision.kind === "NO_ACTION" ? decision.reason : undefined,
    safeguards: [],
  };
}

function mapAudio(
  effect: ServerEffectLedgerEntry | null,
  decision: ServerDecision | null,
  settings: ServerSettingsResponse,
): AudioControlData | null {
  const document = settings.currentRelease?.document;
  if (document === undefined) {
    return null;
  }
  if (effect === null) {
    return {
      status: "idle",
      volume: document.audio.masterGain,
      // Manual commands are recorded against an issued effect. Until one
      // exists, an enabled transport would only produce a missing-id error.
      canPlay: false,
      canPause: false,
      canAdjustVolume: false,
    };
  }
  const outcome = effect.latestOutcome;
  let status: AudioControlData["status"];
  if (outcome === null) {
    status = "idle";
  } else if (outcome.status === "applied") {
    status = "playing";
  } else if (outcome.status === "skipped" || outcome.status === "reverted") {
    status = "paused";
  } else {
    status = "unavailable";
  }
  const profile =
    decision?.effect?.profile ?? effect.request.adjustment.profile;
  return {
    effectId: effect.request.effectId,
    status,
    title: `${humanizeLabel(profile)} profile`,
    subtitle:
      decision === null
        ? "Local audio engine"
        : decisionDisplayLabels[decision.kind],
    volume: effect.request.adjustment.targetGain,
    canPlay: document.audio.enabled,
    canPause: document.audio.enabled,
    canAdjustVolume: document.audio.enabled,
    lastChangedAt: effect.request.issuedAt,
  };
}

/**
 * The four metric ids are the ones `settings.surface.widgets[].metrics` can
 * select. v0.1 emitted a different set entirely (`belief-confidence`,
 * `decision-kind`, ...), so a published metric selection matched nothing and
 * the grid silently rendered whatever the dashboard felt like.
 */
function mapMetrics(
  belief: ServerBeliefSnapshot,
  effect: ServerEffectLedgerEntry | null,
  decision: ServerDecision | null,
): MetricsGridData {
  const reversed =
    effect?.latestOutcome?.status === "reverted" ||
    effect?.latestOutcome?.status === "skipped";
  const items: MetricItem[] = [
    {
      id: "belief.confidence",
      label: "Belief confidence",
      value: belief.confidence,
      displayValue: `${Math.round(belief.confidence * 100)}%`,
      trend: "flat",
    },
    {
      id: "belief.stability",
      label: "Evidence freshness",
      value: belief.freshness,
      displayValue: `${Math.round(belief.freshness * 100)}%`,
      trend: "flat",
    },
    {
      id: "events.rate",
      label: "Evidence in window",
      value: belief.evidence.length,
      displayValue: String(belief.evidence.length),
      trend: "flat",
    },
    {
      id: "effects.reversalRate",
      label: "Last effect reversed",
      value: reversed ? 1 : 0,
      displayValue:
        effect === null
          ? "No effect yet"
          : effect.latestOutcome === null
            ? "Pending"
            : reversed
              ? "Yes"
              : "No",
      trend: "flat",
    },
  ];

  void decision;

  return {
    items,
    windowLabel: "live",
    computedAt: belief.asOf,
  };
}

/**
 * Privacy disclosure that stays true for every settings state (B4).
 *
 * The two literal booleans below are deliberately NOT touched: they state
 * that the autonomous core pipeline (observe → believe → decide → effect)
 * makes no cloud calls and holds no API keys, which holds regardless of the
 * optional narration layer. The exhaustive, human-readable disclosure lives
 * in `capabilities`: the first entry is swapped for an honest statement of
 * the optional gateway whenever it is both configured and enabled, so the
 * panel can never claim "no remote inference is configured" next to an
 * active narration gateway.
 */
function mapPrivacy(
  settings: ServerSettingsResponse,
  llm: LlmCapabilityData | null,
): PrivacyStatusData | null {
  const document = settings.currentRelease?.document;
  if (document === undefined) {
    return null;
  }
  if (!document.privacy.localOnly) {
    throw invalidResponse("api.error.expectedPrivacyPayloadLocalOnly");
  }
  const llmActive = llm !== null && llm.configured && llm.enabled;
  const capabilities: PrivacyCapability[] = [
    llmActive
      ? {
          id: "privacy-llm-optional",
          label: "Optional AI narration gateway",
          enabled: true,
          detail:
            "User-triggered, display-only; belief, decisions, and effects never use remote inference.",
        }
      : {
          id: "privacy-cloud-off",
          label: "Cloud calls disabled",
          enabled: true,
          detail:
            "No remote inference is used for belief, decisions, or effects.",
        },
    {
      id: "privacy-local-storage",
      label: "Local-only storage",
      enabled: true,
      detail:
        "Observed events, settings history, and derived state stay on this machine.",
    },
    {
      id: "privacy-retention",
      label: "Raw event retention",
      enabled: true,
      detail:
        document.privacy.rawEventRetentionHours === 0
          ? "New event ingestion is disabled. Existing history and backups are preserved."
          : `New events expire after at most ${document.privacy.rawEventRetentionHours} hours and are removed in batches. Legacy history and backups are preserved.`,
    },
  ];
  return {
    level: "local-only",
    localOnly: true,
    cloudCallsEnabled: false,
    apiKeysPresent: false,
    retentionLabel:
      document.privacy.rawEventRetentionHours === 0
        ? "ingestion disabled"
        : `${document.privacy.rawEventRetentionHours}h (new events)`,
    databaseLabel: "SQLite WAL, local-only",
    capabilities,
    checkedAt: new Date().toISOString(),
  };
}

function assembleDashboardSnapshot(args: {
  readonly belief: ServerBeliefSnapshot;
  readonly decision: ServerDecision | null;
  readonly effect: ServerEffectLedgerEntry | null;
  readonly settings: ServerSettingsResponse;
  readonly llm: LlmCapabilityData | null;
}): DashboardSnapshot {
  const { belief, decision, effect, settings, llm } = args;
  const generatedAt = new Date().toISOString();
  return {
    snapshotId: `snap_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`,
    generatedAt,
    freshness: belief.freshness > 0.4 ? "fresh" : "stale",
    staleAfterMs: DEFAULT_STALE_AFTER_MS,
    language: settings.currentRelease?.document.language ?? DEFAULT_LANGUAGE,
    state: mapState(belief),
    belief: mapBelief(belief),
    evidence: mapEvidence(belief),
    decision: mapDecision(decision),
    audio: mapAudio(effect, decision, settings),
    metrics: mapMetrics(belief, effect, decision),
    privacy: mapPrivacy(settings, llm),
    llm,
    pendingEffect: mapPendingEffect(effect),
    widgets: settings.currentRelease?.document.widgets ?? [],
  };
}

const LLM_REASONS = ["ready", "disabled", "unconfigured", "cooldown"] as const;

/**
 * Deliberately lenient — unlike every strict parser above. The LLM layer is
 * an optional enhancement (hard boundary #1): a missing or malformed `llm`
 * bootstrap section must degrade to "feature absent" (`null`) and never
 * take the whole dashboard render down with an invalidResponse throw.
 */
export function parseServerLlm(value: unknown): LlmCapabilityData | null {
  if (!isRecord(value)) {
    return null;
  }
  const { available, enabled, configured, model } = value;
  const reason = value.reason;
  if (
    typeof available !== "boolean" ||
    typeof enabled !== "boolean" ||
    typeof configured !== "boolean" ||
    typeof model !== "string" ||
    model.length === 0 ||
    model.length > LLM_MODEL_LIMIT
  ) {
    return null;
  }
  if (
    typeof reason !== "string" ||
    !LLM_REASONS.includes(reason as (typeof LLM_REASONS)[number])
  ) {
    return null;
  }
  return {
    available,
    enabled,
    configured,
    model,
    reason: reason as LlmCapabilityData["reason"],
  };
}

/**
 * Strict on purpose: this parses the direct response to an explicit user
 * action, so a malformed body is an error the user should see (clamped by
 * the mutation layer), not a silent degradation.
 */
export function parseLlmTextResult(value: unknown): LlmTextResult {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedLlmObject");
  }
  const text = readString(value, "text");
  const model = readString(value, "model");
  if (model.length === 0 || model.length > LLM_MODEL_LIMIT) {
    throw invalidResponse("api.error.expectedModelLength");
  }
  return {
    text: text.length > LLM_TEXT_LIMIT ? text.slice(0, LLM_TEXT_LIMIT) : text,
    model,
    generatedAt: assertIsoDate(readString(value, "generatedAt"), "generatedAt"),
  };
}

/**
 * An issued effect with no outcome yet is work the browser still owes the
 * server. Once an outcome is recorded the effect is settled and no longer
 * pending, so re-running it on the next poll cannot double-apply.
 */
function mapPendingEffect(
  effect: ServerEffectLedgerEntry | null,
): PendingEffect | null {
  if (effect === null || effect.latestOutcome !== null) {
    return null;
  }
  return {
    effectId: effect.request.effectId,
    decisionId: effect.request.decisionId,
    profile: effect.request.adjustment.profile,
    targetGain: effect.request.adjustment.targetGain,
    rampMs: effect.request.adjustment.rampMs,
    issuedAt: effect.request.issuedAt,
  };
}

function mapContextEventToObservatoryEvent(
  event: ServerContextEventRecord,
): ObservatoryEvent {
  const metadata: Record<string, JsonValue> = {
    serverSequence: event.serverSequence,
  };
  if (event.extensions !== undefined) {
    for (const [key, value] of Object.entries(event.extensions)) {
      metadata[key] = (value ?? null) as JsonValue;
    }
  }
  const rawDetail =
    event.data === undefined
      ? ""
      : typeof event.data === "string"
        ? event.data
        : JSON.stringify(event.data);
  const detail =
    rawDetail.length > EVENT_DETAIL_LIMIT
      ? `${rawDetail.slice(0, EVENT_DETAIL_LIMIT - 3)}...`
      : rawDetail;
  return {
    id: event.id,
    type: event.type,
    title: humanizeLabel(event.type),
    detail,
    occurredAt: event.occurredAt,
    source: event.source,
    correlationId: event.subject,
    metadata,
  };
}

export function parseDashboardSnapshot(value: unknown): DashboardSnapshot {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedSnapshotObject");
  }
  const requiredKeys = [
    "snapshotId",
    "generatedAt",
    "freshness",
    "staleAfterMs",
    "state",
    "belief",
    "evidence",
    "decision",
    "audio",
    "metrics",
    "privacy",
  ];
  for (const key of requiredKeys) {
    if (!(key in value)) {
      throw invalidResponse("api.error.expectedSnapshotKey", { key });
    }
  }
  if (value.privacy !== null && value.privacy !== undefined) {
    parsePrivacyStatus(value.privacy);
  }
  return value as unknown as DashboardSnapshot;
}

export function parseEventPage(value: unknown): EventPage {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedEventPageObject");
  }
  const nextCursor = value.nextCursor;
  if (
    nextCursor !== undefined &&
    nextCursor !== null &&
    typeof nextCursor !== "string"
  ) {
    throw invalidResponse("api.error.expectedNextCursor");
  }
  const hasMoreValue = value.hasMore;
  if (hasMoreValue !== undefined && typeof hasMoreValue !== "boolean") {
    throw invalidResponse("api.error.expectedHasMoreBoolean");
  }
  const hasMore =
    hasMoreValue === undefined ? typeof nextCursor === "string" : hasMoreValue;
  if (hasMore && (nextCursor === null || nextCursor === undefined)) {
    throw invalidResponse("api.error.expectedCursorWhenHasMore");
  }
  const items = readOptionalArray(value, "items").map((item) => {
    if (!isRecord(item)) {
      throw invalidResponse("api.error.expectedEventObject");
    }
    if ("serverSequence" in item) {
      return mapContextEventToObservatoryEvent(parseContextEventRecord(item));
    }
    const metadata = item.metadata;
    if (!isRecord(metadata) || !isJsonValue(metadata)) {
      throw invalidResponse("api.error.expectedMetadataJson");
    }
    return item as unknown as ObservatoryEvent;
  });
  return {
    items,
    nextCursor: typeof nextCursor === "string" ? nextCursor : null,
    hasMore,
  };
}

export function parseEffectCommandResult(value: unknown): EffectCommandResult {
  if (!isRecord(value)) {
    throw invalidResponse("api.error.expectedEffectResultObject");
  }
  if (value.error === "UNKNOWN_EFFECT") {
    return {
      accepted: false,
      reason: tEn("api.error.unknownEffect"),
      snapshotId: "",
      reasonKey: "api.error.unknownEffect",
    };
  }
  const effectRecord = readRecord(value, "effect");
  const request = readRecord(effectRecord, "request");
  return {
    accepted: true,
    snapshotId: readString(request, "effectId"),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error: unknown) {
    throw new DashboardApiError(
      error instanceof Error
        ? {
            kind: "invalid-response",
            message: tEn("api.error.invalidJsonDetail", {
              detail: error.message,
            }),
            statusCode: response.status,
            retryable: false,
            messageKey: "api.error.invalidJsonDetail",
            messageParams: { detail: error.message },
          }
        : {
            kind: "invalid-response",
            message: tEn("api.error.invalidJson"),
            statusCode: response.status,
            retryable: false,
            messageKey: "api.error.invalidJson",
          },
    );
  }
}

function extractErrorMessage(bodyText: string): string | undefined {
  if (bodyText.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const code = readString(parsed.error, "code");
      const message = readString(parsed.error, "message");
      return `${code}: ${message}`;
    }
  } catch {
    // The server did not return JSON; fall through to the raw text.
  }
  return bodyText.length <= ERROR_SNIPPET_LIMIT
    ? bodyText
    : `${bodyText.slice(0, ERROR_SNIPPET_LIMIT - 3)}...`;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 413 || status === 429;
}

async function requestJson(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(input, init);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DashboardApiError({
        kind: "aborted",
        message: tEn("api.error.requestAborted"),
        retryable: true,
        messageKey: "api.error.requestAborted",
      });
    }
    throw new DashboardApiError(
      error instanceof Error
        ? {
            kind: "network",
            message: error.message,
            retryable: true,
          }
        : {
            kind: "network",
            message: tEn("api.error.unreachable"),
            retryable: true,
            messageKey: "api.error.unreachable",
          },
    );
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const upstreamMessage = extractErrorMessage(bodyText);
    throw new DashboardApiError(
      upstreamMessage !== undefined
        ? {
            kind: "http",
            message: upstreamMessage,
            statusCode: response.status,
            retryable: isRetryableStatus(response.status),
          }
        : {
            kind: "http",
            message: tEn("api.error.httpStatus", { status: response.status }),
            statusCode: response.status,
            retryable: isRetryableStatus(response.status),
            messageKey: "api.error.httpStatus",
            messageParams: { status: response.status },
          },
    );
  }
  return readJson(response);
}

export function createDashboardApiClient(
  options: DashboardApiOptions = {},
): DashboardApi {
  const baseUrl = options.baseUrl ?? "";
  const fetchImpl = options.fetchImpl ?? createAuthorizedFetch();

  const bootstrapUrl = joinUrl(baseUrl, BOOTSTRAP_PATH);
  const eventsUrl = joinUrl(baseUrl, EVENTS_PATH);
  const outcomesUrl = joinUrl(baseUrl, EFFECT_OUTCOMES_PATH);
  const llmNarrationUrl = joinUrl(baseUrl, LLM_NARRATION_PATH);
  const llmSummaryUrl = joinUrl(baseUrl, LLM_SUMMARY_PATH);

  function makeGetInit(signal: AbortSignal): RequestInit {
    return {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal,
    };
  }

  function makePostInit(signal: AbortSignal, body: unknown): RequestInit {
    return {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      cache: "no-store",
      credentials: "same-origin",
      body: JSON.stringify(body),
      signal,
    };
  }

  return {
    async getSnapshot(signal: AbortSignal): Promise<DashboardSnapshot> {
      const payload = await requestJson(
        fetchImpl,
        bootstrapUrl,
        makeGetInit(signal),
      );
      if (!isRecord(payload)) {
        throw invalidResponse("api.error.expectedBootstrapObject");
      }
      const decisionValue = payload.decision;
      const effectValue = payload.effect;
      // Lenient by design: a broken optional-enhancement section yields null
      // and hides the feature instead of failing the whole snapshot.
      const llm = parseServerLlm(payload.llm);
      return assembleDashboardSnapshot({
        belief: parseServerBelief(payload.belief),
        decision:
          decisionValue === null || decisionValue === undefined
            ? null
            : parseServerDecision(decisionValue),
        effect:
          effectValue === null || effectValue === undefined
            ? null
            : parseServerEffect(effectValue),
        settings: parseServerSettings(payload.settings),
        llm,
      });
    },
    async getEvents(
      cursor: string | null,
      limit: number,
      signal: AbortSignal,
    ): Promise<EventPage> {
      const url = new URL(
        eventsUrl,
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.origin,
      );
      url.searchParams.set("limit", String(limit));
      if (cursor !== null) {
        url.searchParams.set("cursor", cursor);
      }
      const requestUrl =
        baseUrl.length === 0 && typeof window !== "undefined"
          ? `${url.pathname}${url.search}`
          : url.toString();
      const payload = await requestJson(
        fetchImpl,
        requestUrl,
        makeGetInit(signal),
      );
      return parseEventPage(payload);
    },
    async postEffectOutcome(
      outcome: EffectOutcomeInput,
      signal: AbortSignal,
    ): Promise<EffectCommandResult> {
      if (outcome.effectId.length === 0) {
        throw new DashboardApiError({
          kind: "invalid-response",
          message: tEn("api.error.effectIdRequired"),
          retryable: false,
          messageKey: "api.error.effectIdRequired",
        });
      }
      const payload = await requestJson(
        fetchImpl,
        outcomesUrl,
        makePostInit(signal, outcome),
      );
      return parseEffectCommandResult(payload);
    },
    async postLlmNarration(signal: AbortSignal): Promise<LlmTextResult> {
      // The body must be a literal `{}`: the server 400s an empty
      // application/json body so caches/proxies can never trigger a
      // generation (N3).
      const payload = await requestJson(
        fetchImpl,
        llmNarrationUrl,
        makePostInit(signal, {}),
      );
      return parseLlmTextResult(payload);
    },
    async postLlmSummary(
      windowMinutes: number,
      signal: AbortSignal,
    ): Promise<LlmTextResult> {
      const payload = await requestJson(
        fetchImpl,
        llmSummaryUrl,
        makePostInit(signal, { windowMinutes }),
      );
      return parseLlmTextResult(payload);
    },
  };
}

export function normalizeDashboardError(error: unknown): DashboardApiError {
  if (error instanceof DashboardApiError) {
    return error;
  }
  return new DashboardApiError(
    error instanceof Error
      ? {
          kind: "unknown",
          message: error.message,
          retryable: false,
        }
      : {
          kind: "unknown",
          message: tEn("api.error.unknownDashboardError"),
          retryable: false,
          messageKey: "api.error.unknownDashboardError",
        },
  );
}
