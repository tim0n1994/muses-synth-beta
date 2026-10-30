/**
 * Signature copy (five languages).
 *
 * Since the stage-3 integration the keys and translations live in the
 * shared catalogs (src/web/i18n/locales/*); this module is the typed
 * signature-domain view over them, keeping the component-facing translator
 * API stable. English is canonical.
 */
import {
  createTranslator,
  resolveLocale,
  type LanguageCode,
} from "../i18n/index.js";

export const SIGNATURE_COPY_KEYS = [
  "signature.title",
  "signature.subtitle",
  "signature.template.minimalElectronic.name",
  "signature.template.minimalElectronic.description",
  "signature.template.ambient.name",
  "signature.template.ambient.description",
  "signature.template.lofiJazz.name",
  "signature.template.lofiJazz.description",
  "signature.calibration.bpmMin.label",
  "signature.calibration.bpmMax.label",
  "signature.calibration.energyCap.label",
  "signature.calibration.vocalDensity.label",
  "signature.calibration.vocalDensity.none",
  "signature.calibration.vocalDensity.low",
  "signature.calibration.vocalDensity.medium",
  "signature.calibration.vocalDensity.high",
  "signature.calibration.error.bpmRange",
  "signature.summary.heading",
  "signature.summary.bpm",
  "signature.summary.energyCap",
  "signature.summary.vocalDensity",
  "signature.journal.notice",
] as const;

export type SignatureMessageKey = (typeof SIGNATURE_COPY_KEYS)[number];

function catalogFor(lang: LanguageCode): Record<SignatureMessageKey, string> {
  const translate = createTranslator(lang);
  return Object.fromEntries(
    SIGNATURE_COPY_KEYS.map((key) => [key, translate(key)]),
  ) as Record<SignatureMessageKey, string>;
}

export const SIGNATURE_COPY_CATALOGS: Readonly<
  Record<LanguageCode, Record<SignatureMessageKey, string>>
> = {
  en: catalogFor("en"),
  zh: catalogFor("zh"),
  ja: catalogFor("ja"),
  fr: catalogFor("fr"),
  es: catalogFor("es"),
};

export type SignatureTranslator = (key: SignatureMessageKey) => string;

export function createSignatureTranslator(lang: unknown): SignatureTranslator {
  const catalog = SIGNATURE_COPY_CATALOGS[resolveLocale(lang)];
  return (key) => catalog[key];
}
