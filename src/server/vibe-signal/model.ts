import type { ContextEventRecord } from "../context/model.js";

export const RHYTHM_LEVELS = ["SLOW", "STEADY", "FAST", "UNKNOWN"] as const;

export type RhythmLevel = (typeof RHYTHM_LEVELS)[number];

export const INTENSITY_LEVELS = [
  "CALM",
  "STEADY",
  "INTENSE",
  "UNKNOWN",
] as const;

export type IntensityLevel = (typeof INTENSITY_LEVELS)[number];

export type EmotionTone = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "UNKNOWN";

/** Continuous valence in [-1, 1], or UNKNOWN when the window is empty. */
export type EmotionValue = number | "UNKNOWN";

/** The pulse's own factor space; the v0.6 EvidenceRef union stays frozen. */
export type PulseFactorName = "rhythm" | "intensity" | "emotion";

export interface PulseEvidenceRef {
  readonly ruleId: string;
  readonly source: string;
  readonly eventId: string;
  readonly serverSequence: number;
  readonly occurredAt: string;
  readonly contribution: number;
  readonly factor: PulseFactorName;
}

/**
 * How the player should perform the next transition. This is the ONLY way
 * emotion is consumed (V2: emotion modulates transitions, it never picks a
 * bucket). energyBias -1 leans toward the lower-energy neighbour bucket.
 */
export interface TransitionModulation {
  readonly crossfadeMs: number;
  readonly energyBias: number;
  readonly hardCut: boolean;
}

export interface RhythmBelief {
  readonly value: RhythmLevel;
  /** Weighted event rate E per 60s window (0 when UNKNOWN). */
  readonly score: number;
  readonly evidence: readonly PulseEvidenceRef[];
}

export interface IntensityBelief {
  readonly value: IntensityLevel;
  /** Continuous intensity score in [0, 1] (0 when UNKNOWN). */
  readonly score: number;
  readonly evidence: readonly PulseEvidenceRef[];
}

export interface EmotionBelief {
  readonly value: EmotionValue;
  readonly tone: EmotionTone;
  readonly transitionModulation: TransitionModulation;
  readonly evidence: readonly PulseEvidenceRef[];
}

export type PulseUnknownReason = "NO_RELEVANT_EVIDENCE";

/**
 * Field-for-field analogue of BeliefSnapshot (src/server/belief/model.ts)
 * for the pulse family: window bounds replace the single asOf, the three
 * quantities replace factors/state, everything else (evidence ledger,
 * unknownReasons, explanation, rulesetVersion, inputDigest,
 * lastServerSequence) keeps the same shape and the same honesty contract.
 */
export interface PulseSnapshot {
  readonly asOf: string;
  readonly windowStartedAt: string;
  readonly windowEndedAt: string;
  readonly rhythm: RhythmBelief;
  readonly intensity: IntensityBelief;
  readonly emotion: EmotionBelief;
  readonly evidence: readonly PulseEvidenceRef[];
  readonly unknownReasons: readonly PulseUnknownReason[];
  readonly explanation: readonly string[];
  readonly rulesetVersion: string;
  readonly inputDigest: string;
  readonly lastServerSequence?: number;
}

export interface PulseProjectionRequest {
  readonly asOf?: string;
  readonly maxEvents?: number;
  readonly persist?: boolean;
}

/**
 * Recent-window read port. Unlike BeliefEventReader (which pages the whole
 * history ascending), implementations return only the trailing pulse
 * window, newest-first internally, reversed to a deterministic ascending
 * order — dense histories must not force the pulse to read their oldest
 * rows first.
 */
export interface PulseEventReader {
  readRecentForPulse(
    query: Readonly<{ asOf: string; limit: number }>,
  ): Promise<readonly ContextEventRecord[]>;
}

export interface PulseSnapshotStore {
  savePulseSnapshot(snapshot: PulseSnapshot): Promise<void>;
}
