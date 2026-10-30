import { hashCanonicalJson } from "../canonical-json";
import { SCHEMA_VERSION } from "../constants";
import type { Belief } from "../schemas/belief";
import type { DashboardComponent } from "../schemas/dashboard";
import type { Decision, DecisionRationaleItem } from "../schemas/decision";
import type { Effect } from "../schemas/effect";
import type { ContextEvent } from "../schemas/event";
import type {
  SettingsDocument,
  SettingsDraft,
  SettingsHistory,
  SettingsPreview,
  SettingsRelease,
} from "../schemas/settings";

export const validEvent: ContextEvent = {
  schemaVersion: SCHEMA_VERSION,
  kind: "event",
  id: "evt.editor.focus.0001",
  type: "editor.focus.changed",
  source: { kind: "EDITOR", name: "vscode", version: "1.0.0" },
  occurredAt: "2026-07-30T00:00:00.000Z",
  observedAt: "2026-07-30T00:00:00.125Z",
  sensitivity: "INTERNAL",
  ttlSeconds: 3_600,
  payload: {
    workspaceId: "workspace.local.001",
    focused: true,
    activeFileExtension: "ts",
    diagnostics: 2,
  },
  correlationId: "corr.session.0001",
  tags: ["editor", "focus"],
};

export const validBelief: Belief = {
  schemaVersion: SCHEMA_VERSION,
  kind: "belief",
  id: "belief.flow.0001",
  subjectId: "workspace.local.001",
  generatedAt: "2026-07-30T00:00:01.000Z",
  revision: 1,
  status: "KNOWN",
  confidence: 0.82,
  evidence: [
    {
      id: "evidence.focus.0001",
      eventId: validEvent.id,
      factorId: "attention",
      observedAt: validEvent.observedAt,
      direction: "SUPPORTS",
      weight: 0.8,
      summary: "Editor remained focused with low diagnostic churn.",
      sensitivity: "INTERNAL",
    },
  ],
  factors: [
    {
      id: "attention",
      label: "Attention continuity",
      probabilities: [
        { stateId: "deep", label: "Deep focus", probability: 0.72 },
        { stateId: "shallow", label: "Shallow focus", probability: 0.18 },
      ],
      unknownProbability: 0.1,
      confidence: 0.82,
      freshness: {
        observedAt: validEvent.observedAt,
        expiresAt: "2026-07-30T00:05:00.125Z",
        score: 0.96,
      },
      evidenceIds: ["evidence.focus.0001"],
    },
  ],
};

export const validUnknownBelief: Belief = {
  schemaVersion: SCHEMA_VERSION,
  kind: "belief",
  id: "belief.flow.unknown.0001",
  subjectId: "workspace.local.001",
  generatedAt: "2026-07-30T00:00:01.000Z",
  revision: 1,
  status: "UNKNOWN",
  unknownReason: "NO_OBSERVATIONS",
  confidence: 0,
  evidence: [],
  factors: [
    {
      id: "attention",
      label: "Attention continuity",
      probabilities: [],
      unknownProbability: 1,
      confidence: 0,
      freshness: {
        observedAt: "2026-07-30T00:00:00.000Z",
        expiresAt: "2026-07-30T00:01:00.000Z",
        score: 0,
      },
      evidenceIds: [],
    },
  ],
};

const rationale: DecisionRationaleItem[] = [
  {
    factorId: "attention",
    contribution: 0.74,
    explanation:
      "Attention continuity supports a low-disruption audio profile.",
    evidenceIds: ["evidence.focus.0001"],
  },
];

