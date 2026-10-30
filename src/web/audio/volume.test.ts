import { describe, expect, it } from "vitest";

import { gainToPercent, MAX_GAIN, percentToGain } from "./volume";

describe("volume scale", () => {
  it("maps the whole slider onto the executor's gain range", () => {
    expect(percentToGain(0)).toBe(0);
    expect(percentToGain(100)).toBe(MAX_GAIN);
    expect(percentToGain(50)).toBeCloseTo(MAX_GAIN / 2);
  });

  it("never requests a gain the executor rejects", () => {
    for (const percent of [-5, 101, 900, Number.POSITIVE_INFINITY]) {
      const gain = percentToGain(percent);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(MAX_GAIN);
    }
  });

  it("round-trips what the slider shows back to the same position", () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(gainToPercent(percentToGain(percent))).toBe(percent);
    }
  });

  it("shows profile default gains inside the slider range", () => {
    expect(gainToPercent(0.16)).toBe(46);
    expect(gainToPercent(1)).toBe(100);
  });
});
