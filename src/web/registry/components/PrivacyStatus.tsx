import { useI18n } from "../../i18n";
import { Badge, Card } from "../../design-system";
import type { PrivacyStatusProps } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

export function PrivacyStatus({ id, props }: RegistryRenderEnvelope) {
  const { t } = useI18n();
  const value = props as PrivacyStatusProps;
  const headingId = `${id}-heading`;

  return (
    <Card
      headingId={headingId}
      title={value.title ?? t("registry.privacyStatus.title")}
      trailing={
        <Badge tone={value.localOnly ? "positive" : "danger"}>
          {value.localOnly
            ? t("registry.privacyStatus.localOnly")
            : t("registry.privacyStatus.notLocal")}
        </Badge>
      }
    >
      <dl className="muses-privacy-list">
        {value.retention !== "hidden" && (
          <>
            <dt>{t("registry.privacyStatus.retention")}</dt>
            <dd>{value.retention}</dd>
          </>
        )}
        {value.lastExportAt !== undefined && (
          <>
            <dt>{t("registry.privacyStatus.lastExport")}</dt>
            <dd>{value.lastExportAt}</dd>
          </>
        )}
      </dl>
    </Card>
  );
}
