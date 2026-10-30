import type { ReactNode } from "react";

import {
  DEFAULT_LANGUAGE,
  I18nProvider,
  isLanguageCode,
  type LanguageCode,
} from "../i18n";
import { AuthChrome } from "./AuthChrome";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { UsersAdminView } from "./UsersAdminView";

/**
 * Pre-auth pages have no published settings release to read a language from,
 * so the browser locale is the only signal available; the dashboard and
 * settings surfaces keep owning the language once the user is inside.
 */
export function resolveBrowserLanguage(): LanguageCode {
  const candidate = navigator.languages?.[0] ?? navigator.language;
  const prefix = typeof candidate === "string" ? candidate.slice(0, 2) : "";
  return isLanguageCode(prefix) ? prefix : DEFAULT_LANGUAGE;
}

export function LoginRoute(): ReactNode {
  return (
    <I18nProvider lang={resolveBrowserLanguage()}>
      <LoginPage />
    </I18nProvider>
  );
}

export function RegisterRoute(): ReactNode {
  return (
    <I18nProvider lang={resolveBrowserLanguage()}>
      <RegisterPage />
    </I18nProvider>
  );
}

export function AdminUsersRoute(): ReactNode {
  return (
    <I18nProvider lang={resolveBrowserLanguage()}>
      <AuthChrome requireAdmin>
        <UsersAdminView />
      </AuthChrome>
    </I18nProvider>
  );
}
