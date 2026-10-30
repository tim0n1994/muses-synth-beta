import type { DashboardSnapshot, EventPage, LlmCapabilityData } from "../types";

// These are serialized server API responses used only by tests. The production dashboard has no demo fixture or browser-owned belief state.
export const serverSnapshotFixture = {
  snapshotId: "snapshot-001",
  generatedAt: new Date().toISOString(),
  freshness: "fresh",
  staleAfterMs: 60_000,
  language: "en",
  state: {
    code: "BUILD",
    label: "Deep work",
    summary: "Sustained editor activity with low context switching.",
    confidence: 0.82,
    observedAt: new Date().toISOString(),
  },
  belief: {
    stateCode: "BUILD",
    confidence: 0.82,
    calibratedAt: new Date().toISOString(),
    modelVersion: "belief-v0.1",
    factors: [
      {
        id: "factor-editor-focus",
        label: "Editor focus",
        probability: 0.88,
        contribution: 0.41,
        direction: "positive",
        explanation:
          "The active application remained the editor for most of the observation window.",
        evidenceCount: 4,
      },
    ],
  },
  evidence: {
    total: 1,
    items: [
      {
        id: "evidence-1",
        title: "Active editor window",
        detail: "A local workspace remained active for twelve minutes.",
        sourceType: "window.activity",
        sourceLabel: "Local activity sensor",
        observedAt: new Date().toISOString(),
        weight: 0.73,
        direction: "supports",
      },
    ],
  },
  decision: {
    id: "decision-1",
    kind: "NO_ACTION",
    status: "SUPPRESSED",
    title: "No change to the current soundscape",
    rationale:
      "The current effect is consistent with the inferred state and confidence is below the intervention threshold.",
    confidence: 0.67,
    reversible: true,
    undoAvailable: false,
    createdAt: new Date().toISOString(),
    noActionReason: "Conservative threshold not met.",
    safeguards: [
      {
        id: "guard-confidence",
        label: "Confidence threshold",
        satisfied: false,
        detail: "Required 0.75; observed 0.67.",
      },
    ],
  },
  audio: {
    effectId: "effect-1",
    status: "playing",
    title: "Quiet focus",
    subtitle: "Local audio engine",
    volume: 0.42,
    canPlay: false,
    canPause: true,
    canAdjustVolume: true,
    lastChangedAt: new Date().toISOString(),
  },
  metrics: {
    windowLabel: "Last 30 minutes",
    computedAt: new Date().toISOString(),
    items: [
      {
        id: "belief.confidence",
        label: "Belief confidence",
        value: 0.82,
        displayValue: "82%",
        trend: "up",
        trendLabel: "6 points above prior window",
      },
      {
        id: "events.rate",
        label: "Evidence in window",
        value: 12,
        displayValue: "12",
        trend: "flat",
      },
    ],
  },
  privacy: {
    level: "local-only",
    localOnly: true,
    cloudCallsEnabled: false,
    apiKeysPresent: false,
    retentionLabel: "30-day local retention",
    databaseLabel: "SQLite WAL",
    checkedAt: new Date().toISOString(),
    capabilities: [
      {
        id: "privacy-cloud",
        label: "Cloud calls disabled",
        enabled: true,
        detail: "No remote inference or telemetry endpoint is configured.",
      },
    ],
  },
  pendingEffect: null,
  // The optional enhancement is absent by default: the base fixture must
  // keep exercising the "llm missing → feature hidden" path.
  llm: null,
  widgets: [
    {
      id: "state-hero",
      type: "state.hero",
      props: { showConfidence: true, showUnknownReason: true },
    },
    {
      id: "belief-distribution",
      type: "belief.distribution",
      props: { maxStates: 5, showFactorContributions: true },
    },
    {
      id: "decision-card",
      type: "decision.card",
      props: { showNoAction: true, showUndoAvailability: true },
    },
    {
      id: "evidence-list",
      type: "evidence.list",
      props: { limit: 10, showSource: true },
    },
    {
      id: "events-timeline",
      type: "events.timeline",
      props: { limit: 50, showPayloadSummary: true },
    },
    {
      id: "audio-control",
      type: "audio.control",
      props: { allowManualOverride: true, showMasterVolume: true },
    },
    {
      id: "metrics-grid",
      type: "metrics.grid",
      props: { metrics: ["belief.confidence", "events.rate"] },
    },
    {
      id: "privacy-status",
      type: "privacy.status",
      props: { showRetention: true, showExcludedApplications: true },
    },
  ],
} satisfies DashboardSnapshot;

// --- optional LLM capability variants (bootstrap `llm` section) -------------

export const llmReadyCapability: LlmCapabilityData = {
  available: true,
  enabled: true,
  configured: true,
  model: "auto",
  reason: "ready",
};

export const llmDisabledCapability: LlmCapabilityData = {
  available: false,
  enabled: false,
  configured: true,
  model: "auto",
  reason: "disabled",
};

export const llmUnconfiguredCapability: LlmCapabilityData = {
  available: false,
  enabled: true,
  configured: false,
  model: "auto",
  reason: "unconfigured",
};

/** Cooldown keeps `available` true — the panel stays and explains itself. */
export const llmCooldownCapability: LlmCapabilityData = {
  available: true,
  enabled: true,
  configured: true,
  model: "auto",
  reason: "cooldown",
};

export const llmSnapshotFixture = {
  ...serverSnapshotFixture,
  llm: llmReadyCapability,
  widgets: [
    ...serverSnapshotFixture.widgets,
    { id: "llm-narration", type: "llm.narration", props: { showModel: true } },
  ],
} satisfies DashboardSnapshot;

export const firstEventPageFixture = {
  items: [
    {
      id: "event-2",
      type: "window.activity",
      title: "Editor remained active",
      detail: "The local editor stayed foregrounded.",
      occurredAt: new Date().toISOString(),
      source: "local-observer",
      metadata: {},
    },
  ],
  nextCursor: "cursor-2",
  hasMore: true,
} satisfies EventPage;

export const secondEventPageFixture = {
  items: [
    {
      id: "event-1",
      type: "git.activity",
      title: "Local commit created",
      detail: "A commit was observed in the active workspace.",
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      source: "git-observer",
      metadata: {},
    },
  ],
  nextCursor: null,
  hasMore: false,
} satisfies EventPage;
