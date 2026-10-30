import type { ReactNode } from "react";

import type { BeliefStateName } from "../../server/belief/vocabulary";
import type { LanguageCode, MessageKey } from "../i18n";
import type { RegistryLlmGeneration } from "../registry/types";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * The belief engine's own vocabulary, not a display-layer re-coding of it.
 * v0.1 mapped eight engine states onto six dashboard codes and then onto four
 * registry statuses, so `SETUP`, `WAIT` and `BREAK` all reached the user as
 * "Known". See `src/server/belief/vocabulary.ts`.
 */
export type BeliefStateCode = BeliefStateName;
export type DecisionKind =
  "NO_ACTION" | "PLAY_AUDIO" | "PAUSE_AUDIO" | "ADJUST_AUDIO" | "OTHER";
export type DecisionStatus =
  "PROPOSED" | "ACTIVE" | "COMPLETED" | "REVERTED" | "SUPPRESSED";
export type EvidenceDirection = "supports" | "opposes" | "neutral";
export type FactorDirection = "positive" | "negative" | "neutral";
export type PrivacyLevel = "local-only" | "restricted" | "warning";
export type ServerFreshness = "fresh" | "stale";

export interface StateHeroData {
  readonly code: BeliefStateCode;
  readonly label: string;
  readonly summary: string;
  readonly confidence: number;
  readonly observedAt: string;
  readonly unknownReason?: string | undefined;
}

export interface BeliefFactor {
  readonly id: string;
  readonly label: string;
  readonly probability: number;
  readonly contribution: number;
  readonly direction: FactorDirection;
  readonly explanation: string;
  readonly evidenceCount: number;
}

export interface BeliefDistributionData {
  readonly stateCode: BeliefStateCode;
  readonly confidence: number;
  readonly factors: readonly BeliefFactor[];
  readonly calibratedAt: string;
  readonly modelVersion: string;
}

export interface EvidenceItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly sourceType: string;
  readonly sourceLabel: string;
  readonly sourceUrl?: string | undefined;
  readonly observedAt: string;
  readonly weight: number;
  readonly direction: EvidenceDirection;
}

export interface EvidenceListData {
  readonly items: readonly EvidenceItem[];
  readonly total: number;
}

export interface ObservatoryEvent {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly occurredAt: string;
  readonly source: string;
  readonly correlationId?: string | undefined;
  readonly metadata: Readonly<Record<string, JsonValue>>;
}

