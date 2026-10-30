import { describe, expect, it } from "vitest";
import { canonicalJsonByteLength } from "../canonical-json";
import {
  MAX_EVENT_BYTES,
  SCHEMA_VERSION,
  SENSITIVITY_TTL_LIMIT_SECONDS,
} from "../constants";
import { ContractValidationError } from "../errors";
import {
  invalidAppliedEffectWithoutTimestamp,
  invalidChecksumDraft,
  invalidDangerousKeyEvent,
  invalidDashboardPropsDraft,
  invalidDuplicateComponentDraft,
  invalidDuplicateEvidenceBelief,
  invalidDuplicateStateBelief,
  invalidDynamicImportDraft,
  invalidEffectTimestampOrder,
  invalidExecutablePayloadEvent,
  invalidExecutableUriEvent,
  invalidFutureEvidenceBelief,
  invalidKnownAllUnknownBelief,
  invalidLongIdEvent,
  invalidMissingEvidenceBelief,
  invalidOversizedEvent,
  invalidPreviewChecksum,
  invalidProbabilityBelief,
  invalidProfileVolumeDraft,
  invalidRestrictedTtlEvent,
  invalidRollbackHistory,
  invalidSelfCausedEvent,
  invalidSettingsPolicyDraft,
  invalidTimestampEvent,
  invalidUnknownFieldEvent,
  invalidUnknownVersionEvent,
  invalidZeroTtlEvent,
  validBelief,
  validDashboardComponents,
  validDecisions,
  validEffects,
  validEvent,
  validSettingsDraft,
  validSettingsHistory,
  validSettingsPreview,
  validSettingsRelease,
  validUnknownBelief,
} from "../fixtures";
import {
  assertContextEvent,
  validateApiErrorEnvelope,
  validateBelief,
  validateContextEvent,
  validateDecision,
  validateEffect,
  validateJsonApiEnvelope,
  validateSettingsDraft,
  validateSettingsHistory,
  validateSettingsPreview,
  validateSettingsRelease,
} from "../validation";

