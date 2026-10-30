import type { Decision } from "../policy/contracts.js";
import type {
  EffectLedgerEntry,
  EffectOutcome,
  EffectRequest,
} from "./contracts.js";
import type { EffectRepository } from "./repository.js";

export const AUTOMATION_ACTION_ALLOW_LIST = Object.freeze([
  "audio.adjust",
] as const);

export interface EffectClock {
  now(): Date;
}

export class SystemEffectClock implements EffectClock {
  public now(): Date {
    return new Date();
  }
}

export class EffectLedgerService {
  public constructor(
    private readonly repository: EffectRepository,
    private readonly clock: EffectClock = new SystemEffectClock(),
  ) {}

  /**
   * Issues the decision's effect into the given user's stream. Omitted or
   * null targets the legacy global stream (auth-disabled local mode).
   */
  public issueFromDecision(
    decision: Decision,
    userId?: string | null,
  ): EffectRequest | null {
    if (decision.kind === "NO_ACTION" || decision.effect === null) {
      return null;
    }
    if (!isAllowedAction(decision.effect.actionId)) {
      throw new Error("Decision requested an action outside the allow-list.");
    }

    const request: EffectRequest = {
      effectId: `effect_${decision.decisionId}`,
      decisionId: decision.decisionId,
      actionId: "audio.adjust",
      adjustment: decision.effect,
      issuedAt: this.clock.now().toISOString(),
      status: "issued",
    };
    this.repository.recordIssued(request, userId);
    return request;
  }

  /**
   * Records an outcome against an effect. When a user scope is given, the
   * effect must belong to that user's stream — otherwise it is reported as
   * unknown, so one account can neither complete nor observe another's
   * effects.
   */
  public recordOutcome(
    outcome: EffectOutcome,
    userId?: string | null,
  ): EffectLedgerEntry {
    const existing = this.repository.getById(outcome.effectId, userId);
    if (existing === null) {
      throw new UnknownEffectError(outcome.effectId);
    }
    this.repository.recordOutcome(outcome, userId);
    const updated = this.repository.getById(outcome.effectId, userId);
    if (updated === null) {
      throw new Error("Effect disappeared after recording its outcome.");
    }
    return updated;
  }

  public getCurrent(userId?: string | null): EffectLedgerEntry | null {
    return this.repository.getCurrent(userId);
  }

  /**
   * When the user last drove the audio transport by hand, as an RFC3339
   * timestamp, or null if they never have. The policy engine compares it
   * against the published cooldown so automation stands down after a manual
   * change.
   *
   * Read from storage on every call rather than cached in the process: a dev
   * server restart mid-cooldown used to drop the override and let automation
   * resume a full cooldown early.
   */
  public getLastManualOverrideAt(userId?: string | null): string | null {
    return this.repository.getLastManualOverrideAt(userId);
  }
}

export class UnknownEffectError extends Error {
  public constructor(public readonly effectId: string) {
    super(`Unknown effect: ${effectId}`);
    this.name = "UnknownEffectError";
  }
}

function isAllowedAction(value: string): value is "audio.adjust" {
  return AUTOMATION_ACTION_ALLOW_LIST.some((candidate) => candidate === value);
}
