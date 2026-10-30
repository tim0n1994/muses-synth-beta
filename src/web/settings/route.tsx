import { AuthChrome, resolveBrowserLanguage } from "../auth/index.js";
import { I18nProvider } from "../i18n/index.js";
import { SettingsWorkspace } from "./SettingsWorkspace";

export function SettingsRoute(): React.JSX.Element {
  return (
    <I18nProvider lang={resolveBrowserLanguage()}>
      <AuthChrome>
        <SettingsWorkspace />
      </AuthChrome>
    </I18nProvider>
  );
}
