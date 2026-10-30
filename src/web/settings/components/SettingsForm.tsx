import {
  clockToMinutes,
  minutesToClock,
  WORK_STATES,
  type SettingsSectionId,
} from "../model/document";
import { LOCALES, LOCALE_NATIVE_NAMES, useI18n } from "../../i18n";
import { DashboardEditor } from "./DashboardEditor";
import {
  CheckboxField,
  NumberField,
  SectionCard,
  SelectField,
  TextField,
  getErrorMessage,
  type EditorProps,
  type SettingsForm as Form,
} from "./fields";

interface SettingsFormProps {
  form: Form;
  activeSection: SettingsSectionId;
}

export function SettingsForm({
  form,
  activeSection,
}: SettingsFormProps): React.JSX.Element {
  switch (activeSection) {
    case "appearance":
      return <AppearanceEditor form={form} />;
    case "belief":
      return <BeliefEditor form={form} />;
    case "decision":
      return <DecisionEditor form={form} />;
    case "signals":
      return <SignalsEditor />;
    case "audio":
      return <AudioEditor form={form} />;
    case "privacy":
      return <PrivacyEditor form={form} />;
    case "llm":
      return <LlmEditor form={form} />;
    case "surface":
      return <DashboardEditor form={form} />;
    default: {
      const exhaustive: never = activeSection;
      return exhaustive;
    }
  }
}

function AppearanceEditor({ form }: EditorProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <SectionCard
      title={t("settings.editor.appearance.title")}
      description={t("settings.editor.appearance.description")}
    >
      <div className="settings-form-grid">
        <TextField
          form={form}
          path="appearance.productName"
          label={t("settings.editor.appearance.productName")}
          maxLength={80}
          help={t("settings.editor.appearance.productNameHelp")}
        />
        <SelectField
          form={form}
          path="appearance.theme"
          label={t("settings.editor.appearance.theme")}
        >
          <option value="system">
            {t("settings.editor.appearance.themeSystem")}
          </option>
          <option value="light">
            {t("settings.editor.appearance.themeLight")}
          </option>
          <option value="dark">
            {t("settings.editor.appearance.themeDark")}
          </option>
        </SelectField>
        <TextField
          form={form}
          path="appearance.accentColor"
          label={t("settings.editor.appearance.accentColor")}
          placeholder="#6c8cff"
          help={t("settings.editor.appearance.accentHelp")}
        />
        <SelectField
          form={form}
          path="appearance.density"
          label={t("settings.editor.appearance.density")}
        >
          <option value="comfortable">
            {t("settings.editor.appearance.densityComfortable")}
          </option>
          <option value="compact">
            {t("settings.editor.appearance.densityCompact")}
          </option>
        </SelectField>
        <CheckboxField
          form={form}
          path="appearance.reducedMotion"
          label={t("settings.editor.appearance.reducedMotion")}
        />
        <SelectField
          form={form}
          path="appearance.language"
          label={t("settings.editor.appearance.language")}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_NATIVE_NAMES[code]}
            </option>
          ))}
        </SelectField>
      </div>
    </SectionCard>
  );
}

function BeliefEditor({ form }: EditorProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <SectionCard
      title={t("settings.editor.belief.title")}
      description={t("settings.editor.belief.description")}
    >
      <div className="settings-form-grid">
        <NumberField
          form={form}
          path="belief.minimumConfidence"
          label={t("settings.editor.belief.minimumConfidence")}
          min={0.5}
          max={1}
          step={0.01}
          help={t("settings.editor.belief.minimumConfidenceHelp")}
        />
        <NumberField
          form={form}
          path="belief.minimumMargin"
          label={t("settings.editor.belief.minimumMargin")}
          min={0}
          max={1}
          step={0.01}
          help={t("settings.editor.belief.minimumMarginHelp")}
        />
        <NumberField
          form={form}
          path="belief.stabilityWindowMs"
          label={t("settings.editor.belief.stabilityWindow")}
          min={1_000}
          max={3_600_000}
          step={1_000}
          help={t("settings.editor.belief.stabilityWindowHelp")}
        />
      </div>
      <p className="settings-static-note">
        {t("settings.editor.belief.note", {
          states: WORK_STATES.join(", "),
        })}
      </p>
    </SectionCard>
  );
}

