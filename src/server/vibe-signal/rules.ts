/**
 * Vibe Signal 1.0 「脉搏」rule table (v07-design.md V1/V2).
 *
 * Mirrors the centralized BELIEF_RULES / RULE_IDS style of
 * src/server/belief/rules.ts. All thresholds are initial constants; the
 * 6/20 rhythm split must be recalibrated against real collector data in
 * Round 1 acceptance (the v0.6 event stream is edit batches, not key
 * strokes, so the PRD's "~3 saves/min + 78 wpm" example maps differently).
 */
export const PULSE_RULESET_VERSION = "muses-pulse-rules/0.1.0";

export const PULSE_RULES = {
  /** Trailing pulse window: (asOf - 60s, asOf]. */
  windowMs: 60_000,
  /** Trailing-edge debounce merging ingest bursts into one refresh. */
  ingestDebounceMs: 5_000,
  weights: {
    editSave: 1.0,
    navigateOpen: 0.4,
    processActivity: 0.5,
    testRun: 0.5,
    review: 0.5,
  },
  valences: {
    testPassed: 0.6,
    testFailed: -0.8,
    testCancelled: 0,
    processCompleted: 0.3,
    processFailed: -0.4,
    review: 0.2,
  },
  /** Weighted event rate E per 60s window: SLOW / STEADY / FAST. */
  rhythm: {
    slowMax: 6,
    steadyMax: 20,
  },
  /** Intensity score i = 0.55 * clamp(CV / 1.5) + 0.45 * coverage. */
  intensity: {
    cvWeight: 0.55,
    cvScale: 1.5,
    covWeight: 0.45,
    calmMax: 0.35,
    steadyMax: 0.65,
  },
  /** A level change must clear the boundary by ±20% (deadband). */
  hysteresisMargin: 0.2,
  emotion: {
    toneThreshold: 0.15,
  },
  /** The only consumer of emotion: how the next track transition behaves. */
  modulation: {
    negative: { crossfadeMs: 8_000, energyBias: -1, hardCut: false },
    positive: { crossfadeMs: 2_500, energyBias: 0, hardCut: false },
    default: { crossfadeMs: 3_000, energyBias: 0, hardCut: false },
  },
  /** Evidence cap per quantity (mirrors factorBelief's slice(-12)). */
  maxEvidencePerQuantity: 12,
} as const;

export const PULSE_RULE_IDS = {
  rhythmRateLow: "rhythm-rate-low",
  rhythmRateMid: "rhythm-rate-mid",
  rhythmRateHigh: "rhythm-rate-high",
  intensityCalm: "intensity-calm",
  intensitySteady: "intensity-steady",
  intensityIntense: "intensity-intense",
  valenceTestPassed: "valence-test-pass",
  valenceTestFailed: "valence-test-failed",
  valenceProcessFailed: "valence-process-failed",
  valenceProcessCompleted: "valence-process-completed",
  valenceReview: "valence-review",
  emotionModulation: "emotion-modulation",
  pulseNoEvidence: "pulse-no-evidence",
} as const;

export type PulseRuleId = (typeof PULSE_RULE_IDS)[keyof typeof PULSE_RULE_IDS];

/** Closed set of rule ids the evidence chain may reference (B1 invariant). */
export const PULSE_RULE_ID_SET: ReadonlySet<string> = new Set(
  Object.values(PULSE_RULE_IDS),
);
