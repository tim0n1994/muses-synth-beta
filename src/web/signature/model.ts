import type {
  ResolvedSignature,
  SignatureCalibration,
  TemplateId,
  VocalDensity,
} from "./contracts.js";
import { getTemplate } from "./templates.js";

export const BPM_FLOOR = 40;
export const BPM_CEILING = 200;

const VOCAL_DENSITIES: readonly VocalDensity[] = [
  "none",
  "low",
  "medium",
  "high",
];

export function isVocalDensity(value: unknown): value is VocalDensity {
  return (
    typeof value === "string" &&
    (VOCAL_DENSITIES as readonly string[]).includes(value)
  );
}

/** UI-facing validation: every problem as a user-readable message. */
export function validateCalibration(
  calibration: SignatureCalibration,
): string[] {
  const errors: string[] = [];
  const { bpmRange, energyCap, vocalDensity } = calibration;
  if (bpmRange !== undefined) {
    const { min, max } = bpmRange;
    if (
      typeof min !== "number" ||
      typeof max !== "number" ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min < BPM_FLOOR ||
      max > BPM_CEILING ||
      min >= max
    ) {
      errors.push(
        `BPM bounds must satisfy ${BPM_FLOOR} <= lower < upper <= ${BPM_CEILING}.`,
      );
    }
  }
  if (
    energyCap !== undefined &&
    (typeof energyCap !== "number" ||
      !Number.isFinite(energyCap) ||
      energyCap < 0 ||
      energyCap > 1)
  ) {
    errors.push("Energy cap must be between 0 and 1.");
  }
  if (vocalDensity !== undefined && !isVocalDensity(vocalDensity)) {
    errors.push("Vocal density must be none, low, medium, or high.");
  }
  return errors;
}

function clamp(value: number, floor: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(floor, value));
}

/**
 * Merge template defaults with manual calibration. Total and forgiving:
 * structurally invalid input falls back to the template default, finite
 * numeric input is clamped into the legal envelope.
 */
export function resolveSignature(
  templateId: TemplateId,
  calibration: SignatureCalibration,
): ResolvedSignature {
  const template = getTemplate(templateId);
  const defaults = template.defaults;

  let bpmRange = defaults.bpmRange;
  if (
    calibration.bpmRange !== undefined &&
    Number.isFinite(calibration.bpmRange.min) &&
    Number.isFinite(calibration.bpmRange.max) &&
    calibration.bpmRange.min < calibration.bpmRange.max
  ) {
    bpmRange = {
      min: clamp(calibration.bpmRange.min, BPM_FLOOR, BPM_CEILING),
      max: clamp(calibration.bpmRange.max, BPM_FLOOR, BPM_CEILING),
    };
  }

  let energyCap = defaults.energyCap;
  if (
    calibration.energyCap !== undefined &&
    Number.isFinite(calibration.energyCap)
  ) {
    energyCap = clamp(calibration.energyCap, 0, 1);
  }

  let vocalDensity = defaults.vocalDensity;
  if (isVocalDensity(calibration.vocalDensity)) {
    vocalDensity = calibration.vocalDensity;
  }

  return { templateId, bpmRange, energyCap, vocalDensity };
}