export interface EventsTimelineData {
  readonly items: readonly ObservatoryEvent[];
  readonly totalLoaded: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export interface DecisionSafeguard {
  readonly id: string;
  readonly label: string;
  readonly satisfied: boolean;
  readonly detail: string;
}

export interface DecisionCardData {
  readonly id: string;
  readonly kind: DecisionKind;
  readonly status: DecisionStatus;
  readonly title: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly reversible: boolean;
  readonly undoAvailable: boolean;
  readonly undoUntil?: string | undefined;
  readonly createdAt: string;
  readonly noActionReason?: string | undefined;
  readonly safeguards: readonly DecisionSafeguard[];
}

export interface AudioControlData {
  readonly effectId?: string | undefined;
  readonly status: "idle" | "playing" | "paused" | "unavailable";
  readonly title?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly volume: number;
  readonly canPlay: boolean;
  readonly canPause: boolean;
  readonly canAdjustVolume: boolean;
  readonly lastChangedAt?: string | undefined;
}

export interface MetricItem {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly displayValue: string;
  readonly unit?: string | undefined;
  readonly trend?: "up" | "down" | "flat" | undefined;
  readonly trendLabel?: string | undefined;
}

export interface MetricsGridData {
  readonly items: readonly MetricItem[];
  readonly windowLabel: string;
  readonly computedAt: string;
}

export interface PrivacyCapability {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly detail: string;
}

export interface PrivacyStatusData {
  readonly level: PrivacyLevel;
  readonly localOnly: boolean;
  /**
   * Narrow, structurally-true semantics: the autonomous core pipeline
   * (observe → believe → decide → effect) makes no cloud calls and holds no
   * API keys — true for every settings state. The optional, user-triggered
   * narration gateway is disclosed via `capabilities` instead (B4).
   */
  readonly cloudCallsEnabled: false;
  readonly apiKeysPresent: false;
  readonly retentionLabel: string;
  readonly databaseLabel: string;
  readonly capabilities: readonly PrivacyCapability[];
  readonly checkedAt: string;
}

/**
 * A server-issued audio effect that has no recorded outcome yet. The browser
 * owns execution — the server can only propose — so the dashboard carries the
 * raw adjustment here and hands it to the audio runtime.
 */
export interface PendingEffect {
  readonly effectId: string;
  readonly decisionId: string;
  readonly profile: string;
  readonly targetGain: number;
  readonly rampMs: number;
  readonly issuedAt: string;
}

/**
 * One server-published component instance from `settings.surface.widgets`.
 * Props stay opaque here: the registry owns each type's schema, and the
 * dashboard only routes them. Configuration can never carry markup or code —
 * these are plain JSON scalars validated by the server before publish.
 */
export interface SurfaceWidget {
  readonly id: string;
  readonly type: string;
  readonly props: Readonly<Record<string, JsonValue>>;
}

/**
 * The server-derived capability of the optional LLM narration layer. `null`
 * means the bootstrap payload carried no usable `llm` section — the optional
 * enhancement then stays entirely hidden, never errors.
 */
export interface LlmCapabilityData {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly model: string;
  readonly reason: "ready" | "disabled" | "unconfigured" | "cooldown";
}

/** Single vocabulary with the registry layer: the registry type owns it. */
export type LlmGenerationState = RegistryLlmGeneration;

/** Body of a successful narration/summary POST (`/api/v1/llm/*`). */
export interface LlmTextResult {
  readonly text: string;
  readonly model: string;
  readonly generatedAt: string;
}

export interface DashboardSnapshot {
  readonly snapshotId: string;
  readonly generatedAt: string;
  readonly freshness: ServerFreshness;
  readonly staleAfterMs: number;
  /** Interface language from the published settings release. */
  readonly language: LanguageCode;
  readonly state: StateHeroData | null;
  readonly belief: BeliefDistributionData | null;
  readonly evidence: EvidenceListData;
  readonly decision: DecisionCardData | null;
  readonly audio: AudioControlData | null;
  readonly metrics: MetricsGridData | null;
  readonly privacy: PrivacyStatusData | null;
  readonly llm: LlmCapabilityData | null;
  readonly pendingEffect: PendingEffect | null;
  /** The published dashboard composition, in render order. */
  readonly widgets: readonly SurfaceWidget[];
}

export interface EventPage {
  readonly items: readonly ObservatoryEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface EffectCommand {
  readonly command: "play" | "pause" | "set-volume" | "undo-decision";
  readonly effectId?: string | undefined;
  readonly decisionId?: string;
  readonly profile?: string | undefined;
  readonly volume?: number;
  readonly expectedSnapshotId: string;
}

export interface EffectOutcomeInput {
  readonly outcomeId: string;
  readonly effectId: string;
  readonly status: "applied" | "skipped" | "failed" | "reverted";
  readonly reason: string;
  readonly detail: string | null;
  readonly observedAt: string;
}

export interface EffectCommandResult {
  readonly accepted: boolean;
  readonly reason?: string | undefined;
  readonly snapshotId: string;
  /** Catalog key for localized display of a client-generated `reason`. */
  readonly reasonKey?: MessageKey | undefined;
}

export interface DashboardApi {
  readonly getSnapshot: (signal: AbortSignal) => Promise<DashboardSnapshot>;
  readonly getEvents: (
    cursor: string | null,
    limit: number,
    signal: AbortSignal,
  ) => Promise<EventPage>;
  /**
   * Records the outcome the browser actually produced. The dashboard never
   * synthesises an outcome any more — it runs the command through the audio
   * runtime first and reports what happened.
   */
  readonly postEffectOutcome: (
    outcome: EffectOutcomeInput,
    signal: AbortSignal,
  ) => Promise<EffectCommandResult>;
  /**
   * Explicitly triggered, quota-costing generations. Both are POSTs on
   * purpose: no dashboard refresh may ever fan out into a gateway call.
   * The narration body is `{}` — the server 400s an absent JSON body.
   */
  readonly postLlmNarration: (signal: AbortSignal) => Promise<LlmTextResult>;
  readonly postLlmSummary: (
    windowMinutes: number,
    signal: AbortSignal,
  ) => Promise<LlmTextResult>;
}

export type DashboardRegistryBlock =
  | { readonly type: "state.hero"; readonly data: StateHeroData }
  | {
      readonly type: "belief.distribution";
      readonly data: BeliefDistributionData;
    }
  | { readonly type: "evidence.list"; readonly data: EvidenceListData }
  | { readonly type: "events.timeline"; readonly data: EventsTimelineData }
  | { readonly type: "decision.card"; readonly data: DecisionCardData }
  | { readonly type: "audio.control"; readonly data: AudioControlData }
  | { readonly type: "metrics.grid"; readonly data: MetricsGridData }
  | { readonly type: "privacy.status"; readonly data: PrivacyStatusData }
  | { readonly type: "llm.narration"; readonly data: LlmCapabilityData };

export interface DashboardRegistryActions {
  readonly refresh: () => void;
  readonly loadMoreEvents: () => void;
  readonly setAudioPlaying: (playing: boolean) => void;
  readonly setAudioVolume: (volume: number) => void;
  readonly undoDecision: () => void;
  readonly requestLlmNarration: () => void;
  readonly requestLlmSummary: (windowMinutes: number) => void;
}

export interface DashboardRegistryContext {
  readonly actions: DashboardRegistryActions;
  readonly busyAction: EffectCommand["command"] | null;
  readonly eventLoadState: "idle" | "loading" | "error";
  readonly llm: {
    readonly narration: LlmGenerationState;
    readonly summary: LlmGenerationState;
  };
}

export interface DashboardRegistry {
  readonly render: (
    block: DashboardRegistryBlock,
    context: DashboardRegistryContext,
  ) => ReactNode;
}

export type DashboardViewStatus =
  "loading" | "empty" | "ready" | "stale" | "disconnected" | "server-error";

export interface DashboardError {
  readonly kind:
    "network" | "http" | "invalid-response" | "aborted" | "unknown";
  /** English canonical text — always populated so logs and tests stay stable. */
  readonly message: string;
  readonly statusCode?: number | undefined;
  readonly retryable: boolean;
  /**
   * Catalog key plus interpolation params for localized display. Present for
   * every message the client generates itself; absent when the message is
   * verbatim upstream text (server-provided strings, network exceptions).
   */
  readonly messageKey?: MessageKey | undefined;
  readonly messageParams?:
    Readonly<Record<string, string | number>> | undefined;
}
