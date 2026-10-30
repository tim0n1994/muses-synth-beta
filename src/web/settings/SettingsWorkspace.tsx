import { useEffect, useMemo, useRef, useState } from "react";
import { type FieldPath, type UseFormReturn, useForm } from "react-hook-form";

import {
  createTranslator,
  DEFAULT_LANGUAGE,
  I18nProvider,
  LOCALE_INTL_TAGS,
  resolveLocale,
  type LanguageCode,
  type MessageKey,
} from "../i18n";
import {
  createSettingsClient,
  type SettingsClient,
} from "./api/settingsClient";
import { PreviewPanel } from "./components/PreviewPanel";
import { ReleaseHistory } from "./components/ReleaseHistory";
import {
  ConflictDialog,
  PublishDialog,
  RollbackDialog,
} from "./components/SettingsDialogs";
import { SettingsForm } from "./components/SettingsForm";
import { useSettingsWorkspace } from "./hooks/useSettingsWorkspace";
import {
  cloneSettingsDocument,
  SETTINGS_SECTIONS,
  validateSettingsDocument,
  type FieldViolation,
  type SettingsDocument,
  type SettingsRelease,
  type SettingsSectionId,
} from "./model/document";
import "./settings.css";

const DEFAULT_CLIENT = createSettingsClient();

const SECTION_LABEL_KEYS: Record<
  SettingsSectionId,
  { label: MessageKey; description: MessageKey }
> = {
  appearance: {
    label: "settings.section.appearance.label",
    description: "settings.section.appearance.description",
  },
  belief: {
    label: "settings.section.belief.label",
    description: "settings.section.belief.description",
  },
  decision: {
    label: "settings.section.decision.label",
    description: "settings.section.decision.description",
  },
  signals: {
    label: "settings.section.signals.label",
    description: "settings.section.signals.description",
  },
  audio: {
    label: "settings.section.audio.label",
    description: "settings.section.audio.description",
  },
  privacy: {
    label: "settings.section.privacy.label",
    description: "settings.section.privacy.description",
  },
  llm: {
    label: "settings.section.llm.label",
    description: "settings.section.llm.description",
  },
  surface: {
    label: "settings.section.surface.label",
    description: "settings.section.surface.description",
  },
};

export interface SettingsWorkspaceProps {
  client?: SettingsClient;
}

