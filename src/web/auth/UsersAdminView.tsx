import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Badge, Button, Card } from "../design-system";
import { formatDateTime, useI18n } from "../i18n";
import { adminApi } from "./api-client";
import { useAuthSession } from "./auth-store";
import { describeAuthError } from "./error-text";
import type { User } from "./types";
import "./auth.css";

type LoadState = "loading" | "ready" | "failed";

/**
 * Admin-only user management: list + activate/deactivate + delete with an
 * inline two-step confirmation. Own account rows are view-only so an admin
 * can never lock themselves out of the instance.
 */
export function UsersAdminView(): ReactNode {
  const { t, lang } = useI18n();
  const currentUser = useAuthSession()?.user ?? null;
  const [users, setUsers] = useState<readonly User[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadState("loading");
    setError(null);
    try {
      setUsers(await adminApi.listUsers());
      setLoadState("ready");
    } catch (caught) {
      setError(describeAuthError(caught, t));
      setLoadState("failed");
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the external user-list request lifecycle (loading → ready/failed).
    void load();
  }, [load]);

  const handleToggleActive = useCallback(
    async (user: User): Promise<void> => {
      setActionId(user.id);
      setError(null);
      try {
        const updated = await adminApi.updateUser(user.id, {
          isActive: !user.isActive,
        });
        setUsers((previous) =>
          previous.map((entry) => (entry.id === user.id ? updated : entry)),
        );
      } catch (caught) {
        setError(describeAuthError(caught, t));
      } finally {
        setActionId(null);
      }
    },
    [t],
  );

  const handleDelete = useCallback(
    async (userId: string): Promise<void> => {
      setActionId(userId);
      setError(null);
      try {
        await adminApi.deleteUser(userId);
        setUsers((previous) => previous.filter((entry) => entry.id !== userId));
        setConfirmDeleteId(null);
      } catch (caught) {
        setError(describeAuthError(caught, t));
      } finally {
        setActionId(null);
      }
    },
    [t],
  );

  return (
    <main className="auth-admin auth-scope">
      <header className="auth-admin__header">
        <h1>{t("auth.admin.title")}</h1>
        <p>{t("auth.admin.subtitle")}</p>
      </header>

      <div className="auth-admin-stats">
        <Stat label={t("auth.admin.statsTotal")} value={users.length} />
        <Stat
          label={t("auth.admin.statsAdmins")}
          value={users.filter((user) => user.role === "admin").length}
        />
        <Stat
          label={t("auth.admin.statsDisabled")}
          value={users.filter((user) => !user.isActive).length}
        />
      </div>

      {error === null ? null : (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {loadState === "loading" ? (
        <p className="auth-admin__state" role="status">
          {t("auth.admin.loading")}
        </p>
      ) : loadState === "failed" ? (
        <Button onClick={() => void load()} variant="secondary">
          {t("common.retry")}
        </Button>
      ) : users.length === 0 ? (
        <Card className="auth-admin__empty">
          <p className="auth-subtitle">{t("auth.admin.empty")}</p>
        </Card>
      ) : (
        <Card className="auth-admin__tablewrap" elevation="flat">
          <table className="auth-admin-table">
            <thead>
              <tr>
                <th scope="col">{t("auth.admin.colUser")}</th>
                <th scope="col">{t("auth.admin.colRole")}</th>
                <th scope="col">{t("auth.admin.colStatus")}</th>
                <th scope="col">{t("auth.admin.colCreatedAt")}</th>
                <th scope="col">{t("auth.admin.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf =
                  currentUser !== null && currentUser.id === user.id;
                const isConfirming = confirmDeleteId === user.id;
                return (
                  <tr key={user.id} data-inactive={!user.isActive}>
                    <td>
                      <div className="auth-user-cell">
                        <span>
                          {user.displayName === ""
                            ? user.email
                            : user.displayName}
                        </span>
                        {user.displayName === "" ? null : (
                          <span className="auth-user-cell__email">
                            {user.email}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {user.role === "admin" ? (
                        <Badge tone="accent">{t("auth.admin.roleAdmin")}</Badge>
                      ) : (
                        <Badge>{t("auth.admin.roleUser")}</Badge>
                      )}
                    </td>
                    <td>
                      {user.isActive ? (
                        <Badge tone="positive">{t("auth.admin.active")}</Badge>
                      ) : (
                        <Badge tone="danger">{t("auth.admin.disabled")}</Badge>
                      )}
                    </td>
                    <td>
                      {user.createdAt === ""
                        ? "—"
                        : formatDateTime(user.createdAt, lang)}
                    </td>
                    <td>
                      <div className="auth-admin-actions">
                        {actionId === user.id ? (
                          <span
                            aria-live="polite"
                            className="auth-admin__processing"
                          >
                            {t("auth.admin.processing")}
                          </span>
                        ) : (
                          <>
                            <Button
                              disabled={isSelf}
                              onClick={() => void handleToggleActive(user)}
                              title={
                                isSelf
                                  ? t("auth.admin.selfProtected")
                                  : undefined
                              }
                              variant="secondary"
                            >
                              {user.isActive
                                ? t("auth.admin.deactivate")
                                : t("auth.admin.activate")}
                            </Button>
                            {isConfirming ? (
                              <>
                                <Button
                                  disabled={isSelf}
                                  onClick={() => void handleDelete(user.id)}
                                  variant="danger"
                                >
                                  {t("auth.admin.confirmDelete")}
                                </Button>
                                <Button
                                  onClick={() => setConfirmDeleteId(null)}
                                  variant="secondary"
                                >
                                  {t("common.cancel")}
                                </Button>
                              </>
                            ) : (
                              <Button
                                disabled={isSelf}
                                onClick={() => setConfirmDeleteId(user.id)}
                                title={
                                  isSelf
                                    ? t("auth.admin.selfProtected")
                                    : undefined
                                }
                                variant="danger"
                              >
                                {t("auth.admin.delete")}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): ReactNode {
  return (
    <div className="auth-admin-stat">
      <p className="auth-admin-stat__value">{value}</p>
      <p className="auth-admin-stat__label">{label}</p>
    </div>
  );
}
