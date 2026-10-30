import { useI18n } from "../../i18n";
import {
  widgetDefinition,
  type SettingsPreview,
  type SettingsRelease,
} from "../model/document";

interface PreviewPanelProps {
  preview: SettingsPreview;
  published: SettingsRelease;
  onClose: () => void;
}

export function PreviewPanel({
  preview,
  published,
  onClose,
}: PreviewPanelProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section
      className="settings-preview"
      aria-labelledby="draft-preview-heading"
    >
      <div className="settings-preview-banner">
        <div>
          <span className="settings-badge settings-badge-draft">
            {t("settings.preview.draftBadge")}
          </span>
          <h2 id="draft-preview-heading">
            {t("settings.preview.title", {
              releaseNumber: published.releaseNumber,
            })}
          </h2>
          <p>
            {t("settings.preview.body", {
              releaseNumber: published.releaseNumber,
            })}
          </p>
        </div>
        <button
          type="button"
          className="settings-button settings-button-secondary"
          onClick={onClose}
        >
          {t("settings.preview.close")}
        </button>
      </div>

      <div className="settings-callout settings-callout-success">
        {t("settings.preview.validationPassed")}
      </div>

      {preview.changed ? (
        <div>
          <h3>
            {t("settings.preview.changedPaths", {
              count: preview.changedPaths.length,
            })}
          </h3>
          <ul className="settings-diff-list">
            {preview.changedPaths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="settings-empty-state">
          {t("settings.preview.identical")}
        </div>
      )}

      <div className="settings-preview-grid">
        {preview.document.surface.widgets.map((widget, index) => (
          <article key={widget.id} className="settings-preview-component">
            <span className="dashboard-order">{index + 1}</span>
            <div>
              <strong>{t(widgetDefinition(widget.type).label)}</strong>
              <small>{widget.id}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
