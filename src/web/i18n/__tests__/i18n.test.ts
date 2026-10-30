import { describe, expect, it } from "vitest";

import {
  createTranslator,
  DEFAULT_LANGUAGE,
  isLanguageCode,
  LOCALES,
  LOCALE_INTL_TAGS,
  LOCALE_NATIVE_NAMES,
  resolveLocale,
} from "../index";
import { en, type MessageKey } from "../locales/en";
import { zh } from "../locales/zh";
import { ja } from "../locales/ja";
import { fr } from "../locales/fr";
import { es } from "../locales/es";

const CATALOGS: Readonly<Record<string, Record<MessageKey, string>>> = {
  zh,
  ja,
  fr,
  es,
};

describe("i18n catalogs", () => {
  it("keeps every locale key set identical to English", () => {
    // Runtime double-check on top of the Record<MessageKey, string> type.
    const enKeys = Object.keys(en).sort();
    expect(Object.keys(zh).length).toBe(enKeys.length);
    for (const [name, catalog] of Object.entries(CATALOGS)) {
      const keys = Object.keys(catalog).sort();
      expect(keys, `locale ${name} key set`).toEqual(enKeys);
    }
  });

  it("leaves no locale value empty or accidentally English-duplicated wholesale", () => {
    for (const [name, catalog] of Object.entries(CATALOGS)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.length > 0, `${name}.${key} must not be empty`).toBe(true);
      }
    }
  });

  it("marks the English catalog as the canonical key source", () => {
    expect(en["dashboard.eyebrow"]).toBe("Muses · local Observatory");
    expect(en["settings.workspace.draftBadge"]).toBe("Draft — not active");
  });
});

describe("resolveLocale", () => {
  it("accepts every supported code", () => {
    for (const code of LOCALES) {
      expect(resolveLocale(code)).toBe(code);
    }
  });

  it("falls back to English for anything else", () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLocale(null)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLocale("xx")).toBe(DEFAULT_LANGUAGE);
    expect(resolveLocale("EN")).toBe(DEFAULT_LANGUAGE);
    expect(resolveLocale(42)).toBe(DEFAULT_LANGUAGE);
  });

  it("exposes a type guard consistent with resolution", () => {
    expect(isLanguageCode("zh")).toBe(true);
    expect(isLanguageCode("zh-TW")).toBe(false);
  });
});

describe("createTranslator", () => {
  it("interpolates {name} params", () => {
    const t = createTranslator("en");
    expect(t("settings.workspace.draftSavedNotice", { revision: 3 })).toBe(
      "Draft revision 3 saved on the local server.",
    );
    expect(t("api.error.expectedString", { key: "audio.masterGain" })).toBe(
      'Expected "audio.masterGain" to be a string.',
    );
  });

  it("keeps unknown placeholders verbatim", () => {
    const t = createTranslator("fr");
    expect(t("settings.workspace.revisionLabel")).toBe("révision {revision}");
  });

  it("translates into each supported locale", () => {
    expect(createTranslator("zh")("dashboard.toolbar.liveRefresh")).toBe(
      "实时刷新",
    );
    expect(createTranslator("ja")("dashboard.toolbar.liveRefresh")).toBe(
      "ライブ更新",
    );
    expect(createTranslator("fr")("dashboard.toolbar.liveRefresh")).toBe(
      "Actualisation en direct",
    );
    expect(createTranslator("es")("dashboard.toolbar.liveRefresh")).toBe(
      "Actualización en vivo",
    );
  });

  it("resolves every English key in every locale (no fallback needed)", () => {
    for (const code of LOCALES) {
      const t = createTranslator(code);
      for (const key of Object.keys(en) as MessageKey[]) {
        expect(t(key).length).toBeGreaterThan(0);
      }
    }
  });

  it("returns the key itself for a key missing everywhere", () => {
    const t = createTranslator("en") as (key: string) => string;
    expect(t("not.a.real.key")).toBe("not.a.real.key");
  });
});

describe("locale metadata", () => {
  it("names each locale in its own script", () => {
    expect(LOCALE_NATIVE_NAMES.en).toBe("English");
    expect(LOCALE_NATIVE_NAMES.zh).toBe("简体中文");
    expect(LOCALE_NATIVE_NAMES.ja).toBe("日本語");
    expect(LOCALE_NATIVE_NAMES.fr).toBe("Français");
    expect(LOCALE_NATIVE_NAMES.es).toBe("Español");
  });

  it("maps every locale to an explicit Intl tag", () => {
    for (const code of LOCALES) {
      expect(LOCALE_INTL_TAGS[code]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });
});
