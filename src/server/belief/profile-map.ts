import type { BeliefFactor } from "../policy/contracts.js";
import type {
  PolicySettings,
  ProfileTarget,
  QuietHours,
} from "../policy/contracts.js";
import type { SettingsDocument } from "../settings/schema.js";
import type { BeliefSnapshot, EvidenceRef, FactorName } from "./model.js";
import { describeBeliefState, type PolicyBeliefState } from "./vocabulary.js";

/**
 * The authoritative audio-profile vocabulary is diverge/flow/audit/debug. The
 * belief projector emits a finer-grained developer-state vocabulary, so the
 * two must be bridged before policy evaluation. A null result means the belief
 * state intentionally does not drive audio (idle or unknown).
 *
 *   EXPLORE  -> diverge  (exploratory, generative thinking)
 *   BUILD    -> flow     (sustained implementation)
 *   REVIEW   -> audit    (sustained review attention)
 *   DEBUG    -> debug    (focused resolution)
 *   WAIT     -> null     (explicit idle; no audio change)
 *   BREAK    -> null     (resting; no audio change)
 *   SETUP    -> null     (not yet a working state)
 *   UNKNOWN  -> null     (not actionable)
 */
export type RemappedProfile = "audit" | "debug" | "diverge" | "flow";

/**
 * The v0.6 personal-space default soundscape ladder, made explicit: every
 * actionable belief state maps to exactly one audio profile, and each of the
 * four profiles carries a distinct default targetGain so two neighboring
 * states can never render at the same loudness:
 *
 *   BUILD   -> flow    @ 0.35  (loudest: sustained implementation)
 *   DEBUG   -> debug   @ 0.30  (focused resolution)
 *   EXPLORE -> diverge @ 0.28  (generative exploration)
 *   REVIEW  -> audit   @ 0.25  (quietest: careful review)
 *
 * This table is the canonical statement of the mapping AND the shipped
 * defaults; default-settings.ts publishes these gains and
 * profile-map.test.ts asserts both the bijection and the pairwise-distinct
 * gains, so the four states stay audibly different as settings evolve. It
 * does not change runtime semantics: published settings still win, and
 * settingsToPolicySettings keeps clamping to the 0.35 policy ceiling.
 */
export interface ActionableProfileDefault {
  readonly profile: RemappedProfile;
  readonly targetGain: number;
}

export const ACTIONABLE_PROFILE_DEFAULTS: Readonly<
  Record<"BUILD" | "DEBUG" | "EXPLORE" | "REVIEW", ActionableProfileDefault>
> = Object.freeze({
  BUILD: Object.freeze({ profile: "flow", targetGain: 0.35 }),
  DEBUG: Object.freeze({ profile: "debug", targetGain: 0.3 }),
  EXPLORE: Object.freeze({ profile: "diverge", targetGain: 0.28 }),
  REVIEW: Object.freeze({ profile: "audit", targetGain: 0.25 }),
});

/**
 * The belief-state vocabulary the policy engine consumes. Re-exported from the
 * canonical table so there is exactly one definition.
 */
export type { PolicyBeliefState } from "./vocabulary.js";

export function beliefStateToPolicyState(
  state: BeliefSnapshot["state"],
): PolicyBeliefState {
  return describeBeliefState(state).policyState;
}

export function beliefStateToProfile(
  state: BeliefSnapshot["state"],
): RemappedProfile | null {
  return describeBeliefState(state).audioProfile;
}

/**
 * Builds the PolicyBelief the deterministic policy engine consumes, from a
 * projected belief snapshot. The engine's state field uses its own uppercase
 * belief-state vocabulary; UNKNOWN is passed through unchanged so the engine
 * can decline on UNKNOWN_BELIEF rather than asserting an unsupported mapping.
 */
export function toPolicyBelief(snapshot: BeliefSnapshot): {
  readonly beliefId: string;
  readonly state: PolicyBeliefState;
  readonly confidence: number;
  readonly observedAt: string;
  readonly factors: readonly BeliefFactor[];
} {
  const policyState = beliefStateToPolicyState(snapshot.state);
  return {
    beliefId: buildBeliefId(snapshot),
    state: policyState,
    confidence: snapshot.confidence,
    observedAt: snapshot.asOf,
    factors: extractPolicyFactors(snapshot),
  };
}

function buildBeliefId(snapshot: BeliefSnapshot): string {
  const tail =
    snapshot.lastServerSequence === undefined
      ? snapshot.inputDigest
      : `seq${snapshot.lastServerSequence}`;
  return `belief_${snapshot.rulesetVersion}_${tail}`;
}

