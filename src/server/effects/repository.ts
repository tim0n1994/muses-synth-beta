import type {
  EffectLedgerEntry,
  EffectOutcome,
  EffectRequest,
} from "./contracts.js";

/**
 * Per-user attribution convention (v0.6): writes take `userId?: string | null`
 * where omitted or null targets the legacy global stream; reads take the same
 * parameter where undefined reads unfiltered (pre-v0.6 behavior), null reads
 * the legacy global stream, and a user id reads that user's rows.
 */
export interface EffectRepository {
  recordIssued(request: EffectRequest, userId?: string | null): void;
  recordOutcome(outcome: EffectOutcome, userId?: string | null): void;
  getById(effectId: string, userId?: string | null): EffectLedgerEntry | null;
  getCurrent(userId?: string | null): EffectLedgerEntry | null;
  /**
   * When the user last drove the audio transport by hand, as an RFC3339
   * timestamp, or null if they never have. Read from storage rather than
   * process memory so a server restart cannot forget an override that is
   * still inside its cooldown.
   */
  getLastManualOverrideAt(userId?: string | null): string | null;
}
