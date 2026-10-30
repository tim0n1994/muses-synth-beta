/**
 * fetch client for the auth/admin API surface.
 *
 * Same-origin (`API_BASE` stays empty), attaches the session bearer token
 * automatically, and normalizes error envelopes to `AuthApiError` for both
 * shapes the backend can emit: `{ error: { code, message } }` and the flat
 * Muses `{ code, message }`.
 *
 * A 401 on any session path clears the stored session and hands off to the
 * unauthorized handler (default: full-page redirect to `/login` with the
 * current location as returnUrl). The four endpoints the login/register
 * pages call themselves are exempt, so a failed sign-in renders its form
 * error instead of bouncing to /login in a loop.
 */
import { clearStoredSession, getStoredToken } from "./auth-store";
import {
  parseUser,
  type AuthResult,
  type SendCodeResult,
  type StatusResult,
  type User,
} from "./types";

/** Empty = same-origin `/api` (vite proxy / production static server). */
const API_BASE = "";

const PUBLIC_AUTH_PATHS: ReadonlySet<string> = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/send-code",
  "/api/auth/reset-password",
]);

export class AuthApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
    this.status = status;
  }
}

export type UnauthorizedHandler = (path: string) => void;

function defaultUnauthorizedHandler(): void {
  const current = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?returnUrl=${encodeURIComponent(current)}`);
}

let unauthorizedHandler: UnauthorizedHandler = defaultUnauthorizedHandler;

/** Swap the 401 handler (used by tests); returns a restore function. */
export function setUnauthorizedHandler(
  handler: UnauthorizedHandler,
): () => void {
  const previous = unauthorizedHandler;
  unauthorizedHandler = handler;
  return () => {
    unauthorizedHandler = previous;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseErrorBody(body: unknown, status: number): AuthApiError {
  const fallback = new AuthApiError(
    `HTTP_${status}`,
    `Request failed with status ${status}`,
    status,
  );
  if (!isRecord(body)) {
    return fallback;
  }
  // `{ error: { code, message } }` envelope or flat `{ code, message }`.
  const envelope = isRecord(body.error) ? body.error : body;
  const code = typeof envelope.code === "string" ? envelope.code : undefined;
  const message =
    typeof envelope.message === "string"
      ? envelope.message
      : typeof body.error === "string"
        ? body.error
        : undefined;
  if (code === undefined && message === undefined) {
    return fallback;
  }
  return new AuthApiError(
    code ?? "REQUEST_FAILED",
    message ?? `Request failed with status ${status}`,
    status,
  );
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

interface AuthRequestOptions {
  readonly body?: unknown;
  readonly method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
}

export async function authRequest<T>(
  path: string,
  options: AuthRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const token = getStoredToken();
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });

  if (!response.ok) {
    if (response.status === 401 && !PUBLIC_AUTH_PATHS.has(path)) {
      clearStoredSession();
      unauthorizedHandler(path);
    }
    throw parseErrorBody(await readBody(response), response.status);
  }
  if (response.status === 204) {
    return null as T;
  }
  return (await readBody(response)) as T;
}

function parseAuthResult(value: unknown): AuthResult {
  if (!isRecord(value) || typeof value.token !== "string") {
    throw new AuthApiError(
      "INVALID_RESPONSE",
      "Expected an auth result with a token",
      0,
    );
  }
  if (value.token.length === 0) {
    throw new AuthApiError(
      "INVALID_RESPONSE",
      "Expected a non-empty session token",
      0,
    );
  }
  return { token: value.token, user: parseUser(value.user) };
}

export const authApi = {
  /** Send an email verification code. dev/console transports return devCode. */
  sendCode: (
    email: string,
    purpose: "register" | "reset" = "register",
  ): Promise<SendCodeResult> =>
    authRequest<SendCodeResult>("/api/auth/send-code", {
      body: { email, purpose },
      method: "POST",
    }),

  /** Email-code registration; returns the session on success. */
  register: (
    email: string,
    code: string,
    password: string,
    displayName?: string,
  ): Promise<AuthResult> =>
    authRequest<unknown>("/api/auth/register", {
      body: {
        email,
        code,
        password,
        ...(displayName === undefined ? {} : { displayName }),
      },
      method: "POST",
    }).then(parseAuthResult),

  /** Password login; returns the JWT session. */
  login: (email: string, password: string): Promise<AuthResult> =>
    authRequest<unknown>("/api/auth/login", {
      body: { email, password },
      method: "POST",
    }).then(parseAuthResult),

  resetPassword: (
    email: string,
    code: string,
    newPassword: string,
  ): Promise<StatusResult> =>
    authRequest<StatusResult>("/api/auth/reset-password", {
      body: { email, code, newPassword },
      method: "POST",
    }),

  /** Exchange the stored token for the current user. */
  me: (): Promise<{ user: User }> =>
    authRequest<{ user: unknown }>("/api/auth/me").then((body) => ({
      user: parseUser(body.user),
    })),

  updateProfile: (data: { displayName?: string }): Promise<{ user: User }> =>
    authRequest<{ user: unknown }>("/api/auth/me", {
      body: data,
      method: "PUT",
    }).then((body) => ({ user: parseUser(body.user) })),

  changePassword: (
    oldPassword: string,
    newPassword: string,
  ): Promise<StatusResult> =>
    authRequest<StatusResult>("/api/auth/me/password", {
      body: { oldPassword, newPassword },
      method: "PUT",
    }),
};

export const adminApi = {
  listUsers: (): Promise<readonly User[]> =>
    authRequest<{ users?: unknown }>("/api/admin/users").then((body) => {
      const list = Array.isArray(body?.users) ? body.users : [];
      return list.map((entry) => parseUser(entry));
    }),

  updateUser: (userId: string, data: { isActive: boolean }): Promise<User> =>
    authRequest<{ user?: unknown }>(
      `/api/admin/users/${encodeURIComponent(userId)}`,
      { body: data, method: "PATCH" },
    ).then((body) => parseUser(body?.user)),

  deleteUser: (userId: string): Promise<StatusResult> =>
    authRequest<StatusResult>(
      `/api/admin/users/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
};
