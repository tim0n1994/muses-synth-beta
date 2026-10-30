/**
 * V9 feedback journal: skip / relisten events are RECORDED ONLY.
 *
 * This module intentionally exposes no API that the calibration model (or any
 * plan producer) could consume: the only read is exportEntries() for display
 * and future data export. Learning lands in P2; until then the structural
 * guarantee lives in calibration-journal.test.ts (model.ts never imports this
 * module) plus the behavioural invariant (resolveSignature output is
 * independent of journal contents).
 */
export interface SignatureFeedbackEvent {
  readonly kind: "skip" | "relisten";
  readonly trackId: string;
  readonly occurredAt: string;
}

export interface FeedbackJournalPort {
  record(event: SignatureFeedbackEvent): void;
  exportEntries(): readonly SignatureFeedbackEvent[];
}

export function createMemoryFeedbackJournal(): FeedbackJournalPort {
  const entries: SignatureFeedbackEvent[] = [];
  return {
    record(event) {
      entries.push(event);
    },
    exportEntries() {
      return [...entries];
    },
  };
}

export function createLocalStorageFeedbackJournal(
  key: string,
  storage: Pick<Storage, "getItem" | "setItem"> = globalThis.localStorage,
): FeedbackJournalPort {
  return {
    record(event) {
      try {
        const raw = storage.getItem(key);
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        const entries = Array.isArray(parsed) ? parsed : [];
        entries.push(event);
        storage.setItem(key, JSON.stringify(entries));
      } catch {
        // Unavailable storage: drop the event rather than break playback.
      }
    },
    exportEntries() {
      try {
        const raw = storage.getItem(key);
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        return Array.isArray(parsed)
          ? (parsed as SignatureFeedbackEvent[])
          : [];
      } catch {
        return [];
      }
    },
  };
}
