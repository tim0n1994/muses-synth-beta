import type { ChangeEvent, ReactNode } from "react";

import { LOCALE_INTL_TAGS, useI18n, type LanguageCode } from "../../i18n";

interface DashboardToolbarProps {
  readonly liveRefresh: boolean;
  readonly refreshIntervalMs: number;
  readonly isRefreshing: boolean;
  readonly lastSuccessfulRefreshAt: string | null;
  readonly onLiveRefreshChange: (enabled: boolean) => void;
  readonly onRefreshIntervalChange: (intervalMs: number) => void;
  readonly onRefresh: () => void;
}

const INTERVAL_OPTIONS = [5_000, 15_000, 30_000, 60_000] as const;

function formatLastUpdated(
  value: string | null,
  lang: LanguageCode,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (value === null) {
    return t("dashboard.toolbar.notYetRefreshed");
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat(LOCALE_INTL_TAGS[lang], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(parsed)
    : t("dashboard.toolbar.refreshTimeUnavailable");
}

export function DashboardToolbar(props: DashboardToolbarProps): ReactNode {
  const { t, lang } = useI18n();
  const handleInterval = (event: ChangeEvent<HTMLSelectElement>): void => {
    props.onRefreshIntervalChange(Number(event.target.value));
  };

  return (
    <section
      className="muses-dashboard__toolbar"
      aria-label={t("dashboard.toolbar.aria")}
    >
      <div className="muses-dashboard__toolbar-group">
        <label className="muses-dashboard__switch">
          <input
            type="checkbox"
            checked={props.liveRefresh}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              props.onLiveRefreshChange(event.target.checked)
            }
          />
          <span aria-hidden="true" className="muses-dashboard__switch-track" />
          <span>{t("dashboard.toolbar.liveRefresh")}</span>
        </label>
        <label className="muses-dashboard__select-label">
          <span>{t("dashboard.toolbar.interval")}</span>
          <select
            value={props.refreshIntervalMs}
            onChange={handleInterval}
            disabled={!props.liveRefresh}
          >
            {INTERVAL_OPTIONS.map((interval) => (
              <option key={interval} value={interval}>
                {interval / 1_000}s
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="muses-dashboard__toolbar-group muses-dashboard__toolbar-group--end">
        <p className="muses-dashboard__last-updated" aria-live="polite">
          {props.isRefreshing
            ? t("dashboard.toolbar.refreshingState")
            : t("dashboard.toolbar.lastRefresh", {
                time: formatLastUpdated(props.lastSuccessfulRefreshAt, lang, t),
              })}
        </p>
        <button
          className="muses-dashboard__button muses-dashboard__button--secondary"
          type="button"
          onClick={props.onRefresh}
          disabled={props.isRefreshing}
        >
          {props.isRefreshing
            ? t("dashboard.toolbar.refreshing")
            : t("dashboard.toolbar.refreshNow")}
        </button>
      </div>
    </section>
  );
}
