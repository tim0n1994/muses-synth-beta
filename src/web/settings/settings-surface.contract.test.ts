import { describe, expect, it } from "vitest";

import {
  BELIEF_STATE_NAMES,
  BELIEF_VOCABULARY,
} from "../../server/belief/vocabulary.js";
import { DEFAULT_SETTINGS } from "../../server/settings/default-settings.js";
import {
  parseSettings,
  SETTINGS_SCHEMA_VERSION as SERVER_SCHEMA_VERSION,
  validateSettings,
} from "../../server/settings/schema.js";
import {
  isSettingsDocument,
  SETTINGS_SCHEMA_VERSION as WEB_SCHEMA_VERSION,
  validateSettingsDocument,
  WIDGET_DEFINITIONS,
  type SettingsDocument,
} from "./model/document";
import { baseDocument } from "./test/fixtures";

/**
 * The settings document is the one structure the browser and the local server
 * both hold an opinion about. v0.1 shipped two incompatible vocabularies for
 * it — server `profile/belief/decision/signals/audio/privacy/surface` versus
 * web `appearance/dashboard/context/audio/policy/privacy` — and the settings
 * page 404'd and mis-shaped every payload as a result. PRD-v0.3 decision 1
 * made the server canonical; these tests are what keep it that way.
 */
describe("settings document contract", () => {
  it("agrees on the schema version", () => {
    expect(WEB_SCHEMA_VERSION).toBe(SERVER_SCHEMA_VERSION);
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(WEB_SCHEMA_VERSION);
  });

  it("accepts the server's own default document on the web side", () => {
    expect(isSettingsDocument(DEFAULT_SETTINGS)).toBe(true);
    expect(
      validateSettingsDocument(DEFAULT_SETTINGS as unknown as SettingsDocument),
    ).toEqual([]);
  });

  it("keeps the web test fixture identical to the server default", () => {
    // Drift here is exactly how the two vocabularies grew apart last time.
    expect(baseDocument).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a web-built document through server validation", () => {
    const edited: SettingsDocument = {
      ...baseDocument,
      appearance: { ...baseDocument.appearance, theme: "dark" },
      decision: {
        ...baseDocument.decision,
        quietHours: {
          enabled: true,
          startMinuteInclusive: 1_320,
          endMinuteExclusive: 480,
        },
      },
    };

    expect(validateSettings(edited).valid).toBe(true);
    expect(parseSettings(edited).appearance.theme).toBe("dark");
  });

  it("publishes only widget types the server schema accepts", () => {
    for (const definition of WIDGET_DEFINITIONS) {
      const candidate = {
        ...baseDocument,
        surface: { widgets: [definition.create("contract-probe")] },
      };

      const result = validateSettings(candidate);
      expect(
        result.issues,
        `${definition.type} produced server validation issues`,
      ).toEqual([]);
    }
  });

  it("keeps the optional llm widget and section valid on both sides", () => {
    // The optional-enhancement pair: an llm section (enabled, alias model)
    // plus an llm.narration widget must survive the full server schema, and
    // the web mirror must expose the widget definition that creates it.
    const definition = WIDGET_DEFINITIONS.find(
      (candidate) => candidate.type === "llm.narration",
    );
    if (definition === undefined) {
      throw new Error("llm.narration widget definition missing");
    }

    const candidate = {
      ...baseDocument,
      llm: { enabled: true, model: "gateway-alias" },
      surface: { widgets: [definition.create("llm-probe")] },
    };
    expect(validateSettings(candidate).valid).toBe(true);

    const invalid = {
      ...baseDocument,
      llm: { enabled: true, model: "not a valid alias" },
    };
    expect(validateSettings(invalid).valid).toBe(false);
  });

  it("keeps the settings state list a subset of the engine vocabulary", () => {
    // The engine reports eight states; the settings document configures seven.
    // `SETUP` is engine-internal and never drives audio, which is recorded on
    // the canonical table rather than left as an undocumented mismatch.
    for (const state of DEFAULT_SETTINGS.belief.states) {
      const descriptor = BELIEF_VOCABULARY[state];
      expect(descriptor, `${state} is not a known belief state`).toBeDefined();
      expect(
        descriptor.configurable,
        `${state} is published in settings but marked non-configurable`,
      ).toBe(true);
    }
    const nonConfigurable = BELIEF_STATE_NAMES.filter(
      (name) => !BELIEF_VOCABULARY[name].configurable,
    );
    expect(nonConfigurable).toEqual(["SETUP"]);
  });

  it("rejects a document the web preflight also rejects", () => {
    const broken: SettingsDocument = {
      ...baseDocument,
      audio: {
        ...baseDocument.audio,
        profiles: baseDocument.audio.profiles.map((profile) =>
          profile.state === "UNKNOWN"
            ? { ...profile, targetGain: 0.5 }
            : profile,
        ),
      },
    };

    expect(validateSettingsDocument(broken)).not.toEqual([]);
    expect(validateSettings(broken).valid).toBe(false);
  });
});