function DecisionEditor({ form }: EditorProps): React.JSX.Element {
  const { t } = useI18n();
  const quietStart = form.watch("decision.quietHours.startMinuteInclusive");
  const quietEnd = form.watch("decision.quietHours.endMinuteExclusive");

  return (
    <SectionCard
      title={t("settings.editor.decision.title")}
      description={t("settings.editor.decision.description")}
    >
      <div className="settings-form-grid">
        <NumberField
          form={form}
          path="decision.cooldownMs"
          label={t("settings.editor.decision.cooldown")}
          min={0}
          max={3_600_000}
          step={1_000}
          help={t("settings.editor.decision.cooldownHelp")}
        />
        <NumberField
          form={form}
          path="decision.manualUndoWindowMs"
          label={t("settings.editor.decision.undoWindow")}
          min={1_000}
          max={86_400_000}
          step={1_000}
          help={t("settings.editor.decision.undoWindowHelp")}
        />
        <CheckboxField
          form={form}
          path="decision.quietHours.enabled"
          label={t("settings.editor.decision.quietHours")}
        />
        <ClockField
          form={form}
          path="decision.quietHours.startMinuteInclusive"
          label={t("settings.editor.decision.quietFrom")}
          value={quietStart}
        />
        <ClockField
          form={form}
          path="decision.quietHours.endMinuteExclusive"
          label={t("settings.editor.decision.quietUntil")}
          value={quietEnd}
        />
      </div>
      <p className="settings-static-note">
        {t("settings.editor.decision.note")}
      </p>
    </SectionCard>
  );
}

interface ClockFieldProps {
  form: Form;
  path:
    | "decision.quietHours.startMinuteInclusive"
    | "decision.quietHours.endMinuteExclusive";
  label: string;
  value: number;
}

/**
 * Minutes-since-midnight is the wire format the policy engine consumes; a raw
 * number input for it is hostile, so this edits an `HH:MM` clock and converts.
 */
function ClockField({
  form,
  path,
  label,
  value,
}: ClockFieldProps): React.JSX.Element {
  const inputId = `settings-${path.replace(/\./g, "-")}`;
  const error = getErrorMessage(form.formState.errors, path);
  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="time"
        value={minutesToClock(value)}
        aria-invalid={error !== null}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          const minutes = clockToMinutes(event.target.value);
          if (minutes === null) {
            return;
          }
          form.setValue(path, minutes, {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: true,
          });
        }}
      />
      {error === null ? null : (
        <span className="settings-field-error">{error}</span>
      )}
    </div>
  );
}

function SignalsEditor(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <SectionCard
      title={t("settings.editor.signals.title")}
      description={t("settings.editor.signals.description")}
    >
      {null}
    </SectionCard>
  );
}

function AudioEditor({ form }: EditorProps): React.JSX.Element {
  const { t } = useI18n();
  const profiles = form.watch("audio.profiles");
  return (
    <SectionCard
      title={t("settings.editor.audio.title")}
      description={t("settings.editor.audio.description")}
    >
      <div className="settings-form-grid">
        <CheckboxField
          form={form}
          path="audio.enabled"
          label={t("settings.editor.audio.allowAutomatic")}
        />
        <NumberField
          form={form}
          path="audio.masterGain"
          label={t("settings.editor.audio.masterGain")}
          min={0}
          max={1}
          step={0.01}
          help={t("settings.editor.audio.masterGainHelp")}
        />
      </div>
      <div className="settings-profile-list">
        {profiles.map((profile, index) => {
          const isUnknown = profile.state === "UNKNOWN";
          return (
            <div className="settings-profile-row" key={profile.state}>
              <strong>{profile.state}</strong>
              <TextField
                form={form}
                path={`audio.profiles.${index}.soundscapeId`}
                label={t("settings.editor.audio.soundscape")}
                maxLength={128}
              />
              <NumberField
                form={form}
                path={`audio.profiles.${index}.targetGain`}
                label={t("settings.editor.audio.targetGain")}
                min={0}
                max={1}
                step={0.01}
              />
              <NumberField
                form={form}
                path={`audio.profiles.${index}.transitionMs`}
                label={t("settings.editor.audio.ramp")}
                min={0}
                max={60_000}
                step={100}
              />
              {isUnknown ? (
                <small className="settings-static-note">
                  {t("settings.editor.audio.unknownNote")}
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function LlmEditor({ form }: EditorProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <SectionCard
      title={t("settings.editor.llm.title")}
      description={t("settings.editor.llm.description")}
    >
      <div className="settings-form-grid">
        <CheckboxField
          form={form}
          path="llm.enabled"
          label={t("settings.editor.llm.enable")}
          help={t("settings.editor.llm.enableHelp")}
        />
        <TextField
          form={form}
          path="llm.model"
          label={t("settings.editor.llm.model")}
          placeholder="auto"
          maxLength={128}
          help={t("settings.editor.llm.modelHelp")}
        />
      </div>
      <p className="settings-static-note">{t("settings.editor.llm.note")}</p>
    </SectionCard>
  );
}

function PrivacyEditor({ form }: EditorProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <SectionCard
      title={t("settings.editor.privacy.title")}
      description={t("settings.editor.privacy.description")}
    >
      <div className="settings-form-grid">
        <NumberField
          form={form}
          path="privacy.rawEventRetentionHours"
          label={t("settings.editor.privacy.rawEventRetention")}
          min={0}
          max={2_160}
          help={t("settings.editor.privacy.rawEventRetentionHelp")}
        />
      </div>
    </SectionCard>
  );
}
