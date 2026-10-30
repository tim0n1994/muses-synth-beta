import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminApi,
  authApi,
  AuthApiError,
  authRequest,
  setUnauthorizedHandler,
} from "../api-client";
import {
  clearStoredSession,
  getStoredSession,
  setStoredSession,
} from "../auth-store";
import { adminUser, authResult, memberUser } from "../test/fixtures";
import { server } from "../test/server";
import "../test/setup";

describe("auth api client", () => {
  afterEach(() => {
    clearStoredSession();
  });

  it("attaches the bearer token from the stored session", async () => {
    setStoredSession(authResult(adminUser));
    let authorization = "missing";
    server.use(
      http.get("/api/auth/me", ({ request }) => {
        authorization = request.headers.get("authorization") ?? "missing";
        return HttpResponse.json({ user: adminUser });
      }),
    );

    const { user } = await authApi.me();
    expect(authorization).toBe("Bearer jwt-test-token");
    expect(user.email).toBe("root@muses.local");
  });

  it("parses the nested {error:{code,message}} envelope", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(
          {
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Wrong email or password.",
            },
          },
          { status: 401 },
        ),
      ),
    );

    const caught = await authApi
      .login("root@muses.local", "nope")
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(AuthApiError);
    const apiError = caught as AuthApiError;
    expect(apiError.code).toBe("INVALID_CREDENTIALS");
    expect(apiError.message).toBe("Wrong email or password.");
    expect(apiError.status).toBe(401);
  });

  it("parses the flat Muses {code,message} envelope", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json(
          { code: "EMAIL_TAKEN", message: "Email already registered." },
          { status: 409 },
        ),
      ),
    );

    const caught = await authApi
      .register("root@muses.local", "000000", "hunter2", undefined)
      .catch((error: unknown) => error);
    expect((caught as AuthApiError).code).toBe("EMAIL_TAKEN");
    expect((caught as AuthApiError).status).toBe(409);
  });

  it("keeps a 401 on a session path from looping: clears storage and notifies the handler", async () => {
    setStoredSession(authResult(adminUser));
    const unauthorized = vi.fn();
    const restore = setUnauthorizedHandler(unauthorized);
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json(
          { error: { code: "AUTH_REQUIRED", message: "Sign in first." } },
          { status: 401 },
        ),
      ),
    );

    await expect(authApi.me()).rejects.toBeInstanceOf(AuthApiError);
    expect(getStoredSession()).toBeNull();
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledWith("/api/auth/me");
    restore();
  });

  it("does not redirect when the login endpoint itself rejects with 401", async () => {
    const unauthorized = vi.fn();
    const restore = setUnauthorizedHandler(unauthorized);
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(
          { error: { code: "INVALID_CREDENTIALS", message: "No." } },
          { status: 401 },
        ),
      ),
    );

    await expect(authApi.login("a@b.c", "x")).rejects.toBeInstanceOf(
      AuthApiError,
    );
    expect(unauthorized).not.toHaveBeenCalled();
    restore();
  });

  it("sends displayName only when provided and stores nothing on failure", async () => {
    let registerBody: Record<string, unknown> = {};
    server.use(
      http.post("/api/auth/register", async ({ request }) => {
        registerBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(authResult(memberUser), { status: 201 });
      }),
    );

    const withoutName = await authApi.register(
      "ada@muses.local",
      "123456",
      "hunter2",
      undefined,
    );
    expect(registerBody).toEqual({
      email: "ada@muses.local",
      code: "123456",
      password: "hunter2",
    });
    expect(withoutName.user.email).toBe("ada@muses.local");
  });

  it("returns null for 204 responses", async () => {
    server.use(
      http.delete(
        "/api/admin/users/:id",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(adminApi.deleteUser("u-ada")).resolves.toBeNull();
  });

  it("lists admin users and forwards PATCH bodies", async () => {
    server.use(
      http.get("/api/admin/users", () =>
        HttpResponse.json({ users: [adminUser, memberUser] }),
      ),
      http.patch("/api/admin/users/:id", async ({ request }) => {
        const body = (await request.json()) as { isActive: boolean };
        return HttpResponse.json({
          user: { ...memberUser, isActive: body.isActive },
        });
      }),
    );

    const users = await adminApi.listUsers();
    expect(users).toHaveLength(2);
    expect(users[0]?.role).toBe("admin");

    const updated = await adminApi.updateUser("u-ada", { isActive: false });
    expect(updated.isActive).toBe(false);
  });

  it("falls back to a generic error for non-JSON bodies", async () => {
    server.use(
      http.get(
        "/api/admin/users",
        () =>
          new HttpResponse("gateway exploded", {
            status: 502,
            headers: { "content-type": "text/plain" },
          }),
      ),
    );
    const caught = await authRequest("/api/admin/users").catch(
      (error: unknown) => error,
    );
    expect((caught as AuthApiError).status).toBe(502);
    expect((caught as AuthApiError).code).toBe("HTTP_502");
  });
});
