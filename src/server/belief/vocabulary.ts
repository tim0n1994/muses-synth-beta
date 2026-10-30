import type { AudioProfileId } from "../policy/contracts.js";

/**
 * The one state vocabulary.
 *
 * v0.1 shipped five of these: the projector's eight states, the settings
 * document's seven, the policy engine's five, the (dead) observatory route's
 * six, and the registry's four. Each hop lost information — `SETUP`, `WAIT`
 * and `BREAK` all collapsed into a display label reading "Known" — and each
 * map was maintained separately. This table is now the only place a belief
 * state is described, and every layer derives its own view from it.
 *
 * `audioProfile: null` means the state deliberately does not drive audio.
 * `policyState` is the label the deterministic policy engine keys its
 * profile table on; states that do not drive audio pass through as UNKNOWN so
 * the engine declines with `UNKNOWN_BELIEF` rather than asserting a mapping
 * that does not exist.
 */
export const BELIEF_STATE_NAMES = [
  "SETUP",
  "EXPLORE",
  "BUILD",
  "DEBUG",
  "REVIEW",
  "WAIT",
  "BREAK",
  "UNKNOWN",
] as const;
export type BeliefStateName = (typeof BELIEF_STATE_NAMES)[number];

export type PolicyBeliefState =
  "AUDIT" | "DEBUG" | "DIVERGE" | "FLOW" | "UNKNOWN";

export type BeliefStateTone = "accent" | "positive" | "warning" | "neutral";

export interface BeliefStateDescriptor {
  readonly state: BeliefStateName;
  /** Short human label. Never invents a state that the engine cannot report. */
  readonly label: string;
  readonly description: string;
  readonly tone: BeliefStateTone;
  readonly audioProfile: AudioProfileId | null;
  readonly policyState: PolicyBeliefState;
  /**
   * False for states the settings document cannot configure. `SETUP` is
   * engine-internal: it never drives audio, so `SettingsDocument.belief.states`
   * deliberately lists the other seven.
   */
  readonly configurable: boolean;
}

export const BELIEF_VOCABULARY: Readonly<
  Record<BeliefStateName, BeliefStateDescriptor>
> = Object.freeze({
  SETUP: {
    state: "SETUP",
    label: "Setting up",
    description: "Preparing the environment; not yet a working state.",
    tone: "neutral",
    audioProfile: null,
    policyState: "UNKNOWN",
    configurable: false,
  },
  EXPLORE: {
    state: "EXPLORE",
    label: "Diverge",
    description: "Exploring and generating alternatives.",
    tone: "accent",
    audioProfile: "diverge",
    policyState: "DIVERGE",
    configurable: true,
  },
  BUILD: {
    state: "BUILD",
    label: "Flow",
    description: "Sustained implementation.",
    tone: "positive",
    audioProfile: "flow",
    policyState: "FLOW",
    configurable: true,
  },
  DEBUG: {
    state: "DEBUG",
    label: "Debug",
    description: "Investigating a failure.",
    tone: "warning",
    audioProfile: "debug",
    policyState: "DEBUG",
    configurable: true,
  },
  REVIEW: {
    state: "REVIEW",
    label: "Audit",
    description: "Careful review and verification.",
    tone: "accent",
    audioProfile: "audit",
    policyState: "AUDIT",
    configurable: true,
  },
  WAIT: {
    state: "WAIT",
    label: "Waiting",
    description: "Blocked on a process or another person.",
    tone: "neutral",
    audioProfile: null,
    policyState: "UNKNOWN",
    configurable: true,
  },
  BREAK: {
    state: "BREAK",
    label: "Break",
    description: "Away from the work.",
    tone: "neutral",
    audioProfile: null,
    policyState: "UNKNOWN",
    configurable: true,
  },
  UNKNOWN: {
    state: "UNKNOWN",
    label: "Unknown",
    description: "Evidence is insufficient or conflicting.",
    tone: "neutral",
    audioProfile: null,
    policyState: "UNKNOWN",
    configurable: true,
  },
});

export function describeBeliefState(state: string): BeliefStateDescriptor {
  return (
    BELIEF_VOCABULARY[state as BeliefStateName] ?? BELIEF_VOCABULARY.UNKNOWN
  );
}
