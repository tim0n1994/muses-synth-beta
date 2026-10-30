import { hashCanonicalJson } from "../canonical-json";
import { SCHEMA_VERSION } from "../constants";
import {
  validBelief,
  validEvent,
  validSettingsDocument,
  validSettingsDraft,
  validSettingsHistory,
  validSettingsPreview,
} from "./valid";

export const invalidUnknownVersionEvent: unknown = {
  ...validEvent,
  schemaVersion: "muses.v9",
};

export const invalidUnknownFieldEvent: unknown = {
  ...validEvent,
  unexpected: true,
};

export const invalidLongIdEvent: unknown = {
  ...validEvent,
  id: `e${"x".repeat(128)}`,
};

export const invalidExecutablePayloadEvent: unknown = {
  ...validEvent,
  id: "evt.executable.0001",
  payload: { command: "rm -rf /" },
};

export const invalidExecutableUriEvent: unknown = {
  ...validEvent,
  id: "evt.executable-uri.0001",
  payload: { target: "javascript:alert(1)" },
};

const dangerousPayload = JSON.parse(
  '{"__proto__":{"polluted":true}}',
) as unknown;
export const invalidDangerousKeyEvent: unknown = {
  ...validEvent,
  id: "evt.dangerous-key.0001",
  payload: dangerousPayload,
};

export const invalidOversizedEvent: unknown = {
  ...validEvent,
  id: "evt.oversized.0001",
  payload: { text: "x".repeat(70_000) },
};

export const invalidRestrictedTtlEvent: unknown = {
  ...validEvent,
  id: "evt.ttl.0001",
  sensitivity: "RESTRICTED",
  ttlSeconds: 3_601,
};

export const invalidZeroTtlEvent: unknown = {
  ...validEvent,
  id: "evt.zero-ttl.0001",
  ttlSeconds: 0,
};

export const invalidTimestampEvent: unknown = {
  ...validEvent,
  id: "evt.timestamp.0001",
  occurredAt: "2026-02-30T00:00:00.000Z",
};

export const invalidSelfCausedEvent: unknown = {
  ...validEvent,
  causationId: validEvent.id,
};

export const invalidProbabilityBelief: unknown = {
  ...validBelief,
  id: "belief.invalid-probability.0001",
  factors: [
    {
      ...validBelief.factors[0]!,
      probabilities: [{ stateId: "deep", probability: 0.6 }],
      unknownProbability: 0.2,
    },
  ],
};

export const invalidKnownAllUnknownBelief: unknown = {
  ...validBelief,
  id: "belief.known-all-unknown.0001",
  evidence: [],
  factors: [
    {
      ...validBelief.factors[0]!,
      probabilities: [],
      unknownProbability: 1,
      evidenceIds: [],
    },
  ],
};

export const invalidDuplicateEvidenceBelief: unknown = {
  ...validBelief,
  id: "belief.duplicate-evidence.0001",
  evidence: [validBelief.evidence[0]!, validBelief.evidence[0]!],
};

export const invalidDuplicateStateBelief: unknown = {
  ...validBelief,
  id: "belief.duplicate-state.0001",
  factors: [
    {
      ...validBelief.factors[0]!,
      probabilities: [
        { stateId: "deep", probability: 0.5 },
        { stateId: "deep", probability: 0.4 },
      ],
      unknownProbability: 0.1,
    },
  ],
};

export const invalidMissingEvidenceBelief: unknown = {
  ...validBelief,
  id: "belief.missing-evidence.0001",
  factors: [
    {
      ...validBelief.factors[0]!,
      evidenceIds: ["evidence.missing.0001"],
    },
  ],
};

export const invalidFutureEvidenceBelief: unknown = {
  ...validBelief,
  id: "belief.future-evidence.0001",
  evidence: [
    {
      ...validBelief.evidence[0]!,
      observedAt: "2026-07-30T00:10:00.000Z",
    },
  ],
};

export const invalidAppliedEffectWithoutTimestamp: unknown = {
  schemaVersion: SCHEMA_VERSION,
  kind: "effect",
  id: "effect.applied.invalid.0001",
  decisionId: "decision.apply.0001",
  idempotencyKey: "idem.effect.applied.invalid.0001",
  createdAt: "2026-07-30T00:00:02.100Z",
  updatedAt: "2026-07-30T00:00:02.300Z",
  status: "APPLIED",
  reversible: true,
  spec: { type: "audio.pause", fadeOutMs: 500 },
};

