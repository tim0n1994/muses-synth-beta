import { useQuery } from "@tanstack/react-query";

import { useI18n } from "../i18n";
import { apiClient, ApiClientError } from "./api-client.js";

interface HealthResponse {
  readonly service: "muses";
  readonly status: "ok";
  readonly uptimeSeconds: number;
  readonly version: string;
}

function healthStatusMessage(
  error: unknown,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (error instanceof ApiClientError) {
    return `${error.code}: ${error.message}`;
  }
  return t("foundation.status.authorityUnavailable");
}

export function FoundationStatusPage(): React.JSX.Element {
  const { t } = useI18n();
  const health = useQuery({
    queryFn: () => apiClient.get<HealthResponse>("/api/health"),
    queryKey: ["foundation", "health"],
    refetchInterval: 30_000,
  });

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="foundation-title">
        <p className="eyebrow">{t("foundation.status.eyebrow")}</p>
        <h1 id="foundation-title">{t("foundation.status.title")}</h1>
        <p className="lede">{t("foundation.status.lede")}</p>
      </section>

      <section className="status-card" aria-live="polite">
        <div>
          <p className="status-label">
            {t("foundation.status.localAuthority")}
          </p>
          {health.isPending ? <p>{t("foundation.status.checking")}</p> : null}
          {health.isError ? (
            <p className="status-error">
              {healthStatusMessage(health.error, t)}
            </p>
          ) : null}
          {health.data === undefined ? null : (
            <p className="status-ok">
              {t("foundation.status.connected", {
                version: health.data.version,
                seconds: health.data.uptimeSeconds,
              })}
            </p>
          )}
        </div>
        <span
          aria-label={
            health.data === undefined
              ? t("foundation.status.notConnected")
              : t("foundation.status.connectedAria")
          }
          className={
            health.data === undefined
              ? "status-dot status-dot--idle"
              : "status-dot"
          }
          role="img"
        />
      </section>

      <aside className="security-note">
        {t("foundation.status.securityNote")}
      </aside>
    </main>
  );
}
