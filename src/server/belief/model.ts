import type { ContextEventRecord } from "../context/model.js";

export const BELIEF_STATES = [
  "SETUP",
  "EXPLORE",
  "BUILD",
  "DEBUG",
  "REVIEW",
  "WAIT",
  "BREAK",
  "UNKNOWN",
] as const;

export type BeliefState = (typeof BELIEF_STATES)[number];
export type BeliefDistribution = Readonly<Record<BeliefState, number>>;

export type ActivityFactor = "ACTIVE" | "IDLE" | "INACTIVE" | "UNKNOWN";
export type WorkModeFactor =
  | "SETTING_UP"
  | "EXPLORING"
  | "EDITING"
  | "TESTING"
  | "REVIEWING"
  | "WAITING"
  | "RESTING"
  | "UNKNOWN";
export type OutcomeFactor = "SUCCESS" | "FAILURE" | "MIXED" | "UNKNOWN";
export type AttentionFactor = "DEEP" | "SHALLOW" | "DISENGAGED" | "UNKNOWN";

export type FactorName = "activity" | "workMode" | "outcome" | "attention";

export interface EvidenceRef {
  readonly ruleId: string;
  readonly source: string;
  readonly eventId: string;
  readonly serverSequence: number;
  readonly occurredAt: string;
  readonly contribution: number;
  readonly factor: FactorName | "state";
}

export interface FactorBelief<TValue extends string> {
  readonly value: TValue;
  readonly confidence: number;
  readonly freshness: number;
  readonly evidence: readonly EvidenceRef[];
}

export interface BeliefFactors {
  readonly activity: FactorBelief<ActivityFactor>;
  readonly workMode: FactorBelief<WorkModeFactor>;
  readonly outcome: FactorBelief<OutcomeFactor>;
  readonly attention: FactorBelief<AttentionFactor>;
}

export type UnknownReason =
  | "NO_RELEVANT_EVIDENCE"
  | "STALE_EVIDENCE"
  | "CONFLICTING_TEST_RESULTS"
  | "LOW_SEPARATION"
  | "UNRECOGNIZED_ONLY";

export interface BeliefSnapshot {
  readonly state: BeliefState;
  readonly confidence: number;
  readonly freshness: number;
  readonly distribution: BeliefDistribution;
  readonly factors: BeliefFactors;
  readonly evidence: readonly EvidenceRef[];
  readonly unknownReasons: readonly UnknownReason[];
  readonly explanation: readonly string[];
  readonly asOf: string;
  readonly rulesetVersion: string;
  readonly inputDigest: string;
  readonly lastServerSequence?: number;
}

export interface BeliefProjectionRequest {
  readonly asOf?: string;
  readonly maxEvents?: number;
  readonly persist?: boolean;
  /**
   * Internal lever for the composition root's hot path (PerUserRuntimes):
   * the projection may be served from the per-shard hydrated replay window
   * (R2 memory work, 2026-10-21) instead of re-reading the full window from
   * the store. The HTTP surface never binds this field — POST /belief/replay
   * keeps its uncached, always-fresh contract — and the reader treats the
   * cached path purely as an optimization: any doubt falls back to a full
   * read, so the answer can never differ.
   */
  readonly windowCache?: boolean;
}

/**
 * What a reader hands the projection: the events to replay plus the size of
 * the stream they were taken from, so the service can tell a stream that fits
 * the bound from one that had to be windowed.
 */
export interface BeliefEventWindow {
  /**
   * The whole stream when it fits `limit`, otherwise the `limit` most recent
   * events by serverSequence. Ordering is not trusted; the projector reorders
   * deterministically by occurredAt then serverSequence.
   */
  readonly events: readonly ContextEventRecord[];
  /** Unexpired events with occurredAt <= asOf in the stream, before windowing. */
  readonly total: number;
}

/**
 * Emitted once per projection whose stream exceeded the replay bound and was
 * therefore replayed from its most recent window instead of failing.
 */
export interface BeliefReplayTruncation {
  readonly asOf: string;
  /** Events the stream held as of asOf. */
  readonly total: number;
  /** Events actually replayed — the most recent by serverSequence. */
  readonly window: number;
  /** The bound that forced the window. */
  readonly maxEvents: number;
}

export interface BeliefEventReader {
  /**
   * Returns unique stored events with occurredAt <= asOf — the most recent
   * `limit` of them when the stream is larger — together with the stream
   * total. Ordering is not trusted; the projector reorders deterministically
   * by occurredAt then serverSequence.
   *
   * `useWindowCache` (R2 memory work) lets the caller opt in to being served
   * from the per-shard hydrated replay window when the reader was built with
   * one; readers without a cache ignore it and always read the full window.
   */
  readForBelief(
    query: Readonly<{ asOf: string; limit: number; useWindowCache?: boolean }>,
  ): Promise<BeliefEventWindow>;
}

export interface BeliefSnapshotStore {
  saveBeliefSnapshot(snapshot: BeliefSnapshot): Promise<void>;
}
