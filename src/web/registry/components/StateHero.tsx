import { describeBeliefState } from "../../../server/belief/vocabulary";
import { formatDateTime, useI18n } from "../../i18n";
import { Badge, Card, Progress, Stack } from "../../design-system";
import type { StateHeroProps } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

export function StateHero({ id, props }: RegistryRenderEnvelope) {
  const { t, lang } = useI18n();
  const value = props as StateHeroProps;
  const headingId = `${id}-heading`;
  const confidencePercent = Math.round(value.confidence * 100);
  const descriptor = describeBeliefState(value.status);

  return (
    <Card
      className="muses-state-hero"
      headingId={headingId}
      title={value.title ?? t("registry.stateHero.title")}
      trailing={
        <Badge tone={descriptor.tone}>
          {value.statusLabel ?? descriptor.label}
        </Badge>
      }
    >
      <Stack>
        <p className="muses-state-hero__summary">{value.summary}</p>
        {value.unknownReason === undefined ? null : (
          <p className="muses-muted">{value.unknownReason}</p>
        )}
        <div className="muses-confidence-row">
          <span>{t("registry.stateHero.beliefConfidence")}</span>
          <strong>{confidencePercent}%</strong>
          <Progress
            label={t("registry.stateHero.beliefConfidence")}
            value={confidencePercent}
          />
        </div>
        {value.updatedAt !== undefined && (
          <small className="muses-muted">
            {t("registry.stateHero.updated", {
              time: formatDateTime(value.updatedAt, lang),
            })}
          </small>
        )}
      </Stack>
    </Card>
  );
}
