import type { Decision } from "./contracts.js";

export interface DecisionRepository {
  /**
   * Persists the decision, attributed to the given user stream. Omitted or
   * null writes to the legacy global stream (auth-disabled local mode).
   */
  save(decision: Decision, userId?: string | null): void;
  /**
   * The most recent decision. `undefined` reads without an attribution
   * filter (pre-v0.6 behavior); `null` reads the legacy global stream; a
   * user id reads that user's latest decision.
   */
  getCurrent(userId?: string | null): Decision | null;
}
