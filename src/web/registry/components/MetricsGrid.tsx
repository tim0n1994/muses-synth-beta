import { useI18n, type MessageKey } from "../../i18n";
import { Badge, Card } from "../../design-system";
import type { MetricsGridProps, MetricItem } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

function trendKey(trend: MetricItem["trend"]): MessageKey {
  switch (trend) {
    case "up":
      return "registry.metricsGrid.increasing";
    case "down":
      return "registry.metricsGrid.decreasing";
    case "flat":
      return "registry.metricsGrid.stable";
    case "unknown":
      return "registry.metricsGrid.unknownTrend";
  }
}

export function MetricsGrid({ id, props }: RegistryRenderEnvelope) {
  const { t } = useI18n();
  const value = props as MetricsGridProps;
  const headingId = `${id}-heading`;

  return (
    <Card
      headingId={headingId}
      title={value.title ?? t("registry.metricsGrid.title")}
    >
      <div className="muses-metrics-grid">
        {value.metrics.map((metric) => (
          <div className="muses-metric" key={metric.id}>
            <div className="muses-inline">
              <span>{metric.label}</span>
              <Badge>{t(trendKey(metric.trend))}</Badge>
            </div>
            <strong className="muses-metric__value">{metric.value}</strong>
            {metric.helpText !== undefined && (
              <small className="muses-muted">{metric.helpText}</small>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
