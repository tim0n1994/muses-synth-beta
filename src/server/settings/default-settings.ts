import {
  DEFAULT_APPEARANCE,
  DEFAULT_LLM_SECTION,
  DEFAULT_QUIET_HOURS,
  parseSettings,
  SETTINGS_SCHEMA_VERSION,
  type SettingsDocument,
} from "./schema.js";

const candidateDefaultSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  profile: {
    id: "default",
    name: "Muses Safe Default",
  },
  appearance: DEFAULT_APPEARANCE,
  belief: {
    states: ["EXPLORE", "BUILD", "DEBUG", "REVIEW", "WAIT", "BREAK", "UNKNOWN"],
    unknownState: "UNKNOWN",
    minimumConfidence: 0.72,
    minimumMargin: 0.12,
    stabilityWindowMs: 15_000,
  },
  decision: {
    unknownOutcome: "NO_ACTION",
    lowConfidenceOutcome: "NO_ACTION",
    reversibleEffectsOnly: true,
    cooldownMs: 120_000,
    manualUndoWindowMs: 600_000,
    quietHours: DEFAULT_QUIET_HOURS,
  },
  signals: [
    { id: "ide.activity", enabled: true, retainRaw: false, weight: 1 },
    { id: "git.activity", enabled: true, retainRaw: false, weight: 0.8 },
    { id: "app.focus", enabled: true, retainRaw: false, weight: 0.7 },
    { id: "terminal.activity", enabled: true, retainRaw: false, weight: 0.8 },
    { id: "manual.feedback", enabled: true, retainRaw: true, weight: 1.4 },
  ],
  audio: {
    enabled: true,
    masterGain: 0.35,
    profiles: [
      {
        // v0.6 soundscape ladder: the four actionable states publish the
        // canonical gains from ACTIONABLE_PROFILE_DEFAULTS (flow 0.35 /
        // debug 0.30 / diverge 0.28 / audit 0.25) so adjacent states are
        // always audibly distinct; profile-map.test.ts pins the drift.
        state: "EXPLORE",
        soundscapeId: "ambient.explore",
        targetGain: 0.28,
        transitionMs: 3_000,
      },
      {
        state: "BUILD",
        soundscapeId: "ambient.build",
        targetGain: 0.35,
        transitionMs: 2_000,
      },
      {
        state: "DEBUG",
        soundscapeId: "ambient.debug",
        targetGain: 0.3,
        transitionMs: 1_500,
      },
      {
        state: "REVIEW",
        soundscapeId: "ambient.review",
        targetGain: 0.25,
        transitionMs: 2_500,
      },
      {
        state: "WAIT",
        soundscapeId: "ambient.wait",
        targetGain: 0.2,
        transitionMs: 4_000,
      },
      {
        state: "BREAK",
        soundscapeId: "ambient.break",
        targetGain: 0.22,
        transitionMs: 5_000,
      },
      {
        state: "UNKNOWN",
        soundscapeId: null,
        targetGain: 0,
        transitionMs: 1_000,
      },
    ],
  },
  privacy: {
    localOnly: true,
    cloudSync: false,
    rawEventRetentionHours: 24,
    sessionHistoryRetentionDays: 30,
    excludedApplications: [],
    captureScreenContent: false,
  },
  // Disabled by default: the LLM layer is an optional enhancement and the app
  // is fully functional without it. The dashboard widget is also opt-in — the
  // default surface below deliberately does not include an llm.narration one.
  llm: DEFAULT_LLM_SECTION,
  surface: {
    widgets: [
      {
        id: "primary-state",
        type: "state.hero",
        showConfidence: true,
        showUnknownReason: true,
      },
      {
        id: "belief-distribution",
        type: "belief.distribution",
        maxStates: 7,
        showFactorContributions: true,
      },
      { id: "evidence", type: "evidence.list", limit: 12, showSource: true },
      {
        id: "events",
        type: "events.timeline",
        limit: 100,
        showPayloadSummary: false,
      },
      {
        id: "decision",
        type: "decision.card",
        showNoAction: true,
        showUndoAvailability: true,
      },
      {
        id: "audio",
        type: "audio.control",
        allowManualOverride: true,
        showMasterVolume: true,
      },
      {
        id: "metrics",
        type: "metrics.grid",
        metrics: [
          "belief.confidence",
          "belief.stability",
          "events.rate",
          "effects.reversalRate",
        ],
      },
      {
        id: "privacy",
        type: "privacy.status",
        showRetention: true,
        showExcludedApplications: true,
      },
    ],
  },
} as const;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export const DEFAULT_SETTINGS: SettingsDocument = deepFreeze(
  parseSettings(candidateDefaultSettings),
);
