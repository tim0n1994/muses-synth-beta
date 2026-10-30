import { describe, expect, it } from "vitest";

import { AUDIO_PROFILES } from "./profiles.js";

describe("AUDIO_PROFILES", () => {
  it("contains exactly four local generated profiles", () => {
    expect(Object.keys(AUDIO_PROFILES).sort()).toEqual([
      "audit",
      "debug",
      "diverge",
      "flow",
    ]);
  });

  it("keeps gains and crossfades inside conservative bounds", () => {
    for (const profile of Object.values(AUDIO_PROFILES)) {
      expect(profile.defaultGain).toBeGreaterThanOrEqual(0);
      expect(profile.defaultGain).toBeLessThanOrEqual(0.35);
      expect(profile.crossfadeMs).toBeGreaterThanOrEqual(250);
      expect(profile.oscillators.length).toBeGreaterThan(0);
    }
  });
});
