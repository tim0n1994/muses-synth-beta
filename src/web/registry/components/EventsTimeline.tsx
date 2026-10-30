import { useI18n } from "../../i18n";
import { Badge, Card, Stack } from "../../design-system";
import type { EventsTimelineProps } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

export function EventsTimeline({ id, props }: RegistryRenderEnvelope) {
  const { t } = useI18n();
  const value = props as EventsTimelineProps;
  const headingId = `${id}-heading`;

  return (
    <Card
      headingId={headingId}
      title={value.title ?? t("registry.eventsTimeline.title")}
    >
      {value.events.length === 0 ? (
        <p className="muses-muted">{t("registry.eventsTimeline.empty")}</p>
      ) : (
        <ol className="muses-event-list">
          {value.events.map((event) => (
            <li className="muses-event-item" key={event.id}>
              <Stack gap="var(--muses-space-2)">
                <div className="muses-inline">
                  <strong>{event.title}</strong>
                  <Badge>{event.kind}</Badge>
                </div>
                <time className="muses-event-item__meta">
                  {event.occurredAt}
                </time>
                {event.summary !== undefined && <span>{event.summary}</span>}
              </Stack>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
