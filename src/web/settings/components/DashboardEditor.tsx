import { useState } from "react";

import { useI18n } from "../../i18n";
import {
  createWidget,
  METRIC_IDS,
  widgetDefinition,
  WIDGET_DEFINITIONS,
  type MetricId,
  type Widget,
  type WidgetType,
} from "../model/document";
import {
  CheckboxField,
  NumberField,
  TextField,
  type EditorProps,
  type SettingsForm,
} from "./fields";

/**
 * Editor for `surface.widgets` — the server-provided component instances the
 * Observatory renders. Widget order is render order. There is no "enabled"
 * flag by design: a widget the user does not want is removed, so the published
 * document always describes exactly what is on screen.
 */
export function DashboardEditor({ form }: EditorProps): React.JSX.Element {
  const { t } = useI18n();
  const widgets = form.watch("surface.widgets");
  const [newType, setNewType] = useState<WidgetType>("state.hero");

  const updateWidgets = (next: Widget[]): void => {
    form.setValue("surface.widgets", next, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= widgets.length) {
      return;
    }
    const next = [...widgets];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(target, 0, moved);
    updateWidgets(next);
  };

  const addWidget = (): void => {
    const widget = createWidget(newType, widgets);
    updateWidgets([...widgets, widget]);
    queueMicrotask(() =>
      document.getElementById(`widget-${widget.id}`)?.focus(),
    );
  };

  return (
    <section
      aria-labelledby="dashboard-components-heading"
      className="settings-section-card"
    >
      <div className="settings-section-heading">
        <div>
          <h2 id="dashboard-components-heading">
            {t("settings.editor.surface.title")}
          </h2>
          <p>{t("settings.editor.surface.description")}</p>
        </div>
      </div>

      <div className="settings-add-row">
        <label>
          <span>{t("settings.editor.surface.componentType")}</span>
          <select
            value={newType}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setNewType(event.target.value as WidgetType)
            }
          >
            {WIDGET_DEFINITIONS.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {t(definition.label)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="settings-button settings-button-secondary"
          onClick={addWidget}
        >
          {t("settings.editor.surface.addComponent")}
        </button>
      </div>

      {widgets.length === 0 ? (
        <div className="settings-empty-state">
          {t("settings.editor.surface.empty")}
        </div>
      ) : (
        <ol
          className="dashboard-component-list"
          aria-label={t("settings.editor.surface.orderAria")}
        >
          {widgets.map((widget: Widget, index: number) => {
            const definition = widgetDefinition(widget.type);
            return (
              <li key={widget.id} className="dashboard-component-item">
                <div className="dashboard-component-header">
                  <div>
                    <button
                      id={`widget-${widget.id}`}
                      type="button"
                      className="dashboard-component-title"
                      aria-label={t("settings.editor.surface.componentAria", {
                        label: t(definition.label),
                        index: index + 1,
                      })}
                    >
                      <span className="dashboard-order">{index + 1}</span>
                      <span>
                        <strong>{t(definition.label)}</strong>
                        <small>{widget.type}</small>
                      </span>
                    </button>
                  </div>
                  <div className="dashboard-component-actions">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={t("settings.editor.surface.moveUp")}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === widgets.length - 1}
                      aria-label={t("settings.editor.surface.moveDown")}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="settings-danger-link"
                      onClick={() =>
                        updateWidgets(
                          widgets.filter(
                            (candidate: Widget) => candidate.id !== widget.id,
                          ),
                        )
                      }
                      aria-label={t("settings.editor.surface.removeAria", {
                        label: t(definition.label),
                      })}
                    >
                      {t("settings.editor.surface.remove")}
                    </button>
                  </div>
                </div>

                <p className="settings-static-note">
                  {t(definition.description)}
                </p>

                <div className="settings-form-grid dashboard-component-fields">
                  <TextField
                    form={form}
                    path={`surface.widgets.${index}.id`}
                    label={t("settings.editor.surface.stableId")}
                    maxLength={128}
                    help={t("settings.editor.surface.stableIdHelp")}
                  />
                  <WidgetFields form={form} widget={widget} index={index} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

interface WidgetFieldsProps {
  form: SettingsForm;
  widget: Widget;
  index: number;
}

function WidgetFields({
  form,
  widget,
  index,
}: WidgetFieldsProps): React.JSX.Element {
  const { t } = useI18n();
  const base = `surface.widgets.${index}` as const;
  switch (widget.type) {
    case "state.hero":
      return (
        <>
          <CheckboxField
            form={form}
            path={`${base}.showConfidence`}
            label={t("settings.editor.surface.showConfidence")}
          />
          <CheckboxField
            form={form}
            path={`${base}.showUnknownReason`}
            label={t("settings.editor.surface.showUnknownReason")}
          />
        </>
      );
    case "belief.distribution":
      return (
        <>
          <NumberField
            form={form}
            path={`${base}.maxStates`}
            label={t("settings.editor.surface.maxStates")}
            min={2}
            max={7}
          />
          <CheckboxField
            form={form}
            path={`${base}.showFactorContributions`}
            label={t("settings.editor.surface.showFactorContributions")}
          />
        </>
      );
    case "evidence.list":
      return (
        <>
          <NumberField
            form={form}
            path={`${base}.limit`}
            label={t("settings.editor.surface.limit")}
            min={1}
            max={100}
          />
          <CheckboxField
            form={form}
            path={`${base}.showSource`}
            label={t("settings.editor.surface.showSource")}
          />
        </>
      );
    case "events.timeline":
      return (
        <>
          <NumberField
            form={form}
            path={`${base}.limit`}
            label={t("settings.editor.surface.limit")}
            min={1}
            max={500}
          />
          <CheckboxField
            form={form}
            path={`${base}.showPayloadSummary`}
            label={t("settings.editor.surface.showPayloadSummary")}
          />
        </>
      );
    case "decision.card":
      return (
        <>
          <CheckboxField
            form={form}
            path={`${base}.showNoAction`}
            label={t("settings.editor.surface.showNoAction")}
          />
          <CheckboxField
            form={form}
            path={`${base}.showUndoAvailability`}
            label={t("settings.editor.surface.showUndoAvailability")}
          />
        </>
      );
    case "audio.control":
      return (
        <>
          <CheckboxField
            form={form}
            path={`${base}.allowManualOverride`}
            label={t("settings.editor.surface.allowManualOverride")}
          />
          <CheckboxField
            form={form}
            path={`${base}.showMasterVolume`}
            label={t("settings.editor.surface.showMasterVolume")}
          />
        </>
      );
    case "metrics.grid":
      return <MetricsPicker form={form} widget={widget} index={index} />;
    case "privacy.status":
      return (
        <>
          <CheckboxField
            form={form}
            path={`${base}.showRetention`}
            label={t("settings.editor.surface.showRetention")}
          />
          <CheckboxField
            form={form}
            path={`${base}.showExcludedApplications`}
            label={t("settings.editor.surface.showExcludedApplications")}
          />
        </>
      );
    case "llm.narration":
      return (
        <CheckboxField
          form={form}
          path={`${base}.showModel`}
          label={t("settings.editor.surface.showModelAttribution")}
        />
      );
    default: {
      const exhaustive: never = widget;
      return exhaustive;
    }
  }
}

interface MetricsPickerProps {
  form: SettingsForm;
  widget: Extract<Widget, { type: "metrics.grid" }>;
  index: number;
}

function MetricsPicker({
  form,
  widget,
  index,
}: MetricsPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const selected = new Set<MetricId>(widget.metrics);
  const toggle = (metric: MetricId, checked: boolean): void => {
    // The server requires 1..4 unique metrics; keep at least one selected so a
    // stray click cannot make the document unpublishable.
    const next = METRIC_IDS.filter((candidate) =>
      candidate === metric ? checked : selected.has(candidate),
    );
    if (next.length === 0) {
      return;
    }
    form.setValue(`surface.widgets.${index}.metrics`, [...next], {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  return (
    <fieldset className="settings-field-wide">
      <legend>{t("settings.editor.surface.metrics")}</legend>
      {METRIC_IDS.map((metric) => (
        <label className="settings-checkbox-field" key={metric}>
          <input
            type="checkbox"
            checked={selected.has(metric)}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              toggle(metric, event.target.checked)
            }
          />
          <span>{metric}</span>
        </label>
      ))}
    </fieldset>
  );
}
