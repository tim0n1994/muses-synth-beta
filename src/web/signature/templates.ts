import type { SignatureTemplate, TemplateId } from "./contracts.js";

export const TEMPLATE_ORDER: readonly TemplateId[] = [
  "minimalElectronic",
  "ambient",
  "lofiJazz",
];

export const SIGNATURE_TEMPLATES: Readonly<
  Record<TemplateId, SignatureTemplate>
> = {
  minimalElectronic: {
    id: "minimalElectronic",
    defaults: {
      bpmRange: { min: 118, max: 138 },
      energyCap: 0.7,
      vocalDensity: "low",
    },
    nameKey: "signature.template.minimalElectronic.name",
    descriptionKey: "signature.template.minimalElectronic.description",
  },
  ambient: {
    id: "ambient",
    defaults: {
      bpmRange: { min: 60, max: 80 },
      energyCap: 0.35,
      vocalDensity: "none",
    },
    nameKey: "signature.template.ambient.name",
    descriptionKey: "signature.template.ambient.description",
  },
  lofiJazz: {
    id: "lofiJazz",
    defaults: {
      bpmRange: { min: 70, max: 90 },
      energyCap: 0.5,
      vocalDensity: "low",
    },
    nameKey: "signature.template.lofiJazz.name",
    descriptionKey: "signature.template.lofiJazz.description",
  },
};

export function isTemplateId(value: unknown): value is TemplateId {
  return (
    typeof value === "string" &&
    (TEMPLATE_ORDER as readonly string[]).includes(value)
  );
}

export function getTemplate(id: TemplateId): SignatureTemplate {
  const template = SIGNATURE_TEMPLATES[id];
  if (template === undefined) {
    throw new Error(`Unknown signature template: ${String(id)}.`);
  }
  return template;
}
