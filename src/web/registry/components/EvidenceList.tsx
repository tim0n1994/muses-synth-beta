import { useI18n } from "../../i18n";
import { Badge, Card, Stack } from "../../design-system";
import type { EvidenceListProps } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

function weightTone(weight: number): "positive" | "warning" | "neutral" {
  if (weight > 0.1) return "positive";
  if (weight < -0.1) return "warning";
  return "neutral";
}

export function EvidenceList({ id, props }: RegistryRenderEnvelope) {
  const { t } = useI18n();
  const value = props as EvidenceListProps;
  const headingId = `${id}-heading`;

  return (
    <Card
      headingId={headingId}
      title={value.title ?? t("registry.evidenceList.title")}
    >
      {value.evidence.length === 0 ? (
        <p className="muses-muted">{t("registry.evidenceList.empty")}</p>
      ) : (
        <ul className="muses-evidence-list">
          {value.evidence.map((item) => (
            <li className="muses-evidence-item" key={item.id}>
              <Stack gap="var(--muses-space-2)">
                <div className="muses-inline">
                  <strong>{item.label}</strong>
                  <Badge tone={weightTone(item.weight)}>
                    {item.weight.toFixed(2)}
                  </Badge>
                </div>
                <span className="muses-evidence-item__meta">
                  {item.source}
                  {item.observedAt === undefined ? "" : ` · ${item.observedAt}`}
                </span>
                {item.explanation !== undefined && (
                  <span>{item.explanation}</span>
                )}
              </Stack>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
