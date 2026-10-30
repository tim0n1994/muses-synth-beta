import type { SettingsDocument } from "../settings/schema.js";
import { canonicalizeJson } from "../settings/canonical.js";
import type { ContextEventService } from "./service.js";

/** These controls are persisted legacy configuration, not implemented collection guarantees. */
export const unsupportedPrivacyControls = [
  "signals.*.enabled",
  "signals.*.retainRaw",
  "signals.*.weight",
  "privacy.excludedApplications",
  "privacy.captureScreenContent",
  "privacy.sessionHistoryRetentionDays",
] as const;

export function unsupportedPrivacyChanged(
  current: SettingsDocument,
  next: SettingsDocument,
): boolean {
  const pick = (document: SettingsDocument) => ({
    signals: [...document.signals].sort((a, b) => a.id.localeCompare(b.id)),
    excludedApplications: [...document.privacy.excludedApplications].sort(),
    captureScreenContent: document.privacy.captureScreenContent,
    sessionHistoryRetentionDays: document.privacy.sessionHistoryRetentionDays,
  });
  return canonicalizeJson(pick(current)) !== canonicalizeJson(pick(next));
}

/** One bounded batch per tick, no overlap or tight-loop retry. Stop drains an active batch. */
export function createRetentionMaintenance(
  service: Pick<ContextEventService, "pruneExpired">,
  reportFailure: (error: unknown) => void,
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;
  let stopped = false;
  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    pending ??= Promise.resolve()
      .then(() => service.pruneExpired(500))
      .then(() => undefined)
      .catch(reportFailure)
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return {
    start: async (): Promise<void> => {
      if (stopped || timer !== undefined) return;
      timer = setInterval(() => {
        void run();
      }, 60_000);
      timer.unref?.();
      await run();
    },
    stop: async (): Promise<void> => {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}