export const validDecisions: readonly Decision[] = [
  {
    schemaVersion: SCHEMA_VERSION,
    kind: "decision",
    id: "decision.no-action.0001",
    beliefId: validBelief.id,
    createdAt: "2026-07-30T00:00:02.000Z",
    confidence: 0.3,
    rationale: [...rationale],
    decisionType: "NO_ACTION",
    reason: "LOW_CONFIDENCE",
  },
  {
    schemaVersion: SCHEMA_VERSION,
    kind: "decision",
    id: "decision.recommend.0001",
    beliefId: validBelief.id,
    createdAt: "2026-07-30T00:00:02.000Z",
    confidence: 0.72,
    rationale: [...rationale],
    decisionType: "RECOMMEND",
    recommendation: "Use the quiet-focus profile.",
    proposedEffect: {
      type: "audio.set_profile",
      profileId: "quiet-focus",
      crossfadeMs: 2_000,
    },
  },
  {
    schemaVersion: SCHEMA_VERSION,
    kind: "decision",
    id: "decision.confirm.0001",
    beliefId: validBelief.id,
    createdAt: "2026-07-30T00:00:02.000Z",
    confidence: 0.78,
    rationale: [...rationale],
    decisionType: "REQUEST_CONFIRMATION",
    prompt: "Switch to the quiet-focus profile?",
    proposedEffect: {
      type: "audio.set_profile",
      profileId: "quiet-focus",
      crossfadeMs: 2_000,
    },
    expiresAt: "2026-07-30T00:05:02.000Z",
  },
  {
    schemaVersion: SCHEMA_VERSION,
    kind: "decision",
    id: "decision.apply.0001",
    beliefId: validBelief.id,
    createdAt: "2026-07-30T00:00:02.000Z",
    confidence: 0.91,
    rationale: [...rationale],
    decisionType: "APPLY_EFFECT",
    effectId: "effect.audio.0001",
    effect: {
      type: "audio.set_profile",
      profileId: "quiet-focus",
      crossfadeMs: 2_000,
    },
    rollbackWindowSeconds: 600,
  },
  {
    schemaVersion: SCHEMA_VERSION,
    kind: "decision",
    id: "decision.revert.0001",
    beliefId: validBelief.id,
    createdAt: "2026-07-30T00:10:02.000Z",
    confidence: 0.95,
    rationale: [...rationale],
    decisionType: "REVERT_EFFECT",
    targetEffectId: "effect.audio.0001",
    reason: "User feedback indicated the profile was distracting.",
  },
];

export const validEffect: Effect = {
  schemaVersion: SCHEMA_VERSION,
  kind: "effect",
  id: "effect.audio.0001",
  decisionId: "decision.apply.0001",
  idempotencyKey: "idem.effect.audio.0001",
  createdAt: "2026-07-30T00:00:02.100Z",
  updatedAt: "2026-07-30T00:00:02.300Z",
  status: "APPLIED",
  reversible: true,
  spec: {
    type: "audio.set_profile",
    profileId: "quiet-focus",
    crossfadeMs: 2_000,
  },
  appliedAt: "2026-07-30T00:00:02.300Z",
};

export const validEffects: readonly Effect[] = [
  {
    schemaVersion: SCHEMA_VERSION,
    kind: "effect",
    id: "effect.pending.0001",
    decisionId: "decision.apply.0001",
    idempotencyKey: "idem.effect.pending.0001",
    createdAt: "2026-07-30T00:00:02.100Z",
    updatedAt: "2026-07-30T00:00:02.100Z",
    status: "PENDING",
    reversible: true,
    spec: {
      type: "audio.set_profile",
      profileId: "quiet-focus",
      crossfadeMs: 2_000,
    },
  },
  validEffect,
  {
    schemaVersion: SCHEMA_VERSION,
    kind: "effect",
    id: "effect.reverted.0001",
    decisionId: "decision.revert.0001",
    idempotencyKey: "idem.effect.reverted.0001",
    createdAt: "2026-07-30T00:00:02.100Z",
    updatedAt: "2026-07-30T00:10:02.300Z",
    status: "REVERTED",
    reversible: true,
    spec: {
      type: "audio.set_profile",
      profileId: "quiet-focus",
      crossfadeMs: 2_000,
    },
    appliedAt: "2026-07-30T00:00:02.300Z",
    revertedAt: "2026-07-30T00:10:02.300Z",
  },
  {
    schemaVersion: SCHEMA_VERSION,
    kind: "effect",
    id: "effect.failed.0001",
    decisionId: "decision.apply.0001",
    idempotencyKey: "idem.effect.failed.0001",
    createdAt: "2026-07-30T00:00:02.100Z",
    updatedAt: "2026-07-30T00:00:02.400Z",
    status: "FAILED",
    reversible: true,
    spec: {
      type: "audio.set_profile",
      profileId: "quiet-focus",
      crossfadeMs: 2_000,
    },
    failure: {
      code: "LOCAL_ASSET_MISSING",
      message: "The local audio asset is unavailable.",
      retryable: false,
    },
  },
];