export function SettingsWorkspace({
  client = DEFAULT_CLIENT,
}: SettingsWorkspaceProps): React.JSX.Element {
  const form = useForm<SettingsDocument>({
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("appearance");
  const [publishOpen, setPublishOpen] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<SettingsRelease | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const appliedRevision = useRef<number | null>(null);

  // The published release is the runtime authority; its language drives the
  // whole workspace until the user publishes a different one. English until
  // the first snapshot lands.
  const [lang, setLang] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const t = useMemo(() => createTranslator(lang), [lang]);
  const workspace = useSettingsWorkspace(client, t);
  const snapshot = workspace.snapshot;

  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the language published in the external server snapshot.
    setLang(
      resolveLocale(snapshot.currentRelease.document.appearance.language),
    );
  }, [snapshot]);

  const isDirty = form.formState.isDirty;
  const isBusy = workspace.operation !== null;

  useEffect(() => {
    if (
      snapshot === null ||
      appliedRevision.current === snapshot.draft.revision
    ) {
      return;
    }
    form.reset(cloneSettingsDocument(snapshot.draft.document));
    appliedRevision.current = snapshot.draft.revision;
  }, [form, snapshot]);

  useEffect(() => {
    if (workspace.fieldViolations === undefined) {
      return;
    }
    applyViolations(form, workspace.fieldViolations);
  }, [form, workspace.fieldViolations]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!form.formState.isDirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [form.formState.isDirty]);

  // eslint-disable-next-line react-hooks/refs -- the callback reads the revision ref only after a user submits the form.
  const save = form.handleSubmit(async (document) => {
    const preflight = validateSettingsDocument(document);
    if (preflight.length > 0) {
      applyViolations(form, preflight);
      setNotice(t("settings.workspace.preflightNotice"));
      focusViolation(form, preflight[0], setActiveSection);
      return;
    }
    const saved = await workspace.saveDraft(
      document,
      t("settings.workspace.saveReason", { section: activeSection }),
    );
    if (saved !== null) {
      form.reset(cloneSettingsDocument(saved.document));
      appliedRevision.current = saved.revision;
      setNotice(
        t("settings.workspace.draftSavedNotice", {
          revision: saved.revision,
        }),
      );
    }
  });

  const handlePreview = async (): Promise<void> => {
    if (snapshot === null) {
      return;
    }
    const result = await workspace.previewDraft(snapshot.draft.document);
    if (result !== null) {
      setNotice(summarizeChangedPaths(result.changedPaths, t));
    }
  };

  const handlePublish = async (reason: string): Promise<void> => {
    const published = await workspace.publishDraft(reason);
    setPublishOpen(false);
    if (published) {
      setNotice(t("settings.workspace.publishedNotice"));
    }
  };

  const handleRollback = async (release: SettingsRelease): Promise<void> => {
    const rolledBack = await workspace.rollbackRelease(
      release.id,
      t("settings.workspace.rollbackReason", {
        releaseNumber: release.releaseNumber,
      }),
    );
    setRollbackTarget(null);
    if (rolledBack) {
      setNotice(
        t("settings.workspace.rolledBackNotice", {
          releaseNumber: release.releaseNumber,
        }),
      );
    }
  };

  const handleReloadAfterConflict = (): void => {
    workspace.dismissConflict();
    appliedRevision.current = null;
    void workspace.reload();
    setNotice(t("settings.workspace.reloadedNotice"));
  };

  const previewCurrent =
    snapshot !== null &&
    workspace.preview !== null &&
    workspace.preview.checksum === snapshot.draft.checksum;
  const publishReady = !isDirty && previewCurrent;

  const localeTag = LOCALE_INTL_TAGS[lang];

  return (
    <I18nProvider lang={lang}>
      {snapshot === null ? (
        <main className="settings-workspace">
          <div className="settings-blocking-state" role="alert">
            <h1>
              {workspace.error === null
                ? t("settings.workspace.loading")
                : t("settings.workspace.unavailable")}
            </h1>
            {workspace.error === null ? null : <p>{workspace.error}</p>}
            {workspace.error === null ? null : (
              <button
                type="button"
                className="settings-button settings-button-primary"
                onClick={() => void workspace.reload()}
              >
                {t("common.retry")}
              </button>
            )}
          </div>
        </main>
      ) : (
        <main className="settings-workspace">
          <header className="settings-topbar">
            <div>
              <h1>{t("settings.workspace.title")}</h1>
              <p>{t("settings.workspace.subtitle")}</p>
            </div>
            <div className="settings-save-state" aria-live="polite">
              <span
                className={
                  isDirty ? "settings-unsaved-dot" : "settings-saved-dot"
                }
                aria-hidden="true"
              />
              {isDirty
                ? t("settings.workspace.unsavedEdits")
                : t("settings.workspace.draftSaved")}
            </div>
          </header>

          <div
            className="settings-version-strip"
            aria-label={t("settings.workspace.versionsAria")}
          >
            <div className="settings-version-card settings-version-draft">
              <span className="settings-badge settings-badge-draft">
                {t("settings.workspace.draftBadge")}
              </span>
              <strong>
                {t("settings.workspace.revisionLabel", {
                  revision: snapshot.draft.revision,
                })}
              </strong>
              <time dateTime={snapshot.draft.updatedAt}>
                {new Date(snapshot.draft.updatedAt).toLocaleString(localeTag)}
              </time>
            </div>
            <div className="settings-version-card settings-version-published">
              <span className="settings-badge settings-badge-published">
                {t("settings.workspace.publishedBadge")}
              </span>
              <strong>r{snapshot.currentRelease.releaseNumber}</strong>
              <time dateTime={snapshot.currentRelease.publishedAt}>
                {new Date(snapshot.currentRelease.publishedAt).toLocaleString(
                  localeTag,
                )}
              </time>
            </div>
          </div>

          {workspace.error === null ? null : (
            <div className="settings-error-banner" role="alert">
              <div>
                <strong>{t("settings.workspace.errorTitle")}</strong>
                <span>{workspace.error}</span>
              </div>
              <button type="button" onClick={workspace.clearError}>
                {t("common.dismiss")}
              </button>
            </div>
          )}

          {notice === null ? null : (
            <div className="settings-notice-banner" role="status">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label={t("settings.workspace.dismissNoticeAria")}
              >
                ×
              </button>
            </div>
          )}

          <div className="settings-layout">
            <nav
              className="settings-navigation"
              aria-label={t("settings.workspace.navigationAria")}
            >
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section}
                  type="button"
                  className={
                    section === activeSection ? "is-active" : undefined
                  }
                  aria-current={section === activeSection ? "page" : undefined}
                  onClick={() => setActiveSection(section)}
                >
                  <strong>{t(SECTION_LABEL_KEYS[section].label)}</strong>
                  <span>{t(SECTION_LABEL_KEYS[section].description)}</span>
                </button>
              ))}
            </nav>

            <div className="settings-main-column">
              <form
                onSubmit={(event: React.FormEvent<HTMLFormElement>) =>
                  void save(event)
                }
                noValidate
              >
                <SettingsForm form={form} activeSection={activeSection} />
                <div
                  className="settings-action-bar"
                  aria-label={t("settings.workspace.draftActionsAria")}
                >
                  <div>
                    <button
                      type="submit"
                      className="settings-button settings-button-primary"
                      disabled={!isDirty || isBusy}
                    >
                      {workspace.operation === "save"
                        ? t("settings.workspace.saving")
                        : t("settings.workspace.saveDraft")}
                    </button>
                    <button
                      type="button"
                      className="settings-button settings-button-secondary"
                      disabled={isDirty || isBusy}
                      onClick={() => void handlePreview()}
                      title={
                        isDirty
                          ? t("settings.workspace.saveBeforePreviewTitle")
                          : undefined
                      }
                    >
                      {workspace.operation === "preview"
                        ? t("settings.workspace.generating")
                        : t("settings.workspace.previewDraft")}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="settings-button settings-button-publish"
                    disabled={!publishReady || isBusy}
                    onClick={() => setPublishOpen(true)}
                    title={
                      publishReady
                        ? undefined
                        : t("settings.workspace.savePreviewFirstTitle")
                    }
                  >
                    {t("common.publish")}
                  </button>
                </div>
              </form>

              {workspace.preview === null ? null : (
                <PreviewPanel
                  preview={workspace.preview}
                  published={snapshot.currentRelease}
                  onClose={workspace.clearPreview}
                />
              )}
            </div>

            <aside className="settings-side-column">
              <section
                className="settings-panel"
                aria-labelledby="release-readiness-heading"
              >
                <div className="settings-panel-heading">
                  <div>
                    <h2 id="release-readiness-heading">
                      {t("settings.workspace.readinessTitle")}
                    </h2>
                    <p>{t("settings.workspace.readinessDescription")}</p>
                  </div>
                </div>
                <dl className="settings-readiness-list">
                  <div>
                    <dt>{t("settings.workspace.readinessSavedDraft")}</dt>
                    <dd>{isDirty ? t("common.no") : t("common.yes")}</dd>
                  </div>
                  <div>
                    <dt>{t("settings.workspace.readinessPreviewCurrent")}</dt>
                    <dd>{previewCurrent ? t("common.yes") : t("common.no")}</dd>
                  </div>
                  <div>
                    <dt>{t("settings.workspace.readinessChanges")}</dt>
                    <dd>
                      {workspace.preview === null
                        ? t("settings.workspace.readinessUnknown")
                        : String(workspace.preview.changedPaths.length)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("settings.workspace.readinessPublishReady")}</dt>
                    <dd>{publishReady ? t("common.yes") : t("common.no")}</dd>
                  </div>
                </dl>
              </section>
              <ReleaseHistory
                releases={workspace.releases}
                currentReleaseId={snapshot.currentRelease.id}
                onRollback={setRollbackTarget}
              />
            </aside>
          </div>

          <PublishDialog
            open={publishOpen}
            busy={workspace.operation === "publish"}
            diffSummary={workspace.preview?.changedPaths ?? []}
            onCancel={() => setPublishOpen(false)}
            onConfirm={(reason) => void handlePublish(reason)}
          />
          <RollbackDialog
            release={rollbackTarget}
            busy={workspace.operation === "rollback"}
            onCancel={() => setRollbackTarget(null)}
            onConfirm={() => {
              if (rollbackTarget !== null) {
                void handleRollback(rollbackTarget);
              }
            }}
          />
          <ConflictDialog
            conflict={workspace.conflict}
            onReload={handleReloadAfterConflict}
            onDismiss={workspace.dismissConflict}
          />
        </main>
      )}
    </I18nProvider>
  );
}

