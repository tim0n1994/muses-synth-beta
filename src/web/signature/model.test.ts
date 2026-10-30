import { describe, expect, it } from "vitest";

import { resolveSignature, validateCalibration } from "./model.js";
import {
  SIGNATURE_TEMPLATES,
  TEMPLATE_ORDER,
  getTemplate,
} from "./templates.js";

describe("signature templates (V9: exactly three v0 templates)", () => {
  it("ships minimal electronic, ambient, and lo-fi jazz", () => {
    expect(TEMPLATE_ORDER).toEqual([
      "minimalElectronic",
      "ambient",
      "lofiJazz",
    ]);
  });

  it("gives each template distinct, sane defaults", () => {
    const defaults = TEMPLATE_ORDER.map(
      (id) => SIGNATURE_TEMPLATES[id].defaults,
    );
    expect(defaults[0]).toEqual({
      bpmRange: { min: 118, max: 138 },
      energyCap: 0.7,
      vocalDensity: "low",
    });
    expect(defaults[1]).toEqual({
      bpmRange: { min: 60, max: 80 },
      energyCap: 0.35,
      vocalDensity: "none",
    });
    expect(defaults[2]).toEqual({
      bpmRange: { min: 70, max: 90 },
      energyCap: 0.5,
      vocalDensity: "low",
    });
    // Distinct BPM windows and energy caps across templates.
    expect(
      new Set(defaults.map((d) => `${d.bpmRange.min}-${d.bpmRange.max}`)).size,
    ).toBe(3);
    expect(new Set(defaults.map((d) => d.energyCap)).size).toBe(3);
  });

  it("rejects unknown template ids", () => {
    expect(() => getTemplate("vaporwave" as never)).toThrow();
  });
});

describe("calibration validation", () => {
  it("accepts a valid calibration", () => {
    expect(
      validateCalibration({
        bpmRange: { min: 100, max: 120 },
        energyCap: 0.6,
        vocalDensity: "medium",
      }),
    ).toEqual([]);
  });

  it("flags out-of-range BPM windows", () => {
    expect(
      validateCalibration({ bpmRange: { min: 20, max: 120 } }),
    ).not.toEqual([]);
    expect(
      validateCalibration({ bpmRange: { min: 100, max: 400 } }),
    ).not.toEqual([]);
    expect(
      validateCalibration({ bpmRange: { min: 130, max: 120 } }),
    ).not.toEqual([]);
  });

  it("flags out-of-range energy caps and unknown vocal densities", () => {
    expect(validateCalibration({ energyCap: 1.5 })).not.toEqual([]);
    expect(validateCalibration({ energyCap: -0.1 })).not.toEqual([]);
    expect(
      validateCalibration({ vocalDensity: "sometimes" as never }),
    ).not.toEqual([]);
  });
});

describe("resolveSignature (template + manual calibration merge)", () => {
  it("returns template defaults without calibration", () => {
    const resolved = resolveSignature("ambient", {});
    expect(resolved).toEqual({
      templateId: "ambient",
      ...SIGNATURE_TEMPLATES.ambient.defaults,
    });
  });

  it("applies valid calibration fields on top of the template", () => {
    const resolved = resolveSignature("minimalElectronic", {
      bpmRange: { min: 122, max: 132 },
      energyCap: 0.55,
    });
    expect(resolved.bpmRange).toEqual({ min: 122, max: 132 });
    expect(resolved.energyCap).toBe(0.55);
    // Untouched field keeps the template value.
    expect(resolved.vocalDensity).toBe("low");
  });

  it("clamps finite numeric calibration into the legal envelope", () => {
    const resolved = resolveSignature("lofiJazz", { energyCap: 42 });
    expect(resolved.energyCap).toBe(1);
    const resolvedLow = resolveSignature("lofiJazz", {
      bpmRange: { min: 10, max: 30 },
    });
    expect(resolvedLow.bpmRange).toEqual({ min: 40, max: 40 });
  });

  it("falls back to template defaults for structurally invalid input", () => {
    const resolved = resolveSignature("ambient", {
      bpmRange: { min: 120, max: 100 },
      vocalDensity: "loud" as never,
    });
    expect(resolved.bpmRange).toEqual(
      SIGNATURE_TEMPLATES.ambient.defaults.bpmRange,
    );
    expect(resolved.vocalDensity).toBe("none");
  });
});
