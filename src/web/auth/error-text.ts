/**
 * Maps auth API failures to user-facing text: known session codes get a
 * translated sentence, everything else keeps the server's message.
 */
import type { Translator } from "../i18n";

import { AuthApiError } from "./api-client";

export function describeAuthError(error: unknown, t: Translator): string {
  if (error instanceof AuthApiError) {
    if (error.code === "AUTH_REQUIRED") {
      return t("auth.error.sessionExpired");
    }
    return error.message;
  }
  return t("auth.error.network");
}
