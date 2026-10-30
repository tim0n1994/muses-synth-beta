import { useMemo, useState } from "react";

import { useI18n } from "../i18n/index.js";
import type {
  SignatureCalibration,
  SignatureDraft,
  TemplateId,
  VocalDensity,
} from "./contracts.js";
import { createSignatureTranslator } from "./copy.js";
import {
  resolveSignature,
  validateCalibration,
  BPM_FLOOR,
  BPM_CEILING,
} from "./model.js";
import {
  createLocalStorageDraftStorage,
  type DraftStoragePort,
} from "./storage.js";
import {
  createLocalStorageFeedbackJournal,
  type FeedbackJournalPort,
} from "./calibration-journal.js";
import { TEMPLATE_ORDER } from "./templates.js";

export interface SignaturePanelProps {
  readonly storage?: DraftStoragePort;
  readonly journal?: FeedbackJournalPort;
}

const VOCAL_DENSITY_ORDER: readonly VocalDensity[] = [
  "none",
  "low",
  "medium",
  "high",
];

export function SignaturePanel(props: SignaturePanelProps): React.JSX.Element {
  const { lang } = useI18n();
  const t = createSignatureTranslator(lang);
  const storage = props.storage ?? createLocalStorageDraftStorage(STORAGE_KEY);
  const journal =
    props.journal ?? createLocalStorageFeedbackJournal(JOURNAL_KEY);

  const [templateId, setTemplateId] = useState<TemplateId>(
    () => storage.load()?.templateId ?? "minimalElectronic",
  );
  const [calibration, setCalibration] = useState<SignatureCalibration>(
    () => storage.load()?.calibration ?? {},
  );
  const [error, setError] = useState<string | null>(null);

  const resolved = useMemo(
    () => resolveSignature(templateId, calibration),
    [templateId, calibration],
  );

  const persist = (
    nextTemplate: TemplateId,
    nextCalibration: SignatureCalibration,
  ): void => {
    const draft: SignatureDraft = {
      templateId: nextTemplate,
      calibration: nextCalibration,
      updatedAt: new Date().toISOString(),
    };
    storage.save(draft);
  };

  const selectTemplate = (next: TemplateId): void => {
    setTemplateId(next);
    setCalibration({});
    setError(null);
    persist(next, {});
  };

  const applyBpmBound = (bound: "min" | "max", raw: string): void => {
    const value = Number.parseInt(raw, 10);
    const other =
      bound === "min" ? resolved.bpmRange.max : resolved.bpmRange.min;
    const candidate =
      bound === "min" ? { min: value, max: other } : { min: other, max: value };
    const problems = validateCalibration({ bpmRange: candidate });
    if (Number.isNaN(value) || problems.length > 0) {
      setError(t("signature.calibration.error.bpmRange"));
      return;
    }
    setError(null);
    const next: SignatureCalibration = { ...calibration, bpmRange: candidate };
    setCalibration(next);
    persist(templateId, next);
  };

  const applyEnergyCap = (raw: string): void => {
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) {
      return;
    }
    const next: SignatureCalibration = {
      ...calibration,
      energyCap: Math.min(1, Math.max(0, value)),
    };
    setCalibration(next);
    setError(null);
    persist(templateId, next);
  };

  const applyVocalDensity = (value: VocalDensity): void => {
    const next: SignatureCalibration = { ...calibration, vocalDensity: value };
    setCalibration(next);
    setError(null);
    persist(templateId, next);
  };

  const entries = journal.exportEntries();
  void entries;

  return (
    <section aria-labelledby="signature-heading">
      <h1 id="signature-heading">{t("signature.title")}</h1>
      <p>{t("signature.subtitle")}</p>

      <fieldset>
        <legend>{t("signature.title")}</legend>
        <div role="radiogroup" aria-label={t("signature.title")}>
          {TEMPLATE_ORDER.map((id) => (
            <label key={id}>
              <input
                type="radio"
                name="signature-template"
                value={id}
                checked={templateId === id}
                onChange={() => {
                  selectTemplate(id);
                }}
              />
              {t(`signature.template.${id}.name` as const)}
            </label>
          ))}
        </div>
        <p>{t(`signature.template.${templateId}.description` as const)}</p>
      </fieldset>

      <div>
        <label>
          {t("signature.calibration.bpmMin.label")}
          <input
            type="number"
            min={BPM_FLOOR}
            max={BPM_CEILING}
            defaultValue={resolved.bpmRange.min}
            key={`bpm-min-${templateId}`}
            onChange={(event) => {
              applyBpmBound("min", event.target.value);
            }}
          />
        </label>
        <label>
          {t("signature.calibration.bpmMax.label")}
          <input
            type="number"
            min={BPM_FLOOR}
            max={BPM_CEILING}
            defaultValue={resolved.bpmRange.max}
            key={`bpm-max-${templateId}`}
            onChange={(event) => {
              applyBpmBound("max", event.target.value);
            }}
          />
        </label>
        <label>
          {t("signature.calibration.energyCap.label")}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={resolved.energyCap}
            key={`energy-${templateId}`}
            onChange={(event) => {
              applyEnergyCap(event.target.value);
            }}
          />
        </label>
        <label>
          {t("signature.calibration.vocalDensity.label")}
          <select
            defaultValue={resolved.vocalDensity}
            key={`vocal-${templateId}`}
            onChange={(event) => {
              applyVocalDensity(event.target.value as VocalDensity);
            }}
          >
            {VOCAL_DENSITY_ORDER.map((density) => (
              <option key={density} value={density}>
                {t(`signature.calibration.vocalDensity.${density}` as const)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && <p role="alert">{error}</p>}

      <div>
        <h2>{t("signature.summary.heading")}</h2>
        <p data-testid="signature-summary">
          {t("signature.summary.bpm")}:{" "}
          <span>
            {resolved.bpmRange.min}–{resolved.bpmRange.max}
          </span>{" "}
          · {t("signature.summary.energyCap")}:{" "}
          <span>{resolved.energyCap.toFixed(2)}</span> ·{" "}
          {t("signature.summary.vocalDensity")}:{" "}
          <span>
            {t(
              `signature.calibration.vocalDensity.${resolved.vocalDensity}` as const,
            )}
          </span>
        </p>
      </div>

      <p>{t("signature.journal.notice")}</p>
    </section>
  );
}

const STORAGE_KEY = "muses.v07.signature.draft.v1";
const JOURNAL_KEY = "muses.v07.signature.feedback.v1";