export const invalidEffectTimestampOrder: unknown = {
  schemaVersion: SCHEMA_VERSION,
  kind: "effect",
  id: "effect.reverted.invalid.0001",
  decisionId: "decision.revert.0001",
  idempotencyKey: "idem.effect.reverted.invalid.0001",
  createdAt: "2026-07-30T00:00:02.100Z",
  updatedAt: "2026-07-30T00:10:02.300Z",
  status: "REVERTED",
  reversible: true,
  spec: { type: "audio.pause", fadeOutMs: 500 },
  appliedAt: "2026-07-30T00:05:00.000Z",
  revertedAt: "2026-07-30T00:04:00.000Z",
};

export const invalidDashboardPropsDraft: unknown = (() => {
  const document = {
    ...validSettingsDocument,
    dashboard: {
      components: [
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
            subtitle: "Unknown props are closed.",
          },
        },
      ],
    },
  };
  return {
    ...validSettingsDraft,
    id: "settings.draft.invalid-props",
    document,
    checksum: hashCanonicalJson(document),
  };
})();

export const invalidDuplicateComponentDraft: unknown = (() => {
  const document = {
    ...validSettingsDocument,
    dashboard: {
      components: [
        validSettingsDocument.dashboard.components[0]!,
        { ...validSettingsDocument.dashboard.components[0]!, order: 1 },
      ],
    },
  };
  return {
    ...validSettingsDraft,
    id: "settings.draft.duplicate-components",
    document,
    checksum: hashCanonicalJson(document),
  };
})();

export const invalidChecksumDraft: unknown = {
  ...validSettingsDraft,
  id: "settings.draft.invalid-checksum",
  checksum: "0".repeat(64),
};

export const invalidPreviewChecksum: unknown = {
  ...validSettingsPreview,
  documentChecksum: "0".repeat(64),
};

export const invalidSettingsPolicyDraft: unknown = (() => {
  const document = {
    ...validSettingsDocument,
    decisionPolicy: {
      ...validSettingsDocument.decisionPolicy,
      minimumDecisionConfidence: 0.9,
      confirmationThreshold: 0.7,
    },
  };
  return {
    ...validSettingsDraft,
    id: "settings.draft.invalid-policy",
    document,
    checksum: hashCanonicalJson(document),
  };
})();

export const invalidProfileVolumeDraft: unknown = (() => {
  const document = {
    ...validSettingsDocument,
    audio: {
      ...validSettingsDocument.audio,
      maxVolume: 0.4,
      profiles: [
        {
          ...validSettingsDocument.audio.profiles[0]!,
          volume: 0.8,
        },
      ],
    },
  };
  return {
    ...validSettingsDraft,
    id: "settings.draft.invalid-profile-volume",
    document,
    checksum: hashCanonicalJson(document),
  };
})();

export const invalidDynamicImportDraft: unknown = {
  schemaVersion: SCHEMA_VERSION,
  kind: "settings.draft",
  id: "settings.draft.dynamic-import",
  status: "DRAFT",
  baseReleaseId: null,
  revision: 1,
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
  document: {
    ...validSettingsDocument,
    dashboard: {
      components: [
        {
          id: "dynamic",
          type: "state.hero",
          order: 0,
          visible: true,
          props: {
            title: "Dynamic",
            subjectId: "workspace.local.001",
            showConfidence: true,
            showFreshness: true,
            componentPath: "./DynamicComponent",
          },
        },
      ],
    },
  },
  checksum: "0".repeat(64),
};

export const invalidRollbackHistory: unknown = {
  ...validSettingsHistory,
  currentReleaseId: "settings.release.missing",
  entries: [
    validSettingsHistory.entries[0]!,
    {
      id: "settings.history.invalid.rollback",
      operation: "ROLLBACK",
      fromReleaseId: "settings.release.0001",
      toReleaseId: "settings.release.missing",
      occurredAt: "2026-07-30T00:03:00.000Z",
      actor: "LOCAL_USER",
    },
  ],
};
