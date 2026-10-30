import { useCallback, useEffect, useState } from "react";

import type { Translator } from "../../i18n";
import {
  SettingsApiError,
  SettingsConflictError,
  type SettingsClient,
} from "../api/settingsClient";
import type {
  FieldViolation,
  SettingsDocument,
  SettingsDraft,
  SettingsPreview,
  SettingsRelease,
  SettingsSnapshot,
} from "../model/document";

export type SettingsOperation =
  "load" | "save" | "preview" | "publish" | "rollback" | null;

export interface SettingsWorkspaceState {
  snapshot: SettingsSnapshot | null;
  releases: SettingsRelease[];
  preview: SettingsPreview | null;
  /**
   * Set when the server rejects a write because another writer moved the draft
   * or release forward. The only safe resolution for a server-authoritative
   * document is to reload; the workspace offers that rather than merging.
   */
  conflict: SettingsConflictError | null;
  operation: SettingsOperation;
  error: string | null;
  fieldViolations: FieldViolation[] | undefined;
  reload: () => Promise<void>;
  saveDraft: (
    document: SettingsDocument,
    reason: string,
  ) => Promise<SettingsDraft | null>;
  previewDraft: (document: SettingsDocument) => Promise<SettingsPreview | null>;
  publishDraft: (reason: string) => Promise<boolean>;
  rollbackRelease: (releaseId: string, reason: string) => Promise<boolean>;
  clearError: () => void;
  clearPreview: () => void;
  dismissConflict: () => void;
}

const ACTOR = "settings-workspace";
const RELEASE_LIMIT = 20;

export function useSettingsWorkspace(
  client: SettingsClient,
  t: Translator,
): SettingsWorkspaceState {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [releases, setReleases] = useState<SettingsRelease[]>([]);
  const [preview, setPreview] = useState<SettingsPreview | null>(null);
  const [conflict, setConflict] = useState<SettingsConflictError | null>(null);
  const [operation, setOperation] = useState<SettingsOperation>("load");
  const [error, setError] = useState<string | null>(null);
  const [fieldViolations, setFieldViolations] = useState<
    FieldViolation[] | undefined
  >();

  const clearFailure = useCallback((): void => {
    setError(null);
    setFieldViolations(undefined);
  }, []);

  const captureFailure = useCallback(
    (cause: unknown): void => {
      if (cause instanceof SettingsConflictError) {
        setConflict(cause);
        setError(cause.message);
        return;
      }
      if (cause instanceof SettingsApiError) {
        setError(cause.message);
        setFieldViolations(cause.violations);
        return;
      }
      setError(
        cause instanceof Error
          ? cause.message
          : t("settings.workspace.serverUnreachable"),
      );
    },
    [t],
  );

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setOperation("load");
      clearFailure();
      try {
        const [nextSnapshot, nextReleases] = await Promise.all([
          client.getSnapshot(signal),
          client.getReleases(RELEASE_LIMIT, signal),
        ]);
        setSnapshot(nextSnapshot);
        setReleases(nextReleases);
        setConflict(null);
        setPreview(null);
      } catch (cause: unknown) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          return;
        }
        captureFailure(cause);
      } finally {
        if (signal?.aborted !== true) {
          setOperation(null);
        }
      }
    },
    [captureFailure, clearFailure, client],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this is the hook's initial external-server load.
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const reload = useCallback((): Promise<void> => load(), [load]);

  const saveDraft = useCallback(
    async (
      document: SettingsDocument,
      reason: string,
    ): Promise<SettingsDraft | null> => {
      if (snapshot === null) {
        return null;
      }
      setOperation("save");
      clearFailure();
      try {
        const draft = await client.saveDraft({
          actor: ACTOR,
          reason,
          expectedRevision: snapshot.draft.revision,
          document,
        });
        setSnapshot({ ...snapshot, draft });
        // A saved draft invalidates any preview taken against the old one.
        setPreview(null);
        return draft;
      } catch (cause: unknown) {
        captureFailure(cause);
        return null;
      } finally {
        setOperation(null);
      }
    },
    [captureFailure, clearFailure, client, snapshot],
  );

  const previewDraft = useCallback(
    async (document: SettingsDocument): Promise<SettingsPreview | null> => {
      setOperation("preview");
      clearFailure();
      try {
        const result = await client.previewDraft({ document });
        setPreview(result);
        return result;
      } catch (cause: unknown) {
        captureFailure(cause);
        setPreview(null);
        return null;
      } finally {
        setOperation(null);
      }
    },
    [captureFailure, clearFailure, client],
  );

  const publishDraft = useCallback(
    async (reason: string): Promise<boolean> => {
      if (snapshot === null) {
        return false;
      }
      setOperation("publish");
      clearFailure();
      try {
        const result = await client.publishDraft({
          actor: ACTOR,
          reason,
          expectedDraftRevision: snapshot.draft.revision,
          expectedDraftChecksum: snapshot.draft.checksum,
        });
        setSnapshot({ draft: result.draft, currentRelease: result.release });
        setReleases(await client.getReleases(RELEASE_LIMIT));
        setPreview(null);
        return true;
      } catch (cause: unknown) {
        captureFailure(cause);
        return false;
      } finally {
        setOperation(null);
      }
    },
    [captureFailure, clearFailure, client, snapshot],
  );

  const rollbackRelease = useCallback(
    async (releaseId: string, reason: string): Promise<boolean> => {
      if (snapshot === null) {
        return false;
      }
      setOperation("rollback");
      clearFailure();
      try {
        const result = await client.rollbackRelease({
          releaseId,
          actor: ACTOR,
          reason,
          expectedCurrentReleaseId: snapshot.currentRelease.id,
          expectedDraftRevision: snapshot.draft.revision,
        });
        setSnapshot({ draft: result.draft, currentRelease: result.release });
        setReleases(await client.getReleases(RELEASE_LIMIT));
        setPreview(null);
        return true;
      } catch (cause: unknown) {
        captureFailure(cause);
        return false;
      } finally {
        setOperation(null);
      }
    },
    [captureFailure, clearFailure, client, snapshot],
  );

  return {
    snapshot,
    releases,
    preview,
    conflict,
    operation,
    error,
    fieldViolations,
    reload,
    saveDraft,
    previewDraft,
    publishDraft,
    rollbackRelease,
    clearError: clearFailure,
    clearPreview: useCallback(() => setPreview(null), []),
    dismissConflict: useCallback(() => setConflict(null), []),
  };
}
