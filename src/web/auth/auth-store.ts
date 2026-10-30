/**
 * Session persistence for the auth module — no external state library.
 *
 * One JSON blob, `{ token, user }`, under the `muses_auth` localStorage key,
 * mirroring the zustand-persist semantics of the reference skill: token and
 * user persist together, logout clears both, and every mutation notifies
 * subscribers so React trees can bind through `useSyncExternalStore`.
 */
import { useSyncExternalStore } from "react";

import { parseUser, type User } from "./types";

export const SESSION_STORAGE_KEY = "muses_auth";

export interface AuthSession {
  readonly token: string;
  readonly user: User;
}

interface StoredSessionShape {
  readonly token?: unknown;
  readonly user?: unknown;
}

function readStorage(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as StoredSessionShape;
    if (typeof record.token !== "string" || record.token.length === 0) {
      return null;
    }
    return { token: record.token, user: parseUser(record.user) };
  } catch {
    return null;
  }
}

function writeStorage(session: AuthSession | null): void {
  try {
    if (session === null) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    /* Storage unavailable (private mode, disabled) — keep the memory copy. */
  }
}

let cachedSession: AuthSession | null = readStorage();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getStoredSession(): AuthSession | null {
  return cachedSession;
}

export function getStoredToken(): string | null {
  return cachedSession === null ? null : cachedSession.token;
}

export function setStoredSession(session: AuthSession): void {
  cachedSession = session;
  writeStorage(session);
  notify();
}

/** Refresh just the user (after `GET /api/auth/me` or a profile update). */
export function setStoredUser(user: User): void {
  if (cachedSession === null) {
    return;
  }
  cachedSession = { token: cachedSession.token, user };
  writeStorage(cachedSession);
  notify();
}

export function clearStoredSession(): void {
  cachedSession = null;
  writeStorage(null);
  notify();
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding: the live session, or null when signed out. */
export function useAuthSession(): AuthSession | null {
  return useSyncExternalStore(
    subscribeToSession,
    getStoredSession,
    getStoredSession,
  );
}
