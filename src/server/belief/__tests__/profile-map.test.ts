import { describe, expect, it } from "vitest";

import {
  ACTIONABLE_PROFILE_DEFAULTS,
  beliefStateToProfile,
  settingsToPolicySettings,
} from "../profile-map.js";
import { DEFAULT_SETTINGS } from "../../settings/default-settings.js";
import type { BeliefSnapshot } from "../model.js";

const actionableStates = ["EXPLORE", "BUILD", "DEBUG", "REVIEW"] as const;
type ActionableState = (typeof actionableStates)[number];

const asSnapshotState = (state: ActionableState): BeliefSnapshot["state"] =>
  state;

describe("actionable soundscape ladder (v0.6)", () => {
  it("maps every actionable state to exactly one distinct audio profile", () => {
    const profiles = actionableStates.map((state) =>
      beliefStateToProfile(asSnapshotState(state)),
    );

    for (const profile of profiles) {
      expect(profile).not.toBeNull();
    }
    // Bijection: four actionable states, four distinct profiles.
    expect(new Set(profiles).size).toBe(actionableStates.length);

    expect(beliefStateToProfile(asSnapshotState("BUILD"))).toBe("flow");
    expect(beliefStateToProfile(asSnapshotState("EXPLORE"))).toBe("diverge");
    expect(beliefStateToProfile(asSnapshotState("REVIEW"))).toBe("audit");
    expect(beliefStateToProfile(asSnapshotState("DEBUG"))).toBe("debug");
  });

  it("non-actionable states never drive audio", () => {
    for (const state of ["SETUP", "WAIT", "BREAK", "UNKNOWN"] as const) {
      expect(beliefStateToProfile(state)).toBeNull();
    }
  });

  it("publishes pairwise-distinct targetGains for the four profiles", () => {
    const policy = settingsToPolicySettings(DEFAULT_SETTINGS);
    const gains = [
      policy.profileTargets.flow.targetGain,
      policy.profileTargets.debug.targetGain,
      policy.profileTargets.diverge.targetGain,
      policy.profileTargets.audit.targetGain,
    ];

    // All four loudness steps differ — neighboring states stay audibly
    // distinct.
    expect(new Set(gains).size).toBe(4);

    // And they are the canonical ladder values, in this order.
    expect(policy.profileTargets.flow.targetGain).toBe(
      ACTIONABLE_PROFILE_DEFAULTS.BUILD.targetGain,
    );
    expect(policy.profileTargets.debug.targetGain).toBe(
      ACTIONABLE_PROFILE_DEFAULTS.DEBUG.targetGain,
    );
    expect(policy.profileTargets.diverge.targetGain).toBe(
      ACTIONABLE_PROFILE_DEFAULTS.EXPLORE.targetGain,
    );
    expect(policy.profileTargets.audit.targetGain).toBe(
      ACTIONABLE_PROFILE_DEFAULTS.REVIEW.targetGain,
    );
  });

  it("defaults document matches the canonical ladder exactly", () => {
    for (const state of actionableStates) {
      const published = DEFAULT_SETTINGS.audio.profiles.find(
        (profile) => profile.state === state,
      );
      expect(published).toBeDefined();
      const canonical = ACTIONABLE_PROFILE_DEFAULTS[state];
      expect(published?.targetGain).toBe(canonical.targetGain);
      expect(beliefStateToProfile(asSnapshotState(state))).toBe(
        canonical.profile,
      );
    }

    // The canonical gains themselves are pairwise distinct.
    const gains = actionableStates.map(
      (state) => ACTIONABLE_PROFILE_DEFAULTS[state].targetGain,
    );
    expect(new Set(gains).size).toBe(4);
  });

  it("keeps the ladder ordered flow > debug > diverge > audit", () => {
    const gains = ACTIONABLE_PROFILE_DEFAULTS;
    expect(gains.BUILD.targetGain).toBeGreaterThan(gains.DEBUG.targetGain);
    expect(gains.DEBUG.targetGain).toBeGreaterThan(gains.EXPLORE.targetGain);
    expect(gains.EXPLORE.targetGain).toBeGreaterThan(gains.REVIEW.targetGain);
  });
});
