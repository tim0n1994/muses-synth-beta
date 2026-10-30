/**
 * Runtime for the web message catalogs.
 *
 * English is canonical: `en` defines the key set, every other locale is
 * `Record<MessageKey, string>`, and `createTranslator` falls back to the
 * English value when a locale is missing a key at runtime (defense in depth
 * on top of the compile-time check).
 */
import { en, type MessageKey } from "./locales/en";
import { zh } from "./locales/zh";
import { ja } from "./locales/ja";
import { fr } from "./locales/fr";
import { es } from "./locales/es";

export type { MessageKey };

/** Supported interface languages. English is the default. */
export type LanguageCode = "en" | "zh" | "ja" | "fr" | "es";

export const DEFAULT_LANGUAGE: LanguageCode = "en";

export const LOCALES: readonly LanguageCode[] = [
  "en",
  "zh",
  "ja",
  "fr",
  "es",
] as const;

/**
 * Each language shown in its own script in the switcher, so the list is
 * identical in every locale by design.
 */
export const LOCALE_NATIVE_NAMES: Readonly<Record<LanguageCode, string>> = {
  en: "English",
  zh: "简体中文",
  ja: "日本語",
  fr: "Français",
  es: "Español",
};

/** Explicit BCP-47 tags so date formatting does not depend on the host OS. */
export const LOCALE_INTL_TAGS: Readonly<Record<LanguageCode, string>> = {
  en: "en-US",
  zh: "zh-CN",
  ja: "ja-JP",
  fr: "fr-FR",
  es: "es-ES",
};

const CATALOGS: Readonly<Record<LanguageCode, Record<MessageKey, string>>> = {
  en,
  zh,
  ja,
  fr,
  es,
};

export function isLanguageCode(value: unknown): value is LanguageCode {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/** Anything unknown — a stale persisted value, a typo — resolves to English. */
export function resolveLocale(value: unknown): LanguageCode {
  return isLanguageCode(value) ? value : DEFAULT_LANGUAGE;
}

export type Translator = (
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
) => string;

function interpolate(
  template: string,
  params: Readonly<Record<string, string | number>> | undefined,
): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

export function createTranslator(locale: LanguageCode): Translator {
  const catalog = CATALOGS[locale];
  return (key, params) => {
    const template = catalog[key] ?? en[key] ?? key;
    return interpolate(template, params);
  };
}

/** Locale-aware date/time helper for the raw ISO strings the server sends. */
export function formatDateTime(value: string, locale: LanguageCode): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(LOCALE_INTL_TAGS[locale], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
