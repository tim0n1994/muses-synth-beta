import { describe, expect, it } from "vitest";

import {
  clockToMinutes,
  createWidget,
  isSettingsDocument,
  isSettingsSnapshot,
  minutesToClock,
  validateSettingsDocument,
} from "../model/document";
import { baseDocument, settingsSnapshot } from "../test/fixtures";

describe("settings document preflight", () => {
  it("accepts the default document", () => {
    expect(validateSettingsDocument(baseDocument)).toEqual([]);
  });

  it("requires UNKNOWN to stay silent", () => {
    const document = structuredClone(baseDocument);
    const unknown = document.audio.profiles.find(
      (profile) => profile.state === "UNKNOWN",
    );
    if (unknown === undefined) {
      throw new Error("fixture must contain an UNKNOWN profile");
    }
    unknown.targetGain = 0.4;

    expect(
      validateSettingsDocument(document).map((violation) => violation.code),
    ).toContain("UNKNOWN_NOT_SILENT");
  });

  it("rejects duplicate widget ids", () => {
    const document = structuredClone(baseDocument);
    const [first] = document.surface.widgets;
    if (first === undefined) {
      throw new Error("fixture must contain a widget");
    }
    document.surface.widgets = [first, structuredClone(first)];

    expect(
      validateSettingsDocument(document).map((violation) => violation.code),
    ).toContain("DUPLICATE_WIDGET");
  });

  it("gives every new widget a free id", () => {
    const widgets = structuredClone(baseDocument.surface.widgets);

    const first = createWidget("state.hero", widgets);
    expect(widgets.some((widget) => widget.id === first.id)).toBe(false);

    // Adding the same type again must not collide with the one just added:
    // duplicate ids fail server validation.
    const second = createWidget("state.hero", [...widgets, first]);
    expect(second.id).not.toBe(first.id);
  });

  it("round-trips quiet-hours clock values", () => {
    expect(minutesToClock(1_320)).toBe("22:00");
    expect(clockToMinutes("22:00")).toBe(1_320);
    expect(clockToMinutes("24:00")).toBeNull();
    expect(clockToMinutes("nonsense")).toBeNull();
  });

  it("recognises a real snapshot payload", () => {
    expect(isSettingsSnapshot(settingsSnapshot)).toBe(true);
    expect(isSettingsSnapshot({ draft: {}, currentRelease: {} })).toBe(false);
  });

  it("mirrors the server's llm section and defaults it to off", () => {
    // Optional enhancement: the fixture must carry the same disabled default
    // as the server seed, and a v2-shaped document without the section is no
    // longer accepted by the (shallow) web guard.
    expect(baseDocument.llm).toEqual({ enabled: false, model: "auto" });
    const withoutLlm = structuredClone(baseDocument);
    delete (withoutLlm as { llm?: unknown }).llm;
    expect(isSettingsDocument(withoutLlm)).toBe(false);
  });

  it("round-trips an enabled llm section without web-preflight violations", () => {
    const document = structuredClone(baseDocument);
    document.llm = { enabled: true, model: "gateway-alias" };
    expect(validateSettingsDocument(document)).toEqual([]);
  });

  it("creates the llm narration widget with model attribution on", () => {
    const widget = createWidget("llm.narration", []);
    expect(widget).toEqual({
      id: "llm-narration",
      type: "llm.narration",
      showModel: true,
    });
  });
});
