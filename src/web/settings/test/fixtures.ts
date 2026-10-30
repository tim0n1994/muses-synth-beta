import {
  SETTINGS_SCHEMA_VERSION,
  type SettingsDocument,
  type SettingsDraft,
  type SettingsRelease,
  type SettingsSnapshot,
  type SettingsPreview,
} from "../model/document";

const CHECKSUM_DRAFT = "a".repeat(64);
const CHECKSUM_RELEASE = "b".repeat(64);

/**
 * Mirrors `DEFAULT_SETTINGS` from the server. `settings.contract.test.ts`
 * asserts the real server default still satisfies the web guards, so this
 * fixture cannot drift silently.
 */
export const baseDocument: SettingsDocument = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  profile: { id: "default", name: "Muses Safe Default" },
  appearance: {
    productName: "Muses",
    theme: "system",
    accentColor: "#6c8cff",
    density: "comfortable",
    reducedMotion: false,
    language: "en",
  },
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
    quietHours: {
      enabled: false,
      startMinuteInclusive: 1_320,
      endMinuteExclusive: 480,
    },
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
  llm: { enabled: false, model: "auto" },
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
};

export const draftDocument: SettingsDocument = {
  ...structuredClone(baseDocument),
  appearance: { ...baseDocument.appearance, theme: "dark" },
};

export const draft: SettingsDraft = {
  id: "primary",
  baseReleaseId: "release-1",
  revision: 2,
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  document: draftDocument,
  checksum: CHECKSUM_DRAFT,
  createdAt: "2026-07-29T18:00:00.000Z",
  updatedAt: "2026-07-29T19:00:00.000Z",
};

export const currentRelease: SettingsRelease = {
  id: "release-1",
  releaseNumber: 1,
  parentReleaseId: null,
  rollbackOfReleaseId: null,
  sourceDraftRevision: 1,
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  document: baseDocument,
  checksum: CHECKSUM_RELEASE,
  actor: "system",
  reason: "validated default settings seed",
  publishedAt: "2026-07-29T18:00:00.000Z",
  createdAt: "2026-07-29T18:00:00.000Z",
};

export const settingsSnapshot: SettingsSnapshot = { draft, currentRelease };

export const releases: SettingsRelease[] = [currentRelease];

export const previewResult: SettingsPreview = {
  valid: true,
  checksum: CHECKSUM_DRAFT,
  againstReleaseId: currentRelease.id,
  againstChecksum: CHECKSUM_RELEASE,
  changedPaths: ["/appearance/theme"],
  changed: true,
  document: draftDocument,
};
