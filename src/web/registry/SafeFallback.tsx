import { useI18n, type MessageKey } from "../i18n";
import { Card, Stack } from "../design-system";
import type { RegistryFallbackReason } from "./types";

export interface SafeFallbackProps {
  readonly id: string;
  readonly reason: RegistryFallbackReason;
  readonly requestedType?: string;
}

const FALLBACK_COPY_KEYS: Readonly<Record<RegistryFallbackReason, MessageKey>> =
  {
    "dashboard.invalid": "registry.safeFallback.dashboardInvalid",
    "dashboard.schema-version": "registry.safeFallback.dashboardSchemaVersion",
    "component.unknown-type": "registry.safeFallback.componentUnknownType",
    "component.invalid-props": "registry.safeFallback.componentInvalidProps",
    "component.schema-version": "registry.safeFallback.componentSchemaVersion",
    "component.missing-capability":
      "registry.safeFallback.componentMissingCapability",
    "component.render-error": "registry.safeFallback.componentRenderError",
  };

export function SafeFallback({ id, reason, requestedType }: SafeFallbackProps) {
  const { t } = useI18n();
  const headingId = `${id}-fallback-heading`;

  return (
    <Card
      className="muses-safe-fallback"
      headingId={headingId}
      title={t("registry.safeFallback.title")}
    >
      <Stack gap="var(--muses-space-2)">
        <p role="status">{t(FALLBACK_COPY_KEYS[reason])}</p>
        {requestedType !== undefined && (
          <code className="muses-safe-fallback__code">
            {t("registry.safeFallback.requested", { type: requestedType })}
          </code>
        )}
        <code className="muses-safe-fallback__code">
          {t("registry.safeFallback.reason", { reason })}
        </code>
      </Stack>
    </Card>
  );
}
