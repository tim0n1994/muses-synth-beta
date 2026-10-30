import { afterEach, describe, expect, it } from "vitest";

import {
  createAuthHarness,
  enabledAuthConfig,
  registerViaApi,
  type AuthHarness,
} from "./test-support.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) {
      await cleanup();
    }
  }
});

async function harness(extra: NodeJS.ProcessEnv = {}): Promise<AuthHarness> {
  const created = await createAuthHarness({
    config: enabledAuthConfig(extra),
  });
  cleanups.push(created.cleanup);
  return created;
}

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

describe("POST /api/auth/send-code", () => {
  it("echoes devCode outside production with the console transport", async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "user@example.com", purpose: "register" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; devCode?: string }>();
    expect(body.status).toBe("sent");
    expect(body.devCode).toMatch(/^\d{6}$/);
  });

  it("never echoes devCode in production", async () => {
    const { app } = await harness({
      NODE_ENV: "production",
      MUSES_JWT_SECRET: "prod-secret",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "user@example.com", purpose: "register" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string; devCode?: string }>()).toEqual({
      status: "sent",
    });
  });

  it("refuses register codes for existing accounts and throttles resends", async () => {
    const { app } = await harness();
    await registerViaApi(app, "user@example.com", "secret1");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "user@example.com", purpose: "register" },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_EMAIL_ALREADY_REGISTERED",
    );

    const throttled = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "other@example.com", purpose: "register" },
    });
    expect(throttled.statusCode).toBe(200);
    const again = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "other@example.com", purpose: "register" },
    });
    expect(again.statusCode).toBe(400);
    expect(again.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_CODE_RESEND_THROTTLED",
    );
  });

  it("validates the body shape", async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "user@example.com", purpose: "delete-all" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe(
      "VALIDATION_FAILED",
    );
  });
});

describe("register / login / me flows", () => {
  it("walks register -> login -> me -> profile -> password -> reset", async () => {
    const { app } = await harness({
      MUSES_ADMIN_EMAILS: "admin@example.com",
    });
    const registered = await registerViaApi(app, "user@example.com", "secret1");
    expect(registered.user.role).toBe("user");
    expect(registered.user.emailVerified).toBe(true);
    expect(typeof registered.token).toBe("string");

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "USER@example.com", password: "secret1" },
    });
    expect(login.statusCode).toBe(200);
    const session = login.json<{
      user: { id: string; displayName: string };
      token: string;
    }>();
    expect(session.user.id).toBe(registered.user.id);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { email: string } }>().user.email).toBe(
      "user@example.com",
    );

    const renamed = await app.inject({
      method: "PUT",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { displayName: "Muses User", settings: { theme: "dark" } },
    });
    expect(renamed.statusCode).toBe(200);
    expect(
      renamed.json<{ user: { displayName: string } }>().user.displayName,
    ).toBe("Muses User");

    const merged = await app.inject({
      method: "PUT",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { settings: { lang: "zh" } },
    });
    expect(
      merged.json<{ user: { settings: Record<string, unknown> } }>().user
        .settings,
    ).toEqual({ lang: "zh", theme: "dark" });

    const wrongOld = await app.inject({
      method: "PUT",
      url: "/api/auth/me/password",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { oldPassword: "wrong", newPassword: "newsecret" },
    });
    expect(wrongOld.statusCode).toBe(400);
    expect(wrongOld.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_WRONG_PASSWORD",
    );

    const changed = await app.inject({
      method: "PUT",
      url: "/api/auth/me/password",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { oldPassword: "secret1", newPassword: "newsecret" },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ status: "ok" });

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "user@example.com", password: "secret1" },
    });
    expect(oldLogin.statusCode).toBe(401);
    expect(oldLogin.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_LOGIN_FAILED",
    );

    const resetCode = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "user@example.com", purpose: "reset" },
    });
    const devCode = resetCode.json<{ devCode?: string }>().devCode;
    expect(devCode).toBeDefined();
    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: {
        email: "user@example.com",
        code: devCode,
        newPassword: "reset-password1",
      },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ status: "ok" });

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "user@example.com", password: "reset-password1" },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("promotes the first user to admin when no allowlist is configured", async () => {
    const { app } = await harness();
    const first = await registerViaApi(app, "first@example.com", "secret1");
    const second = await registerViaApi(app, "second@example.com", "secret1");
    expect(first.user.role).toBe("admin");
    expect(second.user.role).toBe("user");
  });

  it("rejects invalid codes and short passwords at registration", async () => {
    const { app } = await harness();
    const codeResponse = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "user@example.com", purpose: "register" },
    });
    const devCode = codeResponse.json<{ devCode?: string }>().devCode;

    const wrongCode = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "user@example.com",
        code: "9999999",
        password: "secret1",
      },
    });
    expect(wrongCode.statusCode).toBe(400);
    expect(wrongCode.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_CODE_INVALID",
    );

    const shortPassword = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "user@example.com",
        code: devCode,
        password: "short",
      },
    });
    expect(shortPassword.statusCode).toBe(400);

    // The failed attempts did not consume the code.
    const success = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "user@example.com",
        code: devCode,
        password: "secret1",
      },
    });
    expect(success.statusCode).toBe(200);
  });

  it("returns identical 401s for unknown users and wrong passwords", async () => {
    const { app } = await harness();
    await registerViaApi(app, "known@example.com", "secret1");

    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ghost@example.com", password: "secret1" },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "known@example.com", password: "wrong-password" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    const unknownError = unknown.json<ErrorEnvelopeBody>().error;
    const wrongError = wrong.json<ErrorEnvelopeBody>().error;
    // requestId legitimately differs per request; code+message must not.
    expect(unknownError.code).toBe(wrongError.code);
    expect(unknownError.message).toBe(wrongError.message);
  });

  it("protects /me with the contract 401 codes", async () => {
    const { app } = await harness();
    const missing = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json<ErrorEnvelopeBody>().error.code).toBe("AUTH_REQUIRED");
    expect(missing.json<ErrorEnvelopeBody>().error.requestId).toEqual(
      expect.any(String),
    );

    const invalid = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: "Bearer not-a-token" },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json<ErrorEnvelopeBody>().error.code).toBe("AUTH_INVALID");
  });
});

