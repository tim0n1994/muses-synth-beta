/** Vibe Signature v0 contracts (V9: templates + manual calibration, no learning). */

export type TemplateId = "minimalElectronic" | "ambient" | "lofiJazz";

export type VocalDensity = "none" | "low" | "medium" | "high";

export interface BpmRange {
  readonly min: number;
  readonly max: number;
}

/** Manual fine-tuning on top of a template; every field optional. */
export interface SignatureCalibration {
  readonly bpmRange?: BpmRange;
  readonly energyCap?: number;
  readonly vocalDensity?: VocalDensity;
}

/** The effective signature a plan producer consumes. */
export interface ResolvedSignature {
  readonly templateId: TemplateId;
  readonly bpmRange: BpmRange;
  readonly energyCap: number;
  readonly vocalDensity: VocalDensity;
}

export interface SignatureTemplate {
  readonly id: TemplateId;
  readonly defaults: {
    readonly bpmRange: BpmRange;
    readonly energyCap: number;
    readonly vocalDensity: VocalDensity;
  };
  readonly nameKey: `signature.template.${TemplateId}.name`;
  readonly descriptionKey: `signature.template.${TemplateId}.description`;
}

/** Persisted draft (per-user persistence is wired by the integrator). */
export interface SignatureDraft {
  readonly templateId: TemplateId;
  readonly calibration: SignatureCalibration;
  readonly updatedAt: string;
}
