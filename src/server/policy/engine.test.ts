import { describe, expect, it } from "vitest";

import type { PolicyInput } from "./contracts.js";
import { DeterministicPolicyEngine, type PolicyClock } from "./engine.js";

class FixedClock implements PolicyClock {
  public constructor(private readonly value: Date) {}
  public now(): Date {
    return new Date(this.value.getTime());
  }
}

const NOW = new Date("2026-07-30T03:00:00.000Z");

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  const base: PolicyInput = {
    belief: {
      beliefId: "belief-1",
      state: "FLOW",
      confidence: 0.9,
      observedAt: "2026-07-30T02:59:30.000Z",
      factors: [
        {
          name: "editor_activity",
          contribution: 0.7,
          evidenceIds: ["event-2"],
        },
      ],
    },
    settings: {
      automationEnabled: true,
      minimumConfidence: 0.7,
      maximumBeliefAgeMs: 60_000,
      manualCooldownMs: 300_000,
      quietHours: {
        enabled: false,
        startMinuteInclusive: 1320,
        endMinuteExclusive: 420,
      },
      profileTargets: {
        diverge: { targetGain: 0.16, rampMs: 1200 },
        flow: { targetGain: 0.18, rampMs: 1200 },
        audit: { targetGain: 0.14, rampMs: 1000 },
        debug: { targetGain: 0.15, rampMs: 900 },
      },
    },
    context: {
      currentProfile: null,
      lastManualOverrideAt: null,
    },
  };
  return {
    ...base,
    ...overrides,
    belief: { ...base.belief, ...overrides.belief },
    settings: { ...base.settings, ...overrides.settings },
    context: { ...base.context, ...overrides.context },
  };
}

describe("DeterministicPolicyEngine", () => {
  const engine = new DeterministicPolicyEngine(new FixedClock(NOW));

  const mappings: Array<
    [
      "DIVERGE" | "FLOW" | "AUDIT" | "DEBUG",
      "AUDIO_DIVERGE" | "AUDIO_FLOW" | "AUDIO_AUDIT" | "AUDIO_DEBUG",
      "diverge" | "flow" | "audit" | "debug",
    ]
  > = [
    ["DIVERGE", "AUDIO_DIVERGE", "diverge"],
    ["FLOW", "AUDIO_FLOW", "flow"],
    ["AUDIT", "AUDIO_AUDIT", "audit"],
    ["DEBUG", "AUDIO_DEBUG", "debug"],
  ];

  it.each(mappings)("maps %s deterministically", (state, kind, profile) => {
    const decision = engine.evaluate(
      input({ belief: { ...input().belief, state } }),
    );
    expect(decision.kind).toBe(kind);
    expect(decision.effect?.profile).toBe(profile);
    expect(decision.effect?.actionId).toBe("audio.adjust");
  });

  it("makes disabled automation non-actionable", () => {
    const decision = engine.evaluate(
      input({ settings: { ...input().settings, automationEnabled: false } }),
    );
    expect(decision).toMatchObject({
      kind: "NO_ACTION",
      reason: "AUTOMATION_DISABLED",
    });
  });

  it("gives a manual override cooldown priority", () => {
    const decision = engine.evaluate(
      input({
        context: {
          currentProfile: null,
          lastManualOverrideAt: "2026-07-30T02:59:00.000Z",
        },
      }),
    );
    expect(decision).toMatchObject({
      kind: "NO_ACTION",
      reason: "MANUAL_COOLDOWN",
    });
  });

  it("blocks automation during quiet hours", () => {
    const decision = engine.evaluate(
      input({
        settings: {
          ...input().settings,
          quietHours: {
            enabled: true,
            startMinuteInclusive: 0,
            endMinuteExclusive: 1439,
          },
        },
      }),
    );
    expect(decision).toMatchObject({
      kind: "NO_ACTION",
      reason: "QUIET_HOURS",
    });
  });

  it("rejects stale, unknown, and low-confidence beliefs", () => {
    expect(
      engine.evaluate(
        input({
          belief: { ...input().belief, observedAt: "2026-07-30T02:00:00.000Z" },
        }),
      ),
    ).toMatchObject({ reason: "STALE_BELIEF" });
    expect(
      engine.evaluate(
        input({ belief: { ...input().belief, state: "UNKNOWN" } }),
      ),
    ).toMatchObject({ reason: "UNKNOWN_BELIEF" });
    expect(
      engine.evaluate(
        input({ belief: { ...input().belief, confidence: 0.2 } }),
      ),
    ).toMatchObject({ reason: "LOW_CONFIDENCE" });
  });

  it("does not emit a redundant adjustment", () => {
    const decision = engine.evaluate(
      input({
        context: { currentProfile: "flow", lastManualOverrideAt: null },
      }),
    );
    expect(decision).toMatchObject({
      kind: "NO_ACTION",
      reason: "PROFILE_UNCHANGED",
    });
  });
});