describe("admin routes", () => {
  async function adminHarness(): Promise<{
    app: AuthHarness["app"];
    admin: { user: { id: string }; token: string };
    user: { user: { id: string }; token: string };
  }> {
    const { app } = await harness({
      MUSES_ADMIN_EMAILS: "admin@example.com",
    });
    const admin = await registerViaApi(app, "admin@example.com", "secret1");
    const user = await registerViaApi(app, "plain@example.com", "secret1");
    return { app, admin, user };
  }

  it("rejects non-admin users with 403", async () => {
    const { app, user } = await adminHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_FORBIDDEN",
    );
  });

  it("lists users with reportCount 0 and honors ?limit=", async () => {
    const { app, admin } = await adminHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(response.statusCode).toBe(200);
    const users = response.json<{
      users: { email: string; reportCount: number }[];
    }>().users;
    expect(users.map((entry) => entry.email)).toEqual([
      "plain@example.com",
      "admin@example.com",
    ]);
    expect(users.every((entry) => entry.reportCount === 0)).toBe(true);

    const limited = await app.inject({
      method: "GET",
      url: "/api/admin/users?limit=1",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(
      limited
        .json<{ users: { email: string }[] }>()
        .users.map((entry) => entry.email),
    ).toEqual(["plain@example.com"]);
  });

  it("reads a single user and 404s for missing ids", async () => {
    const { app, admin, user } = await adminHarness();
    const found = await app.inject({
      method: "GET",
      url: `/api/admin/users/${user.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(found.statusCode).toBe(200);
    expect(found.json<{ user: { email: string } }>().user.email).toBe(
      "plain@example.com",
    );

    const missing = await app.inject({
      method: "GET",
      url: "/api/admin/users/does-not-exist",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_USER_NOT_FOUND",
    );
  });

  it("deactivates a user: login rejected and issued tokens die immediately", async () => {
    const { app, admin, user } = await adminHarness();
    const deactivated = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${user.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { isActive: false },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(
      deactivated.json<{ user: { isActive: boolean } }>().user.isActive,
    ).toBe(false);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "plain@example.com", password: "secret1" },
    });
    expect(login.statusCode).toBe(401);
    expect(login.json<ErrorEnvelopeBody>().error.code).toBe("ACCOUNT_INACTIVE");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(me.statusCode).toBe(401);
    expect(me.json<ErrorEnvelopeBody>().error.code).toBe("ACCOUNT_INACTIVE");

    const reactivated = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${user.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { isActive: true },
    });
    expect(reactivated.statusCode).toBe(200);
    const reLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "plain@example.com", password: "secret1" },
    });
    expect(reLogin.statusCode).toBe(200);
  });

  it("requires an isActive field on PATCH and 404s on unknown ids", async () => {
    const { app, admin } = await adminHarness();
    const empty = await app.inject({
      method: "PATCH",
      url: "/api/admin/users/missing-user",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_NO_UPDATE_FIELDS",
    );

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/admin/users/missing-user",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { isActive: true },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("deletes users but refuses self-deletion", async () => {
    const { app, admin, user } = await adminHarness();
    const selfDelete = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${admin.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(selfDelete.statusCode).toBe(400);
    expect(selfDelete.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_SELF_DELETE",
    );

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${user.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ status: "deleted" });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "plain@example.com", password: "secret1" },
    });
    expect(login.statusCode).toBe(401);

    const lingeringToken = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(lingeringToken.statusCode).toBe(401);
    expect(lingeringToken.json<ErrorEnvelopeBody>().error.code).toBe(
      "ACCOUNT_DELETED",
    );
  });
});

describe("rate limiting (contract values)", () => {
  it("limits send-code to 5/60s per client", async () => {
    const { app } = await harness();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/send-code",
        payload: {
          email: `user${attempt}@example.com`,
          purpose: "register",
        },
      });
      expect(response.statusCode).toBe(200);
    }
    const throttled = await app.inject({
      method: "POST",
      url: "/api/auth/send-code",
      payload: { email: "overflow@example.com", purpose: "register" },
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json<ErrorEnvelopeBody>().error.code).toBe(
      "AUTH_RATE_LIMITED",
    );
  });

  it("limits login to 10/60s per client", async () => {
    const { app } = await harness();
    await registerViaApi(app, "known@example.com", "secret1");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "known@example.com", password: "wrong-password" },
      });
      expect(response.statusCode).toBe(401);
    }
    const throttled = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "known@example.com", password: "secret1" },
    });
    expect(throttled.statusCode).toBe(429);
  });
});
