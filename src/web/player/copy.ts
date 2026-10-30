/**
 * Player copy (five languages).
 *
 * Since the stage-3 integration the keys and translations live in the
 * shared catalogs (src/web/i18n/locales/*); this module is the typed
 * player-domain view over them, keeping the component-facing translator
 * API stable. English is canonical.
 */
import {
  createTranslator,
  resolveLocale,
  type LanguageCode,
} from "../i18n/index.js";

export const PLAYER_COPY_KEYS = [
  "player.title",
  "player.subtitle",
  "player.state.idle",
  "player.state.playing",
  "player.state.crossfading",
  "player.state.ended",
  "player.control.start",
  "player.control.stop",
  "player.control.skip",
  "player.nowPlaying.label",
  "player.attribution.label",
  "player.plan.localStubNotice",
] as const;

export type PlayerMessageKey = (typeof PLAYER_COPY_KEYS)[number];

export const PLAYER_COPY_CATALOGS: Readonly<
  Record<LanguageCode, Record<PlayerMessageKey, string>>
> = {
  en: catalogFor("en"),
  zh: catalogFor("zh"),
  ja: catalogFor("ja"),
  fr: catalogFor("fr"),
  es: catalogFor("es"),
};

function catalogFor(lang: LanguageCode): Record<PlayerMessageKey, string> {
  const translate = createTranslator(lang);
  return Object.fromEntries(
    PLAYER_COPY_KEYS.map((key) => [key, translate(key)]),
  ) as Record<PlayerMessageKey, string>;
}

export type PlayerTranslator = (key: PlayerMessageKey) => string;

export function createPlayerTranslator(lang: unknown): PlayerTranslator {
  const catalog = PLAYER_COPY_CATALOGS[resolveLocale(lang)];
  return (key) => catalog[key];
}
