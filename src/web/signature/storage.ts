import { isTemplateId } from "./templates.js";
import type { SignatureDraft } from "./contracts.js";

const DRAFT_VERSION = 1;

export interface DraftStoragePort {
  load(): SignatureDraft | null;
  save(draft: SignatureDraft): void;
}

/** In-memory storage for tests and SSR-ish fallbacks. */
export function createMemoryDraftStorage(): DraftStoragePort {
  let current: SignatureDraft | null = null;
  return {
    load: () => current,
    save(draft) {
      current = draft;
    },
  };
}

function isDraft(value: unknown): value is SignatureDraft {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SignatureDraft> & {
    calibration?: unknown;
    version?: unknown;
  };
  return (
    isTemplateId(candidate.templateId) &&
    typeof candidate.updatedAt === "string" &&
    (candidate.calibration === undefined ||
      typeof candidate.calibration === "object")
  );
}

/**
 * localStorage-backed persistence with a safe fallback: corrupt or stale
 * payloads resolve to null (template defaults), never throw.
 */
export function createLocalStorageDraftStorage(
  key: string,
  storage: Pick<Storage, "getItem" | "setItem"> = globalThis.localStorage,
): DraftStoragePort {
  return {
    load(): SignatureDraft | null {
      try {
        const raw = storage.getItem(key);
        if (raw === null) {
          return null;
        }
        const parsed: unknown = JSON.parse(raw);
        if (!isDraft(parsed)) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    save(draft: SignatureDraft): void {
      try {
        storage.setItem(
          key,
          JSON.stringify({ ...draft, version: DRAFT_VERSION }),
        );
      } catch {
        // Storage unavailable (private mode, quota): drafts stay in-memory.
      }
    },
  };
}