describe("owned contract validators", () => {
  it("accepts a valid event", () => {
    expect(validateContextEvent(validEvent)).toMatchObject({ ok: true });
  });

  it("accepts canonical event size exactly at the byte limit and rejects one byte above it", () => {
    const base = {
      ...validEvent,
      id: "evt.byte-boundary.0001",
      payload: { text: "" },
    };
    const overhead = canonicalJsonByteLength(base);
    const atLimit = {
      ...base,
      payload: { text: "x".repeat(MAX_EVENT_BYTES - overhead) },
    };
    const aboveLimit = {
      ...atLimit,
      payload: { text: `${atLimit.payload.text}x` },
    };

    expect(canonicalJsonByteLength(atLimit)).toBe(MAX_EVENT_BYTES);
    expect(validateContextEvent(atLimit)).toMatchObject({ ok: true });
    const result = validateContextEvent(aboveLimit);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  it("accepts exact sensitivity TTL caps", () => {
    for (const [sensitivity, ttlSeconds] of Object.entries(
      SENSITIVITY_TTL_LIMIT_SECONDS,
    )) {
      const candidate = {
        ...validEvent,
        id: `evt.ttl.${sensitivity.toLowerCase()}`,
        sensitivity,
        ttlSeconds,
      };
      expect(validateContextEvent(candidate)).toMatchObject({ ok: true });
    }
  });

  it("accepts known and first-class UNKNOWN beliefs", () => {
    expect(validateBelief(validBelief)).toMatchObject({ ok: true });
    expect(validateBelief(validUnknownBelief)).toMatchObject({ ok: true });
  });

  it("accepts all five decision variants", () => {
    expect(validDecisions).toHaveLength(5);
    for (const decision of validDecisions) {
      expect(validateDecision(decision)).toMatchObject({ ok: true });
    }
  });

  it("accepts all four effect lifecycle states", () => {
    expect(validEffects).toHaveLength(4);
    for (const effect of validEffects) {
      expect(validateEffect(effect)).toMatchObject({ ok: true });
    }
  });

  it("accepts settings draft, preview, release, rollback history, and exactly eight static component types", () => {
    expect(validateSettingsDraft(validSettingsDraft)).toMatchObject({
      ok: true,
    });
    expect(validateSettingsPreview(validSettingsPreview)).toMatchObject({
      ok: true,
    });
    expect(validateSettingsRelease(validSettingsRelease)).toMatchObject({
      ok: true,
    });
    expect(validateSettingsHistory(validSettingsHistory)).toMatchObject({
      ok: true,
    });
    expect(validDashboardComponents.map((component) => component.type)).toEqual(
      [
        "state.hero",
        "belief.distribution",
        "evidence.list",
        "events.timeline",
        "decision.card",
        "audio.control",
        "metrics.grid",
        "privacy.status",
      ],
    );
  });

  it("accepts closed success and error API envelopes", () => {
    const success = {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      requestId: "request.0001",
      data: { accepted: true },
      meta: { serverTime: "2026-07-30T00:00:00.000Z" },
    };
    const error = {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      requestId: "request.0002",
      error: {
        code: "NOT_FOUND",
        message: "The requested record was not found.",
        status: 404,
        retryable: false,
      },
    };
    expect(validateJsonApiEnvelope(success)).toMatchObject({ ok: true });
    expect(validateApiErrorEnvelope(error)).toMatchObject({ ok: true });
  });

  it("rejects an unknown schema version with a specific code", () => {
    const result = validateContextEvent(invalidUnknownVersionEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN_SCHEMA_VERSION");
    }
  });

  it("rejects unknown top-level fields and overlong IDs", () => {
    expect(validateContextEvent(invalidUnknownFieldEvent)).toMatchObject({
      ok: false,
    });
    expect(validateContextEvent(invalidLongIdEvent)).toMatchObject({
      ok: false,
    });
  });

  it("rejects executable fields, handler fields, and executable URI payloads", () => {
    const fieldResult = validateContextEvent(invalidExecutablePayloadEvent);
    const uriResult = validateContextEvent(invalidExecutableUriEvent);
    const handlerResult = validateContextEvent({
      ...validEvent,
      id: "evt.handler.0001",
      payload: { onPointerDown: "not allowed" },
    });
    expect(fieldResult.ok).toBe(false);
    expect(uriResult.ok).toBe(false);
    expect(handlerResult.ok).toBe(false);
    if (!fieldResult.ok) {
      expect(fieldResult.error.code).toBe("EXECUTABLE_PAYLOAD");
    }
    if (!uriResult.ok) {
      expect(uriResult.error.code).toBe("EXECUTABLE_PAYLOAD");
    }
    if (!handlerResult.ok) {
      expect(handlerResult.error.code).toBe("EXECUTABLE_PAYLOAD");
    }
  });

  it("rejects prototype-pollution keys", () => {
    const result = validateContextEvent(invalidDangerousKeyEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DANGEROUS_KEY");
    }
  });

  it("rejects accessors without invoking them", () => {
    const payload: Record<string, unknown> = {};
    let invoked = false;
    Object.defineProperty(payload, "value", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "secret";
      },
    });
    const result = validateContextEvent({
      ...validEvent,
      id: "evt.accessor.0001",
      payload,
    });
    expect(result.ok).toBe(false);
    expect(invoked).toBe(false);
  });

  it("rejects events above the canonical byte limit", () => {
    const result = validateContextEvent(invalidOversizedEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  it("enforces sensitivity-specific TTL limits and the absolute TTL range", () => {
    const sensitivityResult = validateContextEvent(invalidRestrictedTtlEvent);
    const rangeResult = validateContextEvent(invalidZeroTtlEvent);
    expect(sensitivityResult.ok).toBe(false);
    expect(rangeResult.ok).toBe(false);
    if (!sensitivityResult.ok) {
      expect(sensitivityResult.error.code).toBe("SENSITIVITY_TTL_VIOLATION");
    }
    if (!rangeResult.ok) {
      expect(rangeResult.error.code).toBe("TTL_OUT_OF_RANGE");
    }
  });

  it("rejects impossible UTC timestamps and self-causation", () => {
    const timestampResult = validateContextEvent(invalidTimestampEvent);
    const causationResult = validateContextEvent(invalidSelfCausedEvent);
    expect(timestampResult.ok).toBe(false);
    expect(causationResult.ok).toBe(false);
    if (!timestampResult.ok) {
      expect(timestampResult.error.code).toBe("INVALID_TIMESTAMP");
    }
    if (!causationResult.ok) {
      expect(causationResult.error.code).toBe("CONFLICT");
    }
  });

  it("accepts probability mass inside normalization tolerance", () => {
    const factor = validBelief.factors[0]!;
    const nearNormalized = {
      ...validBelief,
      id: "belief.tolerance.0001",
      factors: [
        {
          ...factor,
          probabilities: [{ stateId: "deep", probability: 0.8999995 }],
          unknownProbability: 0.1,
          evidenceIds: [],
        },
      ],
      evidence: [],
    };
    expect(validateBelief(nearNormalized)).toMatchObject({ ok: true });
  });

  it("rejects probability mass outside normalization tolerance and inconsistent KNOWN status", () => {
    const probabilityResult = validateBelief(invalidProbabilityBelief);
    const statusResult = validateBelief(invalidKnownAllUnknownBelief);
    expect(probabilityResult.ok).toBe(false);
    expect(statusResult.ok).toBe(false);
    if (!probabilityResult.ok) {
      expect(probabilityResult.error.code).toBe("PROBABILITY_NOT_NORMALIZED");
    }
    if (!statusResult.ok) {
      expect(statusResult.error.code).toBe("CONFLICT");
    }
  });

  it("rejects duplicate evidence and state IDs", () => {
    const evidenceResult = validateBelief(invalidDuplicateEvidenceBelief);
    const stateResult = validateBelief(invalidDuplicateStateBelief);
    expect(evidenceResult.ok).toBe(false);
    expect(stateResult.ok).toBe(false);
    if (!evidenceResult.ok) {
      expect(evidenceResult.error.code).toBe("DUPLICATE_ID");
    }
    if (!stateResult.ok) {
      expect(stateResult.error.code).toBe("DUPLICATE_ID");
    }
  });

  it("rejects missing evidence references and evidence from the future", () => {
    const missingResult = validateBelief(invalidMissingEvidenceBelief);
    const futureResult = validateBelief(invalidFutureEvidenceBelief);
    expect(missingResult.ok).toBe(false);
    expect(futureResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.error.code).toBe("REFERENCE_NOT_FOUND");
    }
    if (!futureResult.ok) {
      expect(futureResult.error.code).toBe("INVALID_TIMESTAMP");
    }
  });

  it("binds effect lifecycle status to required fields and timestamp order", () => {
    const shapeResult = validateEffect(invalidAppliedEffectWithoutTimestamp);
    const orderResult = validateEffect(invalidEffectTimestampOrder);
    expect(shapeResult.ok).toBe(false);
    expect(orderResult.ok).toBe(false);
    if (!orderResult.ok) {
      expect(orderResult.error.code).toBe("INVALID_TIMESTAMP");
    }
  });

  it("rejects invalid dashboard props and dynamic component paths", () => {
    expect(validateSettingsDraft(invalidDashboardPropsDraft)).toMatchObject({
      ok: false,
    });
    const dynamicResult = validateSettingsDraft(invalidDynamicImportDraft);
    expect(dynamicResult.ok).toBe(false);
    if (!dynamicResult.ok) {
      expect(dynamicResult.error.code).toBe("EXECUTABLE_PAYLOAD");
    }
  });

  it("rejects duplicate dashboard component IDs", () => {
    const result = validateSettingsDraft(invalidDuplicateComponentDraft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DUPLICATE_ID");
    }
  });

  it("rejects settings checksum mismatches in drafts and previews", () => {
    const draftResult = validateSettingsDraft(invalidChecksumDraft);
    const previewResult = validateSettingsPreview(invalidPreviewChecksum);
    expect(draftResult.ok).toBe(false);
    expect(previewResult.ok).toBe(false);
    if (!draftResult.ok) {
      expect(draftResult.error.code).toBe("CHECKSUM_MISMATCH");
    }
    if (!previewResult.ok) {
      expect(previewResult.error.code).toBe("CHECKSUM_MISMATCH");
    }
  });

  it("rejects inconsistent decision thresholds and profile volumes", () => {
    const policyResult = validateSettingsDraft(invalidSettingsPolicyDraft);
    const volumeResult = validateSettingsDraft(invalidProfileVolumeDraft);
    expect(policyResult.ok).toBe(false);
    expect(volumeResult.ok).toBe(false);
    if (!policyResult.ok) {
      expect(policyResult.error.code).toBe("CONFLICT");
    }
    if (!volumeResult.ok) {
      expect(volumeResult.error.code).toBe("CONFLICT");
    }
  });

  it("rejects rollback history that references an unpublished target", () => {
    const result = validateSettingsHistory(invalidRollbackHistory);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REFERENCE_NOT_FOUND");
    }
  });

  it("assert helpers throw structured errors whose API shape contains no stack", () => {
    expect(() => assertContextEvent(invalidUnknownVersionEvent)).toThrow(
      ContractValidationError,
    );
    try {
      assertContextEvent(invalidUnknownVersionEvent);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ContractValidationError);
      if (error instanceof ContractValidationError) {
        const envelope = error.toApiEnvelope("request.0001");
        expect(envelope).not.toHaveProperty("stack");
        expect(envelope.error).not.toHaveProperty("stack");
        expect(envelope.error.code).toBe("UNKNOWN_SCHEMA_VERSION");
        expect(validateApiErrorEnvelope(envelope)).toMatchObject({ ok: true });
      }
    }
  });
});
