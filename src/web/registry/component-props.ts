import type { BeliefStateName } from "../../server/belief/vocabulary";

export interface StateHeroProps {
  readonly title?: string;
  /**
   * The belief engine's own state name. See `src/server/belief/vocabulary.ts`
   * — the registry no longer re-codes it into a shorter display vocabulary.
   */
  readonly status: BeliefStateName;
  readonly statusLabel?: string;
  readonly confidence: number;
  readonly summary: string;
  readonly updatedAt?: string;
  readonly unknownReason?: string;
}

export interface BeliefFactor {
  readonly id: string;
  readonly label: string;
  readonly probability: number;
  readonly direction: -1 | 0 | 1;
  readonly evidenceCount: number;
}

export interface BeliefDistributionProps {
  readonly title?: string;
  readonly factors: readonly BeliefFactor[];
}

export interface EvidenceItem {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly weight: number;
  readonly observedAt?: string;
  readonly explanation?: string;
}

export interface EvidenceListProps {
  readonly title?: string;
  readonly evidence: readonly EvidenceItem[];
}

export interface TimelineEvent {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly summary?: string;
}

export interface EventsTimelineProps {
  readonly title?: string;
  readonly events: readonly TimelineEvent[];
}

export interface DecisionCardProps {
  readonly title?: string;
  readonly decision:
    "NO_ACTION" | "SUGGEST_AUDIO" | "PAUSE_AUDIO" | "ADJUST_VOLUME" | "UNKNOWN";
  readonly confidence: number;
  readonly rationale: string;
  readonly reversible: boolean;
  readonly expiresAt?: string;
}

export interface AudioControlProps {
  readonly title?: string;
  readonly playing: boolean;
  readonly trackTitle?: string;
  readonly volume: number;
  readonly muted: boolean;
  readonly disabledReason?: string;
}

export interface MetricItem {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly trend: "up" | "down" | "flat" | "unknown";
  readonly helpText?: string;
}

export interface MetricsGridProps {
  readonly title?: string;
  readonly metrics: readonly MetricItem[];
}

export interface PrivacyStatusProps {
  readonly title?: string;
  readonly localOnly: boolean;
  readonly sensors: readonly string[];
  readonly retention: string;
  readonly lastExportAt?: string;
  readonly pendingDeletionCount: number;
}

export interface LlmNarrationProps {
  readonly available: boolean;
  readonly model: string;
  readonly reason: string;
}
