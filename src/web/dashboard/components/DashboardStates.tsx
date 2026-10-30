import type { ReactNode } from "react";

import { formatDashboardError } from "../api";
import { useI18n } from "../../i18n";
import type { DashboardError, DashboardViewStatus } from "../types";

interface DashboardStatesProps {
  readonly status: DashboardViewStatus;
  readonly error: DashboardError | null;
  readonly onRetry: () => void;
}

export function DashboardSkeleton(): ReactNode {
  const { t } = useI18n();
  return (
    <div
      className="muses-dashboard__skeleton"
      aria-label={t("dashboard.states.skeletonAria")}
      aria-busy="true"
    >
      <div className="muses-dashboard__skeleton-hero" />
      <div className="muses-dashboard__skeleton-grid">
        <div />
        <div />
        <div />
        <div />
      </div>
      <span className="muses-dashboard__sr-only">
        {t("dashboard.states.skeletonSr")}
      </span>
    </div>
  );
}

export function DashboardBlockingState(props: DashboardStatesProps): ReactNode {
  const { t } = useI18n();
  if (props.status === "loading") {
    return <DashboardSkeleton />;
  }

  const disconnected = props.status === "disconnected";
  const title = disconnected
    ? t("dashboard.states.disconnectedTitle")
    : t("dashboard.states.errorTitle");
  const detail = disconnected
    ? t("dashboard.states.disconnectedDetail")
    : formatDashboardError(t, props.error) ||
      t("dashboard.states.unreadableDetail");

  return (
    <section
      className="muses-dashboard__blocking-state"
      role="alert"
      aria-labelledby="dashboard-error-title"
    >
      <div className="muses-dashboard__status-mark" aria-hidden="true">
        {disconnected ? "↯" : "!"}
      </div>
      <p className="muses-dashboard__eyebrow">
        {disconnected
          ? t("dashboard.states.connection")
          : t("dashboard.states.serverResponse")}
      </p>
      <h2 id="dashboard-error-title">{title}</h2>
      <p>{detail}</p>
      <button
        className="muses-dashboard__button"
        type="button"
        onClick={props.onRetry}
      >
        {t("dashboard.states.retryConnection")}
      </button>
    </section>
  );
}

export function DashboardEmptyState(): ReactNode {
  const { t } = useI18n();
  return (
    <section
      className="muses-dashboard__empty"
      aria-labelledby="dashboard-empty-title"
    >
      <p className="muses-dashboard__eyebrow">
        {t("dashboard.states.emptyEyebrow")}
      </p>
      <h2 id="dashboard-empty-title">{t("dashboard.states.emptyTitle")}</h2>
      <p>{t("dashboard.states.emptyBody")}</p>
    </section>
  );
}

interface StaleBannerProps {
  readonly error: DashboardError | null;
  readonly onRetry: () => void;
}

export function StaleBanner(props: StaleBannerProps): ReactNode {
  const { t } = useI18n();
  return (
    <aside className="muses-dashboard__banner" role="status" aria-live="polite">
      <div>
        <strong>{t("dashboard.states.staleTitle")}</strong>
        <span>
          {props.error === null
            ? t("dashboard.states.staleDefault")
            : formatDashboardError(t, props.error)}
        </span>
      </div>
      <button
        className="muses-dashboard__button muses-dashboard__button--compact"
        type="button"
        onClick={props.onRetry}
      >
        {t("common.retry")}
      </button>
    </aside>
  );
}

interface InlineErrorProps {
  readonly message: string;
  readonly onDismiss?: (() => void) | undefined;
}

export function InlineError(props: InlineErrorProps): ReactNode {
  const { t } = useI18n();
  return (
    <div className="muses-dashboard__inline-error" role="alert">
      <span>{props.message}</span>
      {props.onDismiss === undefined ? null : (
        <button
          type="button"
          onClick={props.onDismiss}
          aria-label={t("dashboard.states.dismissError")}
        >
          ×
        </button>
      )}
    </div>
  );
}
