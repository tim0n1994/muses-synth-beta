import { describe, expect, it } from "vitest";
import {
  allRegistryCapabilities,
  representativeDashboardConfig,
} from "../fixtures";
import { validateDashboardConfig } from "../validate";
import type { DashboardConfigInput, RegistryCapability } from "../types";

const capabilities = new Set<RegistryCapability>(allRegistryCapabilities);

function singleSectionConfig(
  section: DashboardConfigInput["sections"][number],
): DashboardConfigInput {
  return {
    schemaVersion: "1.0",
    dashboardId: "test-dashboard",
    sections: [section],
  };
}

describe("dashboard registry validation", () => {
  it("accepts all eight statically registered component types", () => {
    const result = validateDashboardConfig(
      representativeDashboardConfig,
      capabilities,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections).toHaveLength(8);
      expect(
        result.value.sections.every((section) => section.kind === "renderable"),
      ).toBe(true);
      expect(result.value.issues).toHaveLength(0);
    }
  });

  it("rejects an unknown dashboard schema version", () => {
    const result = validateDashboardConfig(
      { ...representativeDashboardConfig, schemaVersion: "9.9" },
      capabilities,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "dashboard.schema-version",
    });
  });

  it("converts unknown component types into a safe fallback section", () => {
    const result = validateDashboardConfig(
      singleSectionConfig({
        id: "unknown",
        type: "custom.html",
        schemaVersion: "1.0",
        layout: { columnSpan: { sm: 4, md: 4, lg: 4 } },
        props: { html: "<script>alert(1)</script>" },
      }),
      capabilities,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections[0]).toMatchObject({
        kind: "fallback",
        reason: "component.unknown-type",
      });
    }
  });

  it("converts an unknown component schema version into a safe fallback section", () => {
    const result = validateDashboardConfig(
      singleSectionConfig({
        id: "state",
        type: "state.hero",
        schemaVersion: "2.0",
        layout: { columnSpan: { sm: 4, md: 4, lg: 4 } },
        props: {
          status: "UNKNOWN",
          confidence: 0,
          summary: "No compatible schema is available.",
        },
      }),
      capabilities,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections[0]).toMatchObject({
        kind: "fallback",
        reason: "component.schema-version",
      });
    }
  });

  it("fails closed when component props contain additional fields", () => {
    const result = validateDashboardConfig(
      singleSectionConfig({
        id: "state",
        type: "state.hero",
        schemaVersion: "1.0",
        layout: { columnSpan: { sm: 4, md: 4, lg: 4 } },
        props: {
          status: "BUILD",
          confidence: 0.8,
          summary: "Valid visible text",
          arbitraryJavaScript: "window.location='https://example.invalid'",
        },
      }),
      capabilities,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections[0]).toMatchObject({
        kind: "fallback",
        reason: "component.invalid-props",
      });
    }
  });

  it("fails closed when a required capability is unavailable", () => {
    const result = validateDashboardConfig(
      singleSectionConfig({
        id: "audio",
        type: "audio.control",
        schemaVersion: "1.0",
        layout: { columnSpan: { sm: 4, md: 4, lg: 4 } },
        props: { playing: false, volume: 20, muted: false },
      }),
      new Set<RegistryCapability>(["effect.audio:read"]),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections[0]).toMatchObject({
        kind: "fallback",
        reason: "component.missing-capability",
      });
    }
  });
});
