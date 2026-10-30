import { describe, expect, it } from "vitest";

import type { Decision } from "../policy/contracts.js";
import { isManualOverrideReason } from "./contracts.js";
import type {
  EffectLedgerEntry,
  EffectOutcome,
  EffectRequest,
} from "./contracts.js";
import {
  EffectLedgerService,
  type EffectClock,
  UnknownEffectError,
} from "./ledger.js";
import type { EffectRepository } from "./repository.js";

class FixedClock implements EffectClock {
  public now(): Date {
    return new Date("2026-07-30T03:00:00.000Z");
  }
}

class MemoryEffectRepository implements EffectRepository {
  private readonly requests = new Map<string, EffectRequest>();
  private readonly outcomes = new Map<string, EffectOutcome>();

  public recordIssued(request: EffectRequest): void {
    this.requests.set(request.effectId, request);
  }
  public recordOutcome(outcome: EffectOutcome): void {
    this.outcomes.set(outcome.effectId, outcome);
  }
  public getById(effectId: string): EffectLedgerEntry | null {
    const request = this.requests.get(effectId);
    return request === undefined
      ? null
      : { request, latestOutcome: this.outcomes.get(effectId) ?? null };
  }
  public getCurrent(): EffectLedgerEntry | null {
    const request = [...this.requests.values()].at(-1);
    return request === undefined ? null : this.getById(request.effectId);
  }
  public getLastManualOverrideAt(): string | null {
    const manual = [...this.outcomes.values()]
      .filter((outcome) => isManualOverrideReason(outcome.reason))
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    return manual.at(-1)?.observedAt ?? null;
  }
}

const actionDecision: Decision = {
  decisionId: "decision-1",
  beliefId: "belief-1",
  beliefObservedAt: "2026-07-30T02:59:30.000Z",
  createdAt: "2026-07-30T03:00:00.000Z",
  confidence: 0.9,
  explanation: { summary: "test", factors: [] },
  kind: "AUDIO_FLOW",
  reason: "BELIEF_STATE_MATCH",
  effect: {
    actionId: "audio.adjust",
    profile: "flow",
    targetGain: 0.18,
    rampMs: 1200,
  },
};

describe("EffectLedgerService", () => {
  it("issues only the audio.adjust action", () => {
    const service = new EffectLedgerService(
      new MemoryEffectRepository(),
      new FixedClock(),
    );
    expect(service.issueFromDecision(actionDecision)).toMatchObject({
      effectId: "effect_decision-1",
      actionId: "audio.adjust",
      status: "issued",
    });
  });

  it("does not issue an effect for NO_ACTION", () => {
    const service = new EffectLedgerService(
      new MemoryEffectRepository(),
      new FixedClock(),
    );
    const decision: Decision = {
      ...actionDecision,
      kind: "NO_ACTION",
      reason: "LOW_CONFIDENCE",
      effect: null,
    };
    expect(service.issueFromDecision(decision)).toBeNull();
  });

  it("appends and returns an outcome", () => {
    const service = new EffectLedgerService(
      new MemoryEffectRepository(),
      new FixedClock(),
    );
    const request = service.issueFromDecision(actionDecision);
    expect(request).not.toBeNull();
    const outcome: EffectOutcome = {
      outcomeId: "outcome-1",
      effectId: request?.effectId ?? "unreachable",
      status: "applied",
      reason: "PROFILE_APPLIED",
      detail: null,
      observedAt: "2026-07-30T03:00:01.000Z",
    };
    expect(service.recordOutcome(outcome).latestOutcome).toEqual(outcome);
  });

  it("rejects outcomes for unknown effects", () => {
    const service = new EffectLedgerService(
      new MemoryEffectRepository(),
      new FixedClock(),
    );
    expect(() =>
      service.recordOutcome({
        outcomeId: "outcome-1",
        effectId: "missing",
        status: "failed",
        reason: "UNKNOWN",
        detail: null,
        observedAt: "2026-07-30T03:00:01.000Z",
      }),
    ).toThrow(UnknownEffectError);
  });
});

describe("manual override tracking", () => {
  it("remembers when the browser reported a manual transport action", () => {
    const ledger = new EffectLedgerService(
      new MemoryEffectRepository(),
      new FixedClock(),
    );
    const request = ledger.issueFromDecision(actionDecision);
    if (request === null) {
      throw new Error("expected the decision to issue an effect");
    }
    expect(ledger.getLastManualOverrideAt()).toBeNull();

    ledger.recordOutcome({
      outcomeId: "outcome-manual",
      effectId: request.effectId,
      status: "skipped",
      reason: "MANUAL_PAUSE",
      detail: null,
      observedAt: "2026-07-30T03:01:00.000Z",
    });

    expect(ledger.getLastManualOverrideAt()).toBe("2026-07-30T03:01:00.000Z");
  });

  it("ignores automated outcomes so automation does not cool itself down", () => {
    const ledger = new EffectLedgerService(
      new MemoryEffectRepository(),
      new FixedClock(),
    );
    const request = ledger.issueFromDecision(actionDecision);
    if (request === null) {
      throw new Error("expected the decision to issue an effect");
    }

    ledger.recordOutcome({
      outcomeId: "outcome-auto",
      effectId: request.effectId,
      status: "applied",
      reason: "PROFILE_APPLIED",
      detail: null,
      observedAt: "2026-07-30T03:02:00.000Z",
    });

    expect(ledger.getLastManualOverrideAt()).toBeNull();
  });
});
