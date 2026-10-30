import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button, Card } from "../design-system";
import { useI18n } from "../i18n";
import { authApi } from "./api-client";
import { setStoredSession } from "./auth-store";
import { describeAuthError } from "./error-text";
import { sanitizeReturnUrl } from "./LoginPage";
import "./auth.css";

const RESEND_SECONDS = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

type RegisterStep = 1 | 2 | 3;

const STEP_LABEL_KEYS = [
  "auth.register.stepEmail",
  "auth.register.stepVerify",
  "auth.register.stepDone",
] as const;

/**
 * Three-step registration: email → code + password + display name → done.
 * The send-code response may carry `devCode` (console/dev email transport);
 * we surface it so local flows can finish without a real inbox.
 */
export function RegisterPage(): ReactNode {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const target = sanitizeReturnUrl(searchParams.get("returnUrl"));
  const [step, setStep] = useState<RegisterStep>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [welcomeName, setWelcomeName] = useState("");

  useEffect(() => {
    if (resendIn <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setResendIn((seconds) => seconds - 1);
    }, 1_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [resendIn]);

  async function sendCode(): Promise<void> {
    if (sending) {
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setError(t("auth.register.invalidEmail"));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const result = await authApi.sendCode(email, "register");
      setDevCode(typeof result.devCode === "string" ? result.devCode : null);
      setResendIn(RESEND_SECONDS);
      setStep(2);
    } catch (caught) {
      setError(describeAuthError(caught, t));
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    if (code.trim().length === 0) {
      setError(t("auth.register.codeRequired"));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("auth.register.passwordTooShort"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const session = await authApi.register(
        email,
        code.trim(),
        password,
        displayName.trim() === "" ? undefined : displayName.trim(),
      );
      setStoredSession(session);
      setWelcomeName(
        session.user.displayName === "" ? email : session.user.displayName,
      );
      setStep(3);
    } catch (caught) {
      setError(describeAuthError(caught, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page auth-scope">
      <Card className="auth-card" elevation="raised">
        <h1 className="auth-title">{t("auth.register.title")}</h1>
        <p className="auth-subtitle">{t("auth.register.subtitle")}</p>
        <ol aria-label={t("auth.register.stepsAria")} className="auth-steps">
          {STEP_LABEL_KEYS.map((key, index) => (
            <li
              key={key}
              {...(step === index + 1 ? { "aria-current": "step" } : {})}
            >
              {`${index + 1}. ${t(key)}`}
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <form
            className="auth-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <label className="auth-field" htmlFor="register-email">
              <span className="auth-field__label">
                {t("auth.register.emailLabel")}
              </span>
              <input
                autoComplete="email"
                className="auth-input"
                id="register-email"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setEmail(event.target.value)
                }
                placeholder={t("auth.register.emailPlaceholder")}
                required
                type="email"
                value={email}
              />
            </label>
            {error === null ? null : (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <Button disabled={sending} type="submit" variant="primary">
              {sending
                ? t("auth.register.sending")
                : t("auth.register.sendCode")}
            </Button>
          </form>
        ) : null}

        {step === 2 ? (
          <form
            className="auth-form"
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
          >
            <p className="auth-hint" role="status">
              {t("auth.register.codeSent")}
            </p>
            {devCode === null ? null : (
              <p className="auth-devcode">
                {t("auth.register.devCode", { code: devCode })}
              </p>
            )}
            <label className="auth-field" htmlFor="register-code">
              <span className="auth-field__label">
                {t("auth.register.codeLabel")}
              </span>
            </label>
            <div className="auth-code-row">
              <input
                aria-label={t("auth.register.codeLabel")}
                autoComplete="one-time-code"
                className="auth-input"
                id="register-code"
                inputMode="numeric"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setCode(event.target.value)
                }
                placeholder={t("auth.register.codePlaceholder")}
                value={code}
              />
              <Button
                disabled={sending || resendIn > 0}
                onClick={() => void sendCode()}
              >
                {resendIn > 0
                  ? t("auth.register.resendIn", { seconds: resendIn })
                  : sending
                    ? t("auth.register.sending")
                    : t("auth.register.resend")}
              </Button>
            </div>
            <div className="auth-field">
              <label className="auth-field__label" htmlFor="register-password">
                {t("auth.register.passwordLabel")}
              </label>
              <input
                autoComplete="new-password"
                className="auth-input"
                id="register-password"
                minLength={MIN_PASSWORD_LENGTH}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setPassword(event.target.value)
                }
                required
                type="password"
                value={password}
              />
              <span className="auth-field__hint">
                {t("auth.register.passwordHint")}
              </span>
            </div>
            <label className="auth-field" htmlFor="register-display-name">
              <span className="auth-field__label">
                {t("auth.register.displayNameLabel")}
              </span>
              <input
                autoComplete="nickname"
                className="auth-input"
                id="register-display-name"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setDisplayName(event.target.value)
                }
                placeholder={t("auth.register.displayNamePlaceholder")}
                value={displayName}
              />
            </label>
            {error === null ? null : (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <Button disabled={submitting} type="submit" variant="primary">
              {submitting
                ? t("auth.register.submitting")
                : t("auth.register.submit")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStep(1);
                setError(null);
              }}
            >
              {t("auth.register.changeEmail")}
            </Button>
          </form>
        ) : null}

        {step === 3 ? (
          <div className="auth-form">
            <h2 className="auth-done-title">{t("auth.register.doneTitle")}</h2>
            <p className="auth-hint" role="status">
              {t("auth.register.doneBody", { name: welcomeName })}
            </p>
            <Button
              variant="primary"
              onClick={() => {
                void navigate(target, { replace: true });
              }}
            >
              {t("auth.register.continue")}
            </Button>
          </div>
        ) : null}

        <p className="auth-switch">
          <Link to="/login">{t("auth.register.toLogin")}</Link>
        </p>
      </Card>
    </main>
  );
}
