import { LOCALE_INTL_TAGS, useI18n } from "../../i18n";
import type { SettingsRelease } from "../model/document";

interface ReleaseHistoryProps {
  releases: SettingsRelease[];
  currentReleaseId: string;
  onRollback: (release: SettingsRelease) => void;
}

export function ReleaseHistory({
  releases,
  currentReleaseId,
  onRollback,
}: ReleaseHistoryProps): React.JSX.Element {
  const { t, lang } = useI18n();
  return (
    <section
      className="settings-panel"
      aria-labelledby="release-history-heading"
    >
      <div className="settings-panel-heading">
        <div>
          <h2 id="release-history-heading">{t("settings.release.title")}</h2>
          <p>{t("settings.release.description")}</p>
        </div>
      </div>
      {releases.length === 0 ? (
        <div className="settings-empty-state">
          {t("settings.release.empty")}
        </div>
      ) : (
        <ol className="settings-release-list">
          {releases.map((release) => {
            const isCurrent = release.id === currentReleaseId;
            return (
              <li key={release.id}>
                <div className="settings-release-header">
                  <div>
                    <strong>r{release.releaseNumber}</strong>
                    {isCurrent ? (
                      <span className="settings-badge settings-badge-published">
                        {t("settings.release.published")}
                      </span>
                    ) : null}
                    {release.rollbackOfReleaseId === null ? null : (
                      <span className="settings-badge">
                        {t("settings.release.rollbackBadge")}
                      </span>
                    )}
                  </div>
                  <time dateTime={release.publishedAt}>
                    {new Date(release.publishedAt).toLocaleString(
                      LOCALE_INTL_TAGS[lang],
                    )}
                  </time>
                </div>
                <p className="settings-release-author">
                  {t("settings.release.publishedBy", { actor: release.actor })}
                </p>
                <ul className="settings-diff-list">
                  <li>{release.reason}</li>
                  <li>
                    <code>{release.checksum.slice(0, 12)}</code>
                  </li>
                </ul>
                <button
                  type="button"
                  className="settings-button settings-button-secondary settings-button-small"
                  disabled={isCurrent}
                  onClick={() => onRollback(release)}
                >
                  {isCurrent
                    ? t("settings.release.current")
                    : t("settings.release.rollBackToThis")}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
