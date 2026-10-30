import type {
  AudioProfileId,
  BeliefFactor,
  BeliefState,
  Decision,
  DecisionKind,
  NoActionDecision,
  NoActionReason,
  PolicyInput,
  ProfileTarget,
  QuietHours,
} from "./contracts.js";

export interface PolicyClock {
  now(): Date;
}

export class SystemPolicyClock implements PolicyClock {
  public now(): Date {
    return new Date();
  }
}

const PROFILE_BY_STATE: Readonly<
  Record<Exclude<BeliefState, "UNKNOWN">, AudioProfileId>
> = {
  DIVERGE: "diverge",
  FLOW: "flow",
  AUDIT: "audit",
  DEBUG: "debug",
};

const KIND_BY_PROFILE: Readonly<Record<AudioProfileId, DecisionKind>> = {
  diverge: "AUDIO_DIVERGE",
  flow: "AUDIO_FLOW",
  audit: "AUDIO_AUDIT",
  debug: "AUDIO_DEBUG",
};

export class DeterministicPolicyEngine {
  public constructor(
    private readonly clock: PolicyClock = new SystemPolicyClock(),
  ) {}

  public evaluate(input: PolicyInput): Decision {
    const now = this.clock.now();
    const createdAt = now.toISOString();
    const sortedFactors = sortFactors(input.belief.factors);
    const base = {
      decisionId: createDecisionId(input, createdAt),
      beliefId: input.belief.beliefId,
      beliefObservedAt: input.belief.observedAt,
      createdAt,
      confidence: input.belief.confidence,
      explanation: {
        summary: "",
        factors: sortedFactors,
      },
    };

    if (!input.settings.automationEnabled) {
      return noAction(base, "AUTOMATION_DISABLED", "Automation is disabled.");
    }

    if (
      isManualCooldownActive(
        now,
        input.context.lastManualOverrideAt,
        input.settings.manualCooldownMs,
      )
    ) {
      return noAction(
        base,
        "MANUAL_COOLDOWN",
        "A recent manual audio override has priority.",
      );
    }

    if (isQuietTime(now, input.settings.quietHours)) {
      return noAction(
        base,
        "QUIET_HOURS",
        "The published quiet-hours rule blocks automatic audio changes.",
      );
    }

    if (
      isBeliefStale(
        now,
        input.belief.observedAt,
        input.settings.maximumBeliefAgeMs,
      )
    ) {
      return noAction(base, "STALE_BELIEF", "The belief snapshot is stale.");
    }

    if (input.belief.state === "UNKNOWN") {
      return noAction(
        base,
        "UNKNOWN_BELIEF",
        "Unknown belief state is not actionable.",
      );
    }

    if (input.belief.confidence < input.settings.minimumConfidence) {
      return noAction(
        base,
        "LOW_CONFIDENCE",
        "Belief confidence is below the published threshold.",
      );
    }

    const profile = PROFILE_BY_STATE[input.belief.state];
    if (input.context.currentProfile === profile) {
      return noAction(
        base,
        "PROFILE_UNCHANGED",
        "The current audio profile already matches the belief state.",
      );
    }

    return audioDecision(
      base,
      profile,
      input.settings.profileTargets[profile],
      input.belief.state,
    );
  }
}

interface DecisionBase {
  readonly decisionId: string;
  readonly beliefId: string;
  readonly beliefObservedAt: string;
  readonly createdAt: string;
  readonly confidence: number;
  readonly explanation: {
    readonly summary: string;
    readonly factors: readonly BeliefFactor[];
  };
}

function noAction(
  base: DecisionBase,
  reason: NoActionReason,
  summary: string,
): NoActionDecision {
  return {
    ...base,
    kind: "NO_ACTION",
    reason,
    effect: null,
    explanation: {
      ...base.explanation,
      summary,
      factors: [...base.explanation.factors],
    },
  };
}

function audioDecision(
  base: DecisionBase,
  profile: AudioProfileId,
  target: ProfileTarget,
  state: Exclude<BeliefState, "UNKNOWN">,
): Decision {
  const common = {
    ...base,
    kind: KIND_BY_PROFILE[profile],
    reason: "BELIEF_STATE_MATCH" as const,
    effect: {
      actionId: "audio.adjust" as const,
      profile,
      targetGain: target.targetGain,
      rampMs: target.rampMs,
    },
    explanation: {
      ...base.explanation,
      summary: `Belief state ${state} maps deterministically to the ${profile} audio profile.`,
      factors: [...base.explanation.factors],
    },
  };

  switch (profile) {
    case "diverge":
      return {
        ...common,
        kind: "AUDIO_DIVERGE",
        effect: { ...common.effect, profile },
      };
    case "flow":
      return {
        ...common,
        kind: "AUDIO_FLOW",
        effect: { ...common.effect, profile },
      };
    case "audit":
      return {
        ...common,
        kind: "AUDIO_AUDIT",
        effect: { ...common.effect, profile },
      };
    case "debug":
      return {
        ...common,
        kind: "AUDIO_DEBUG",
        effect: { ...common.effect, profile },
      };
  }
}

function sortFactors(factors: readonly BeliefFactor[]): BeliefFactor[] {
  return [...factors]
    .map((factor) => ({
      ...factor,
      evidenceIds: [...factor.evidenceIds].sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => {
      const contributionDifference =
        Math.abs(right.contribution) - Math.abs(left.contribution);
      return contributionDifference === 0
        ? left.name.localeCompare(right.name)
        : contributionDifference;
    });
}

function isBeliefStale(
  now: Date,
  observedAt: string,
  maximumAgeMs: number,
): boolean {
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return true;
  }
  const ageMs = now.getTime() - observedAtMs;
  return ageMs < 0 || ageMs > maximumAgeMs;
}

function isManualCooldownActive(
  now: Date,
  lastManualOverrideAt: string | null,
  cooldownMs: number,
): boolean {
  if (lastManualOverrideAt === null || cooldownMs === 0) {
    return false;
  }
  const overrideAtMs = Date.parse(lastManualOverrideAt);
  if (!Number.isFinite(overrideAtMs)) {
    return true;
  }
  const elapsedMs = now.getTime() - overrideAtMs;
  return elapsedMs < 0 || elapsedMs < cooldownMs;
}

function isQuietTime(now: Date, quietHours: QuietHours): boolean {
  if (!quietHours.enabled) {
    return false;
  }

  const minute = now.getHours() * 60 + now.getMinutes();
  const { startMinuteInclusive: start, endMinuteExclusive: end } = quietHours;

  if (start === end) {
    return true;
  }
  if (start < end) {
    return minute >= start && minute < end;
  }
  return minute >= start || minute < end;
}

function createDecisionId(input: PolicyInput, createdAt: string): string {
  const seed = [
    input.belief.beliefId,
    input.belief.state,
    input.belief.confidence.toFixed(6),
    input.belief.observedAt,
    input.context.currentProfile ?? "none",
    input.context.lastManualOverrideAt ?? "none",
    createdAt,
  ].join("|");
  return `decision_${fnv1a(seed)}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