/**
 * Collapses the projector's four factor dimensions into the flat factor list
 * the policy engine explains decisions with. Each factor contributes its
 * signed value; evidence is capped at the engine's per-factor limit.
 */
function extractPolicyFactors(
  snapshot: BeliefSnapshot,
): readonly BeliefFactor[] {
  const all: ReadonlyArray<
    readonly [FactorName, number, string, readonly EvidenceRef[]]
  > = [
    [
      "activity",
      signedFactorConfidence(snapshot.factors.activity),
      snapshot.factors.activity.value,
      snapshot.factors.activity.evidence,
    ],
    [
      "workMode",
      signedFactorConfidence(snapshot.factors.workMode),
      snapshot.factors.workMode.value,
      snapshot.factors.workMode.evidence,
    ],
    [
      "outcome",
      signedFactorConfidence(snapshot.factors.outcome),
      snapshot.factors.outcome.value,
      snapshot.factors.outcome.evidence,
    ],
    [
      "attention",
      signedFactorConfidence(snapshot.factors.attention),
      snapshot.factors.attention.value,
      snapshot.factors.attention.evidence,
    ],
  ];

  return all.map(([name, contribution, value, evidence]) => ({
    name: `${name}:${value}`,
    contribution,
    evidenceIds: evidence.slice(0, 32).map((ref) => ref.eventId),
  }));
}

/**
 * Converts a factor's [0,1] confidence into a signed contribution. Positive
 * factors (ACTIVE, EDITING, TESTING, SUCCESS, DEEP) push toward action;
 * negative (IDLE, FAILURE, DISENGAGED, etc.) push against; neutral otherwise.
 */
function signedFactorConfidence(factor: {
  readonly confidence: number;
  readonly value: string;
}): number {
  const magnitude = Math.min(1, Math.max(0, factor.confidence));
  const negative = new Set([
    "IDLE",
    "INACTIVE",
    "FAILURE",
    "DISENGAGED",
    "RESTING",
    "WAITING",
    "UNKNOWN",
  ]);
  const sign = negative.has(factor.value) ? -1 : 1;
  return Math.round(sign * magnitude * 1_000_000) / 1_000_000;
}

/**
 * The settings document stores audio profiles keyed by the belief-state
 * vocabulary (EXPLORE/BUILD/...), while the deterministic policy engine
 * consumes PolicySettings keyed by the audio-profile vocabulary
 * (diverge/flow/audit/debug). This bridge merges the belief-keyed profiles into
 * the four audio profiles so the policy engine can run against published
 * settings without requiring a second, parallel settings document.
 *
 * Each audio profile absorbs the settings of every belief state that maps to
 * it (see beliefStateToProfile). When several belief states share a profile,
 * the loudest targetGain wins and the longest rampMs wins, so the resulting
 * audio decision stays within the most permissive published bound.
 */
export function settingsToPolicySettings(
  document: SettingsDocument,
): PolicySettings {
  const byProfile: Record<
    "audit" | "debug" | "diverge" | "flow",
    ProfileTarget[]
  > = {
    diverge: [],
    flow: [],
    audit: [],
    debug: [],
  };

  for (const profile of document.audio.profiles) {
    const mapped = beliefStateToProfile(profile.state);
    if (mapped === null) {
      continue;
    }
    byProfile[mapped].push({
      targetGain: Math.min(profile.targetGain, 0.35),
      rampMs: clampRampMs(profile.transitionMs),
    });
  }

  const merge = (targets: readonly ProfileTarget[]): ProfileTarget => {
    if (targets.length === 0) {
      return { targetGain: 0.18, rampMs: 1200 };
    }
    const loudestGain = Math.max(...targets.map((t) => t.targetGain));
    const longestRamp = Math.max(...targets.map((t) => t.rampMs));
    return { targetGain: loudestGain, rampMs: longestRamp };
  };

  const quietHours: QuietHours = document.decision.quietHours;

  return {
    automationEnabled: document.audio.enabled,
    minimumConfidence: document.belief.minimumConfidence,
    maximumBeliefAgeMs: clampInteger(
      document.belief.stabilityWindowMs,
      1000,
      86_400_000,
      15_000,
    ),
    manualCooldownMs: clampInteger(
      document.decision.cooldownMs,
      0,
      86_400_000,
      120_000,
    ),
    quietHours,
    profileTargets: {
      diverge: merge(byProfile.diverge),
      flow: merge(byProfile.flow),
      audit: merge(byProfile.audit),
      debug: merge(byProfile.debug),
    },
  };
}

function clampRampMs(value: number): number {
  return clampInteger(value, 250, 5000, 1200);
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    return fallback;
  }
  return value;
}
