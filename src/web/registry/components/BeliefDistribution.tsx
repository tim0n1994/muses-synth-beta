import { useI18n, type MessageKey } from "../../i18n";
import { Badge, Card, Progress } from "../../design-system";
import type { BeliefDistributionProps, BeliefFactor } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

function directionKey(direction: BeliefFactor["direction"]): MessageKey {
  if (direction > 0) return "registry.beliefDistribution.supports";
  if (direction < 0) return "registry.beliefDistribution.opposes";
  return "registry.beliefDistribution.neutral";
}

export function BeliefDistribution({ id, props }: RegistryRenderEnvelope) {
  const { t } = useI18n();
  const value = props as BeliefDistributionProps;
  const headingId = `${id}-heading`;

  return (
    <Card
      headingId={headingId}
      title={value.title ?? t("registry.beliefDistribution.title")}
    >
      <ul className="muses-belief-list">
        {value.factors.map((factor) => {
          const percent = Math.round(factor.probability * 100);
          return (
            <li className="muses-belief-row" key={factor.id}>
              <span>{factor.label}</span>
              <Badge
                tone={
                  factor.direction > 0
                    ? "positive"
                    : factor.direction < 0
                      ? "warning"
                      : "neutral"
                }
              >
                {t(directionKey(factor.direction))}
              </Badge>
              <Progress
                label={t("registry.beliefDistribution.probabilityAria", {
                  label: factor.label,
                })}
                value={percent}
              />
              <span className="muses-belief-row__meta">
                {percent}% ·{" "}
                {t(
                  factor.evidenceCount === 1
                    ? "registry.beliefDistribution.evidenceItem"
                    : "registry.beliefDistribution.evidenceItems",
                  { count: factor.evidenceCount },
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
