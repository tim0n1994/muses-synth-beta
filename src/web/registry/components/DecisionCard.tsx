import { formatDateTime, useI18n } from "../../i18n";
import { Badge, Button, Card, Progress, Stack } from "../../design-system";
import type { DecisionCardProps } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

function decisionTone(
  decision: DecisionCardProps["decision"],
): "accent" | "warning" | "neutral" {
  if (decision === "NO_ACTION" || decision === "UNKNOWN") return "neutral";
  if (decision === "PAUSE_AUDIO") return "warning";
  return "accent";
}

export function DecisionCard({ id, props, runtime }: RegistryRenderEnvelope) {
  const { t, lang } = useI18n();
  const value = props as DecisionCardProps;
  const headingId = `${id}-heading`;
  const confidencePercent = Math.round(value.confidence * 100);

  const undo = () => {
    runtime.onAction?.({ componentId: id, name: "decision.undo" });
  };

  return (
    <Card
      className="muses-decision-card"
      data-decision={value.decision}
      headingId={headingId}
      title={value.title ?? t("registry.decisionCard.title")}
      trailing={
        <Badge tone={decisionTone(value.decision)}>{value.decision}</Badge>
      }
    >
      <Stack>
        <p>{value.rationale}</p>
        <div className="muses-confidence-row">
          <span>{t("registry.decisionCard.confidence")}</span>
          <strong>{confidencePercent}%</strong>
          <Progress
            label={t("registry.decisionCard.confidence")}
            value={confidencePercent}
          />
        </div>
        {value.expiresAt !== undefined && (
          <small className="muses-muted">
            {t("registry.decisionCard.expires", {
              time: formatDateTime(value.expiresAt, lang),
            })}
          </small>
        )}
        {value.reversible &&
          value.decision !== "NO_ACTION" &&
          value.decision !== "UNKNOWN" && (
            <div>
              <Button onClick={undo}>{t("registry.decisionCard.undo")}</Button>
            </div>
          )}
      </Stack>
    </Card>
  );
}
