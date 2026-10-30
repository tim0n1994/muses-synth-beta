import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button, Card } from "../design-system";
import { useI18n } from "../i18n";
import { authApi, AuthApiError } from "./api-client";
import {
  clearStoredSession,
  setStoredUser,
  useAuthSession,
} from "./auth-store";
import "./auth.css";

type GateStatus = "checking" | "open" | "locked" | "denied";

export interface AuthChromeProps {
  readonly children: ReactNode;
  /** Render the admin denial card unless the session user is an admin. */
  readonly requireAdmin?: boolean;
}

/**
 * Route-level auth shell, mounted around the dashboard and settings pages.
 *
 * On mount it probes `GET /api/auth/me`:
 * - 200 → auth is on and the session is valid: session bar + children;
 * - 401 → auth is on but nobody valid is signed in. The api client already
 *   cleared the session and started the /login redirect, so we hold the
 *   checking state instead of flashing protected content;
 * - anything else (404 on a backend built without auth, network down) →
 *   the local app stays open. Muses must never lock itself out.
 */
export function AuthChrome({
  children,
  requireAdmin = false,
}: AuthChromeProps): ReactNode {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [status, setStatus] = useState<GateStatus>("checking");
  const session = useAuthSession();

  useEffect(() => {
    let cancelled = false;
    const evaluate = (role: "admin" | "user" | null): void => {
      if (cancelled) {
        return;
      }
      setStatus(requireAdmin && role !== "admin" ? "denied" : "open");
    };

    authApi
      .me()
      .then(({ user }) => {
        setStoredUser(user);
        evaluate(user.role);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthApiError && error.status === 401) {
          setStatus("locked");
          return;
        }
        evaluate(null);
      });

    return () => {
      cancelled = true;
    };
  }, [requireAdmin]);

  if (status === "checking" || status === "locked") {
    return (
      <main className="auth-gate" aria-live="polite">
        <p>{t("auth.gate.checking")}</p>
      </main>
    );
  }

  if (status === "denied") {
    return (
      <main className="auth-page auth-scope">
        <Card className="auth-card" elevation="raised">
          <h1 className="auth-title">{t("auth.admin.deniedTitle")}</h1>
          <p className="auth-subtitle">{t("auth.admin.deniedBody")}</p>
          <Button
            variant="primary"
            onClick={() => {
              void navigate("/login");
            }}
          >
            {t("auth.login.title")}
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <>
      {session === null ? null : (
        <div className="auth-sessionbar auth-scope">
          <span className="auth-sessionbar__email">{session.user.email}</span>
          <Link className="auth-sessionbar__link" to="/settings">
            {t("auth.session.settingsLink")}
          </Link>
          {session.user.role === "admin" ? (
            <Link className="auth-sessionbar__link" to="/admin/users">
              {t("auth.session.adminLink")}
            </Link>
          ) : null}
          <Button
            className="auth-sessionbar__signout"
            onClick={() => {
              clearStoredSession();
              void navigate("/login");
            }}
          >
            {t("auth.session.signOut")}
          </Button>
        </div>
      )}
      {children}
    </>
  );
}