/**
 * Human-readable summary of what a publish would change, derived from the
 * server's own `changedPaths` so the dialog never disagrees with the release.
 */
function summarizeChangedPaths(
  changedPaths: readonly string[],
  t: ReturnType<typeof createTranslator>,
): string {
  if (changedPaths.length === 0) {
    return t("settings.workspace.previewNoChanges");
  }
  const sections = new Set(
    changedPaths.map((path) => path.replace(/^\//, "").split("/")[0] ?? path),
  );
  return t("settings.workspace.previewChangesSummary", {
    count: changedPaths.length,
    sections: [...sections].join(", "),
  });
}

function applyViolations(
  form: UseFormReturn<SettingsDocument>,
  violations: FieldViolation[],
): void {
  for (const violation of violations) {
    if (violation.path.length === 0) {
      continue;
    }
    form.setError(violation.path as FieldPath<SettingsDocument>, {
      type: `server.${violation.code}`,
      message: violation.message,
    });
  }
}

function focusViolation(
  form: UseFormReturn<SettingsDocument>,
  violation: FieldViolation | undefined,
  setActiveSection: (section: SettingsSectionId) => void,
): void {
  if (violation === undefined) {
    return;
  }
  const section = violation.path.split(".")[0];
  if (
    section !== undefined &&
    (SETTINGS_SECTIONS as readonly string[]).includes(section)
  ) {
    setActiveSection(section as SettingsSectionId);
  }
  queueMicrotask(() =>
    form.setFocus(violation.path as FieldPath<SettingsDocument>),
  );
}