export const validDashboardComponents: readonly DashboardComponent[] = [
  {
    id: "hero",
    type: "state.hero",
    order: 0,
    visible: true,
    props: {
      title: "Current state",
      subjectId: "workspace.local.001",
      showConfidence: true,
      showFreshness: true,
    },
  },
  {
    id: "distribution",
    type: "belief.distribution",
    order: 1,
    visible: true,
    props: {
      title: "Belief distribution",
      beliefId: validBelief.id,
      showUnknown: true,
      precision: 2,
    },
  },
  {
    id: "evidence",
    type: "evidence.list",
    order: 2,
    visible: true,
    props: {
      title: "Evidence",
      beliefId: validBelief.id,
      limit: 20,
      showNeutral: true,
    },
  },
  {
    id: "timeline",
    type: "events.timeline",
    order: 3,
    visible: true,
    props: { title: "Events", limit: 100, sensitivityCeiling: "INTERNAL" },
  },
  {
    id: "decision",
    type: "decision.card",
    order: 4,
    visible: true,
    props: { title: "Decision", showRationale: true, showRollback: true },
  },
  {
    id: "audio",
    type: "audio.control",
    order: 5,
    visible: true,
    props: {
      title: "Audio",
      showPlayPause: true,
      showVolume: true,
      showProfile: true,
      confirmProfileChange: true,
    },
  },
  {
    id: "metrics",
    type: "metrics.grid",
    order: 6,
    visible: true,
    props: {
      title: "Metrics",
      metrics: [
        { id: "confidence", label: "Confidence", unit: "%", precision: 1 },
        { id: "freshness", label: "Freshness", unit: "%", precision: 1 },
      ],
      columns: 2,
    },
  },
  {
    id: "privacy",
    type: "privacy.status",
    order: 7,
    visible: true,
    props: {
      title: "Privacy",
      showRetention: true,
      showSensitivity: true,
      showStorage: true,
    },
  },
];

export const validSettingsDocument: SettingsDocument = {
  dashboard: { components: [...validDashboardComponents] },
  decisionPolicy: {
    allowAutomaticEffects: false,
    minimumDecisionConfidence: 0.7,
    confirmationThreshold: 0.85,
    defaultRollbackWindowSeconds: 600,
  },
  audio: {
    enabled: true,
    maxVolume: 0.65,
    defaultProfileId: "quiet-focus",
    profiles: [
      {
        id: "quiet-focus",
        label: "Quiet focus",
        localAssetId: "asset.audio.quiet-focus",
        volume: 0.45,
      },
    ],
  },
  privacy: {
    localOnly: true,
    telemetry: "OFF",
    redactSensitiveEvidence: true,
    persistence: "SQLITE",
  },
};

export const validSettingsChecksum = hashCanonicalJson(validSettingsDocument);

export const validSettingsDraft: SettingsDraft = {
  schemaVersion: SCHEMA_VERSION,
  kind: "settings.draft",
  id: "settings.draft.0001",
  status: "DRAFT",
  baseReleaseId: null,
  revision: 1,
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:01:00.000Z",
  document: validSettingsDocument,
  checksum: validSettingsChecksum,
};

export const validSettingsPreview: SettingsPreview = {
  schemaVersion: SCHEMA_VERSION,
  kind: "settings.preview",
  draftId: validSettingsDraft.id,
  generatedAt: "2026-07-30T00:01:01.000Z",
  document: validSettingsDocument,
  documentChecksum: validSettingsChecksum,
  warnings: [],
};

export const validSettingsRelease: SettingsRelease = {
  schemaVersion: SCHEMA_VERSION,
  kind: "settings.release",
  id: "settings.release.0001",
  sourceDraftId: validSettingsDraft.id,
  previousReleaseId: null,
  sequence: 1,
  publishedAt: "2026-07-30T00:02:00.000Z",
  document: validSettingsDocument,
  checksum: validSettingsChecksum,
};

export const validSettingsHistory: SettingsHistory = {
  schemaVersion: SCHEMA_VERSION,
  kind: "settings.history",
  currentReleaseId: "settings.release.0001",
  entries: [
    {
      id: "settings.history.0001",
      operation: "PUBLISH",
      releaseId: "settings.release.0001",
      occurredAt: "2026-07-30T00:02:00.000Z",
      actor: "LOCAL_USER",
    },
    {
      id: "settings.history.0002",
      operation: "PUBLISH",
      releaseId: "settings.release.0002",
      occurredAt: "2026-07-30T00:03:00.000Z",
      actor: "LOCAL_USER",
    },
    {
      id: "settings.history.0003",
      operation: "ROLLBACK",
      fromReleaseId: "settings.release.0002",
      toReleaseId: "settings.release.0001",
      occurredAt: "2026-07-30T00:04:00.000Z",
      actor: "LOCAL_USER",
    },
  ],
};
