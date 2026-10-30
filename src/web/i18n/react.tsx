/**
 * React binding for the message catalogs.
 *
 * `useI18n` deliberately falls back to English when no provider is mounted:
 * the foundation error boundary and the registry components must render
 * standalone (stories, isolated tests, fatal-shell mode) without a provider
 * in scope.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  createTranslator,
  DEFAULT_LANGUAGE,
  resolveLocale,
  type LanguageCode,
  type Translator,
} from "./core";

export interface I18nContextValue {
  readonly lang: LanguageCode;
  readonly t: Translator;
}

const FALLBACK_CONTEXT: I18nContextValue = {
  lang: DEFAULT_LANGUAGE,
  t: createTranslator(DEFAULT_LANGUAGE),
};

const I18nContext = createContext<I18nContextValue>(FALLBACK_CONTEXT);

export interface I18nProviderProps {
  readonly lang: LanguageCode;
  readonly children: ReactNode;
}

export function I18nProvider({
  lang,
  children,
}: I18nProviderProps): React.JSX.Element {
  const value = useMemo<I18nContextValue>(() => {
    const resolved = resolveLocale(lang);
    return { lang: resolved, t: createTranslator(resolved) };
  }, [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
