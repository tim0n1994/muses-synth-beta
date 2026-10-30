import {
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button, Card } from "../design-system";
import {
  featureSurfaceChangedForSession,
  rebootInto,
} from "../foundation/feature-flags";
import { useI18n } from "../i18n";
import { authApi } from "./api-client";
import { setStoredSession } from "./auth-store";
import { describeAuthError } from "./error-text";
import "./auth.css";

/** Only same-app paths qualify; blocks protocol-relative open redirects. */
export function sanitizeReturnUrl(raw: string | null): string {
  if (
    raw === null ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.startsWith("/\\")
  ) {
    return "/";
  }
  return raw;
}

export function LoginPage(): ReactNode {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const target = sanitizeReturnUrl(searchParams.get("returnUrl"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const session = await authApi.login(email, password);
      setStoredSession(session);
      // The v0.7 client routes were decided at boot for the signed-out
      // visitor (Round-2 per-user allowlist). If the server answers this
      // account a different surface, a client-side navigation would keep
      // the stale route table — boot again instead.
      if (await featureSurfaceChangedForSession()) {
        rebootInto(target);
        return;
      }
      void navigate(target, { replace: true });
    } catch (caught) {
      setError(describeAuthError(caught, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page auth-scope">
      <Card className="auth-card" elevation="raised">
        <h1 className="auth-title">{t("auth.login.title")}</h1>
        <p className="auth-subtitle">{t("auth.login.subtitle")}</p>
        <form
          className="auth-form"
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label className="auth-field" htmlFor="login-email">
            <span className="auth-field__label">
              {t("auth.login.emailLabel")}
            </span>
            <input
              autoComplete="email"
              className="auth-input"
              id="login-email"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setEmail(event.target.value)
              }
              required
              type="email"
              value={email}
            />
          </label>
          <label className="auth-field" htmlFor="login-password">
            <span className="auth-field__label">
              {t("auth.login.passwordLabel")}
            </span>
            <input
              autoComplete="current-password"
              className="auth-input"
              id="login-password"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPassword(event.target.value)
              }
              required
              type="password"
              value={password}
            />
          </label>
          {error === null ? null : (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <Button disabled={submitting} type="submit" variant="primary">
            {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
          </Button>
        </form>
        <p className="auth-switch">
          <Link to="/register">{t("auth.login.toRegister")}</Link>
        </p>
      </Card>
    </main>
  );
}
