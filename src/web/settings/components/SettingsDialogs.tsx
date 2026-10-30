import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import type { SettingsConflictError } from "../api/settingsClient";
import type { SettingsRelease } from "../model/document";

interface PublishDialogProps {
  open: boolean;
  busy: boolean;
  diffSummary: string[];
  onCancel: () => void;
  onConfirm: (summary: string) => void;
}

export function PublishDialog({
  open,
  busy,
  diffSummary,
  onCancel,
  onConfirm,
}: PublishDialogProps): React.JSX.Element | null {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [summary, setSummary] = useState("");

  useDialogFocus(open, headingRef);
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening starts a new publish confirmation session.
      setAcknowledged(false);
      setSummary(t("settings.dialog.publish.defaultSummary"));
    }
  }, [open, t]);

  if (!open) {
    return null;
  }

  return (
    <DialogFrame
      labelledBy="publish-dialog-title"
      onDismiss={busy ? undefined : onCancel}
    >
      <h2 ref={headingRef} tabIndex={-1} id="publish-dialog-title">
        {t("settings.dialog.publish.title")}
      </h2>
      <p id="publish-dialog-description">
        {t("settings.dialog.publish.description")}
      </p>
      <ul className="settings-diff-list">
        {diffSummary.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <label>
        <span>{t("settings.dialog.publish.summaryLabel")}</span>
        <input
          value={summary}
          maxLength={160}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setSummary(event.target.value)
          }
        />
      </label>
      <label className="settings-checkbox-field settings-confirm-checkbox">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setAcknowledged(event.target.checked)
          }
        />
        <span>{t("settings.dialog.publish.acknowledge")}</span>
      </label>
      <div className="settings-dialog-actions">
        <button
          type="button"
          className="settings-button settings-button-secondary"
          onClick={onCancel}
          disabled={busy}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="settings-button settings-button-primary"
          disabled={!acknowledged || summary.trim().length === 0 || busy}
          onClick={() => onConfirm(summary.trim())}
        >
          {busy ? t("settings.dialog.publish.publishing") : t("common.publish")}
        </button>
      </div>
    </DialogFrame>
  );
}

interface RollbackDialogProps {
  release: SettingsRelease | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (releaseId: string) => void;
}

/**
 * The confirmation phrase is the literal string `ROLLBACK` in every locale:
 * a deliberate speed bump, never localized (the callout text explains this in
 * each language).
 */
const ROLLBACK_PHRASE = "ROLLBACK";

export function RollbackDialog({
  release,
  busy,
  onCancel,
  onConfirm,
}: RollbackDialogProps): React.JSX.Element | null {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [phrase, setPhrase] = useState("");
  useDialogFocus(release !== null, headingRef);

  useEffect(() => {
    if (release !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- changing the release starts a new rollback confirmation.
      setPhrase("");
    }
  }, [release]);

  if (release === null) {
    return null;
  }

  return (
    <DialogFrame
      labelledBy="rollback-dialog-title"
      onDismiss={busy ? undefined : onCancel}
    >
      <h2 ref={headingRef} tabIndex={-1} id="rollback-dialog-title">
        {t("settings.dialog.rollback.title")}
      </h2>
      <p>
        {t("settings.dialog.rollback.body", {
          releaseNumber: release.releaseNumber,
        })}
      </p>
      <div className="settings-callout settings-callout-danger">
        {t("settings.dialog.rollback.warning")}
      </div>
      <label>
        <span>{t("settings.dialog.rollback.phraseLabel")}</span>
        <input
          value={phrase}
          autoComplete="off"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setPhrase(event.target.value)
          }
          aria-label={t("settings.dialog.rollback.phraseLabel")}
        />
      </label>
      <div className="settings-dialog-actions">
        <button
          type="button"
          className="settings-button settings-button-secondary"
          onClick={onCancel}
          disabled={busy}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="settings-button settings-button-danger"
          disabled={phrase !== ROLLBACK_PHRASE || busy}
          onClick={() => onConfirm(release.id)}
        >
          {busy
            ? t("settings.dialog.rollback.rollingBack")
            : t("settings.dialog.rollback.rollBack")}
        </button>
      </div>
    </DialogFrame>
  );
}

interface ConflictDialogProps {
  conflict: SettingsConflictError | null;
  onReload: () => void;
  onDismiss: () => void;
}

/**
 * The server rejected a write because another writer moved the draft or
 * release on. For a server-authoritative document the only safe resolutions
 * are "take the server's version" or "leave it alone" — a client-side merge
 * would be guessing at a document the server already validated.
 */
export function ConflictDialog({
  conflict,
  onReload,
  onDismiss,
}: ConflictDialogProps): React.JSX.Element | null {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useDialogFocus(conflict !== null, headingRef);

  if (conflict === null) {
    return null;
  }

  return (
    <DialogFrame labelledBy="conflict-dialog-title" onDismiss={onDismiss}>
      <h2 ref={headingRef} tabIndex={-1} id="conflict-dialog-title">
        {t("settings.dialog.conflict.title")}
      </h2>
      <p>
        {t("settings.dialog.conflict.body", {
          field: conflict.field,
          expected: String(conflict.expected),
          actual: String(conflict.actual),
        })}
      </p>
      <div className="settings-conflict-options">
        <button
          type="button"
          className="settings-choice-card"
          onClick={onReload}
        >
          <strong>{t("settings.dialog.conflict.reloadTitle")}</strong>
          <span>{t("settings.dialog.conflict.reloadDescription")}</span>
        </button>
        <button
          type="button"
          className="settings-choice-card"
          onClick={onDismiss}
        >
          <strong>{t("settings.dialog.conflict.keepTitle")}</strong>
          <span>{t("settings.dialog.conflict.keepDescription")}</span>
        </button>
      </div>
    </DialogFrame>
  );
}

interface DialogFrameProps {
  children: React.ReactNode;
  labelledBy: string;
  onDismiss?: (() => void) | undefined;
}

function DialogFrame({
  children,
  labelledBy,
  onDismiss,
}: DialogFrameProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (onDismiss === undefined) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  const handleDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="settings-dialog-backdrop"
      role="presentation"
      onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
          onDismiss?.();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

function useDialogFocus(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    queueMicrotask(() => ref.current?.focus());
    return () => previous?.focus();
  }, [open, ref]);
}
