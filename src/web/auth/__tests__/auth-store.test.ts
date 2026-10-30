import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  clearStoredSession,
  getStoredSession,
  SESSION_STORAGE_KEY,
  setStoredSession,
  setStoredUser,
  subscribeToSession,
  useAuthSession,
} from "../auth-store";
import { adminUser, authResult, memberUser } from "../test/fixtures";
import "../test/setup";

describe("auth store", () => {
  it("persists token and user together under muses_auth", () => {
    setStoredSession(authResult(adminUser));

    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({
      token: "jwt-test-token",
      user: { email: "root@muses.local" },
    });
    expect(getStoredSession()?.user.role).toBe("admin");
  });

  it("logout clears both the memory copy and localStorage", () => {
    setStoredSession(authResult(adminUser));
    clearStoredSession();

    expect(getStoredSession()).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("notifies subscribers on every mutation", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSession(listener);

    setStoredSession(authResult(adminUser));
    expect(listener).toHaveBeenCalledTimes(1);
    setStoredUser(memberUser);
    expect(listener).toHaveBeenCalledTimes(2);
    clearStoredSession();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    setStoredSession(authResult(adminUser));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("exposes the live session through useAuthSession", () => {
    const { result } = renderHook(() => useAuthSession());
    expect(result.current).toBeNull();

    act(() => {
      setStoredSession(authResult(adminUser));
    });
    expect(result.current?.token).toBe("jwt-test-token");
    expect(result.current?.user.email).toBe("root@muses.local");

    act(() => {
      clearStoredSession();
    });
    expect(result.current).toBeNull();
  });

  it("recovers when localStorage holds a malformed blob", () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, "{not json");
    // The guarded parser keeps the in-memory session authoritative; a fresh
    // write replaces the corrupt blob with a valid one.
    setStoredSession(authResult(adminUser));
    expect(getStoredSession()?.token).toBe("jwt-test-token");
    expect(
      JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) as string),
    ).toMatchObject({ token: "jwt-test-token" });
  });
});
