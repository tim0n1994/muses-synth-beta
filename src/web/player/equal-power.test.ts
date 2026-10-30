import { describe, expect, it } from "vitest";

import { buildEqualPowerCurves } from "./equal-power.js";

describe("equal-power crossfade curves", () => {
  it("keeps the sum of squared gains at 1 across the whole overlap", () => {
    const { fadeOut, fadeIn } = buildEqualPowerCurves(64);
    expect(fadeOut).toHaveLength(64);
    expect(fadeIn).toHaveLength(64);
    for (let i = 0; i < 64; i += 1) {
      const power = fadeOut[i]! ** 2 + fadeIn[i]! ** 2;
      // Float32 storage rounds cos/sin, so the invariant holds to ~1e-7.
      expect(Math.abs(power - 1)).toBeLessThan(1e-6);
    }
  });

  it("starts at full old gain / zero new gain and ends inverted", () => {
    const { fadeOut, fadeIn } = buildEqualPowerCurves(32);
    expect(fadeOut[0]).toBeCloseTo(1, 12);
    expect(fadeIn[0]).toBeCloseTo(0, 12);
    expect(fadeOut[31]).toBeCloseTo(0, 12);
    expect(fadeIn[31]).toBeCloseTo(1, 12);
  });

  it("is monotonic in both directions", () => {
    const { fadeOut, fadeIn } = buildEqualPowerCurves(128);
    for (let i = 1; i < 128; i += 1) {
      expect(fadeOut[i]!).toBeLessThanOrEqual(fadeOut[i - 1]!);
      expect(fadeIn[i]!).toBeGreaterThanOrEqual(fadeIn[i - 1]!);
    }
  });

  it("never has an interior zero on either curve (no silent moment)", () => {
    const { fadeOut, fadeIn } = buildEqualPowerCurves(128);
    for (let i = 0; i < 127; i += 1) {
      expect(fadeOut[i]!).toBeGreaterThan(0);
    }
    for (let i = 1; i < 128; i += 1) {
      expect(fadeIn[i]!).toBeGreaterThan(0);
    }
  });

  it("keeps the linear sum at or above 1 (no equal-power dip)", () => {
    const { fadeOut, fadeIn } = buildEqualPowerCurves(64);
    for (let i = 0; i < 64; i += 1) {
      expect(fadeOut[i]! + fadeIn[i]!).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it("rejects degenerate sample counts", () => {
    expect(() => buildEqualPowerCurves(1)).toThrow();
    expect(() => buildEqualPowerCurves(0)).toThrow();
  });
});
