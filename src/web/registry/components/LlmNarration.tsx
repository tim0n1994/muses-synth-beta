import { useI18n } from "../../i18n";
import { Badge, Button, Card, Stack } from "../../design-system";
import type { LlmNarrationProps } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

/**
 * Optional, user-triggered AI narration panel.
 *
 * Rendering discipline (hard boundary): model output is untrusted text. It
 * only ever enters a React text node — no `dangerouslySetInnerHTML`, no
 * markdown, no linkification — and is truncated again here even though the
 * API client already clamps it.
 */

const TEXT_LIMIT = 4_000;
const SUMMARY_WINDOW_MINUTES = 60;

export function LlmNarration({ id, props, runtime }: RegistryRenderEnvelope) {
  const { t } = useI18n();
  const value = props as LlmNarrationProps;
  const llm = runtime.llm;
  // Double insurance next to the surface layer: without capability data or
  // without the generation runtime mounted, the optional enhancement is
  // invisible — never an error.
  if (!value.available || llm === undefined) {
    return null;
  }

  const headingId = `${id}-heading`;
  const cooldown = value.reason === "cooldown";
  const loading =
    llm.narration.status === "loading" || llm.summary.status === "loading";
  const buttonsDisabled = cooldown || loading;
  // The panel shows one generation at a time. Narration is the primary
  // action, so its non-idle state wins; a summary shows while narration has
  // never run (or is back to idle after a superseded request).
  const active = llm.narration.status !== "idle" ? llm.narration : llm.summary;

  const request = (name: "llm.narrate" | "llm.summarize"): void => {
    runtime.onAction?.({
      componentId: id,
      name,
      ...(name === "llm.summarize"
        ? { payload: { windowMinutes: SUMMARY_WINDOW_MINUTES } }
        : {}),
    });
  };

  return (
    <Card headingId={headingId} title={t("registry.llmNarration.title")}>
      <div
        className="muses-llm-narration"
        aria-busy={loading}
        data-testid="llm-narration-panel"
      >
        <Stack gap="var(--muses-space-2)">
          <p className="muses-muted" data-testid="llm-narration-disclosure">
            {t("registry.llmNarration.disclosure")}
          </p>
          {cooldown ? (
            <p data-testid="llm-narration-cooldown">
              <Badge>{t("registry.llmNarration.cooldown")}</Badge>{" "}
              <span>{t("registry.llmNarration.cooldownDetail")}</span>
            </p>
          ) : null}
          {loading ? (
            <p role="status" data-testid="llm-narration-loading">
              {t("registry.llmNarration.generating")}
            </p>
          ) : null}
          {active.status === "error" && active.error !== null ? (
            <p
              className="muses-llm-narration__error"
              data-testid="llm-narration-error"
            >
              {active.error}
            </p>
          ) : null}
          {active.status === "done" && active.text !== null ? (
            <p
              className="muses-llm-narration__text"
              data-testid="llm-narration-text"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {active.text.slice(0, TEXT_LIMIT)}
            </p>
          ) : null}
          {active.status === "done" &&
          active.text !== null &&
          value.model !== "hidden" ? (
            <small className="muses-muted" data-testid="llm-narration-model">
              {t("registry.llmNarration.generatedBy", {
                model: active.model ?? t("registry.llmNarration.unknownModel"),
                time:
                  active.generatedAt ?? t("registry.llmNarration.unknownTime"),
              })}
            </small>
          ) : null}
          <div className="muses-inline">
            <Button
              data-testid="llm-narration-generate"
              disabled={buttonsDisabled}
              onClick={() => request("llm.narrate")}
            >
              {t("registry.llmNarration.explain")}
            </Button>
            <Button
              data-testid="llm-narration-summarize"
              disabled={buttonsDisabled}
              onClick={() => request("llm.summarize")}
            >
              {t("registry.llmNarration.summarize")}
            </Button>
            {active.status === "error" ? (
              <Button
                data-testid="llm-narration-retry"
                disabled={buttonsDisabled}
                onClick={() =>
                  request(
                    active === llm.summary ? "llm.summarize" : "llm.narrate",
                  )
                }
              >
                {t("registry.llmNarration.retry")}
              </Button>
            ) : null}
          </div>
        </Stack>
      </div>
    </Card>
  );
}
