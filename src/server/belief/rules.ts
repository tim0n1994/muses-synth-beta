export const BELIEF_RULESET_VERSION = "muses-belief-rules/0.1.0";

export const BELIEF_RULES = {
  evidenceWindowMs: 30 * 60 * 1_000,
  activeWindowMs: 5 * 60 * 1_000,
  waitWindowMs: 15 * 60 * 1_000,
  editingWindowMs: 5 * 60 * 1_000,
  editingMinimumEvents: 3,
  editingMinimumSpanMs: 90 * 1_000,
  testWindowMs: 10 * 60 * 1_000,
  conflictWindowMs: 2 * 60 * 1_000,
  reviewWindowMs: 8 * 60 * 1_000,
  hysteresisMargin: 0.12,
  lowSeparationMargin: 0.08,
  minimumKnownProbability: 0.32,
} as const;

export const RULE_IDS = {
  setup: "setup-recent",
  explore: "editor-exploration",
  editPulse: "editor-edit-pulse",
  sustainedEditing: "sustained-editing",
  failingTest: "latest-test-failed",
  repeatedFailure: "repeated-test-failure",
  successfulTest: "latest-test-passed",
  sustainedSuccess: "sustained-editing-and-success",
  recoveredFailure: "success-after-failure",
  review: "review-activity",
  explicitIdle: "explicit-idle",
  explicitInactive: "explicit-inactive",
  processWaiting: "process-waiting",
  inactivityWait: "inactivity-wait",
  inactivityBreak: "inactivity-break",
  stale: "stale-evidence",
  testConflict: "conflicting-test-results",
  hysteresis: "state-hysteresis",
} as const;
