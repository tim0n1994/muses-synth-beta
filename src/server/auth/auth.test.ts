import { afterEach, describe, expect, it } from "vitest";

import { AuthConfig, AuthConfigurationError } from "./config.js";
import { AuthService, AuthServiceError } from "./auth-service.js";
import { signJwt, verifyJwt } from "./jwt.js";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "./password.js";
import {
  MutableClock,
  SILENT_EMAILER,
  createServiceFixture,
  enabledAuthConfig,
  type ServiceFixture,
} from "./test-support.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    cleanup?.();
  }
});

function fixture(
  options?: Parameters<typeof createServiceFixture>[0],
): ServiceFixture {
  const created = createServiceFixture(options);
  cleanups.push(created.cleanup);
  return created;
}

/** Runs a synchronous service call and asserts it threw the expected code. */
function expectServiceError(
  action: () => unknown,
  expectedCode: string,
): AuthServiceError {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AuthServiceError);
    const serviceError = error as AuthServiceError;
    expect(serviceError.errorCode).toBe(expectedCode);
    return serviceError;
  }
  throw new Error("expected AuthServiceError, nothing was thrown");
}

describe("AuthConfig.fromEnv", () => {
  it("is disabled by default and validates nothing else", () => {
    const config = AuthConfig.fromEnv({});
    expect(config.enabled).toBe(false);
    // Even a missing JWT secret must not throw when disabled.
    expect(config.devCodeEchoEnabled).toBe(false);
  });

  it("rejects invalid enable flags", () => {
    expect(() => AuthConfig.fromEnv({ MUSES_AUTH_ENABLED: "yes" })).toThrow(
      AuthConfigurationError,
    );
  });

  it("refuses to start enabled in production without a JWT secret", () => {
    expect(() =>
      AuthConfig.fromEnv({
        MUSES_AUTH_ENABLED: "true",
        NODE_ENV: "production",
      }),
    ).toThrow(/MUSES_JWT_SECRET/);
    const config = AuthConfig.fromEnv({
      MUSES_AUTH_ENABLED: "true",
      NODE_ENV: "production",
      MUSES_JWT_SECRET: "prod-secret",
    });
    expect(config.enabled).toBe(true);
    expect(config.isProduction).toBe(true);
    // Production never echoes verification codes.
    expect(config.devCodeEchoEnabled).toBe(false);
  });

  it("accepts only the ported transports", () => {
    expect(() =>
      AuthConfig.fromEnv({
        MUSES_AUTH_ENABLED: "true",
        EMAIL_TRANSPORT: "smtp",
      }),
    ).toThrow(AuthConfigurationError);
    const config = AuthConfig.fromEnv({
      MUSES_AUTH_ENABLED: "true",
      EMAIL_TRANSPORT: "resend",
    });
    expect(config.emailTransport).toBe("resend");
  });

  it("reads ttl/resend defaults and validates integers", () => {
    const config = enabledAuthConfig();
    expect(config.codeTtlSeconds).toBe(600);
    expect(config.codeResendSeconds).toBe(60);
    expect(() =>
      AuthConfig.fromEnv({
        MUSES_AUTH_ENABLED: "true",
        CODE_TTL_SECONDS: "soon",
      }),
    ).toThrow(AuthConfigurationError);
  });

  it("matches admin emails case-insensitively", () => {
    const config = enabledAuthConfig({
      MUSES_ADMIN_EMAILS: "Root@Example.com",
    });
    expect(config.isAdminEmail("root@example.com")).toBe(true);
    expect(config.isAdminEmail("other@example.com")).toBe(false);
  });
});

describe("password hashing (scrypt)", () => {
  it("round-trips and rejects wrong or malformed input", () => {
    const stored = hashPassword("secret1");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("secret1", stored)).toBe(true);
    expect(verifyPassword("secret2", stored)).toBe(false);
    expect(verifyPassword("secret1", "garbage")).toBe(false);
    expect(verifyPassword("secret1", "")).toBe(false);
    expect(DUMMY_PASSWORD_HASH.startsWith("scrypt$")).toBe(true);
  });

  it("salts every hash", () => {
    expect(hashPassword("secret1")).not.toBe(hashPassword("secret1"));
  });
});

describe("JWT (hand-rolled HS256)", () => {
  const secret = "test-secret";

  it("signs and verifies claims", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      { sub: "abc123", email: "a@b.c", iat: now, exp: now + 60 },
      secret,
    );
    const claims = verifyJwt(token, secret);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("abc123");
    expect(claims?.email).toBe("a@b.c");
  });

  it("rejects wrong secrets, tampering, expiry and alg confusion", () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: "abc123", email: "a@b.c", iat: now, exp: now + 60 };
    const token = signJwt(claims, secret);

    expect(verifyJwt(token, "other-secret")).toBeNull();

    const parts = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...claims, sub: "evil" }),
    ).toString("base64url");
    const tampered = [parts[0], tamperedPayload, parts[2]].join(".");
    expect(verifyJwt(tampered, secret)).toBeNull();

    const expired = signJwt({ ...claims, exp: now - 10 }, secret);
    expect(verifyJwt(expired, secret)).toBeNull();

    // alg:none style header must never verify.
    const noneHeader = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payloadPart = Buffer.from(JSON.stringify(claims)).toString(
      "base64url",
    );
    expect(verifyJwt(`${noneHeader}.${payloadPart}.`, secret)).toBeNull();
    expect(verifyJwt("not-a-jwt", secret)).toBeNull();
  });
});

describe("verification codes", () => {
  it("creates, consumes and refuses double consumption", async () => {
    const { service, database } = fixture();
    const code = await service.createAndSendCode("a@b.c", "register");
    expect(code).toMatch(/^\d{6}$/);

    const row = database
      .prepare("SELECT consumed_at FROM email_verifications WHERE email = ?")
      .get("a@b.c") as { consumed_at: string | null } | undefined;
    expect(row?.consumed_at).toBeNull();

    expect(service.consumeCode("a@b.c", code, "register")).toBe(true);
    expect(service.consumeCode("a@b.c", code, "register")).toBe(false);
  });

  it("rejects wrong codes", async () => {
    const { service } = fixture();
    await service.createAndSendCode("a@b.c", "register");
    // 7 digits can never match a generated 6-digit code — deterministic.
    expect(service.consumeCode("a@b.c", "1234567", "register")).toBe(false);
  });

  it("rejects expired codes", async () => {
    const clock = new MutableClock();
    const { service } = fixture({ clock });
    const code = await service.createAndSendCode("a@b.c", "register");
    clock.advanceMilliseconds(601 * 1000);
    expect(service.consumeCode("a@b.c", code, "register")).toBe(false);
  });

  it("refuses register codes for existing accounts", async () => {
    const { service } = fixture();
    const code = await service.createAndSendCode("a@b.c", "register");
    service.registerUserVerified("a@b.c", code, "secret1");
    await expect(
      service.createAndSendCode("a@b.c", "register"),
    ).rejects.toMatchObject({ errorCode: "AUTH_EMAIL_ALREADY_REGISTERED" });
    // reset codes are still fine for the same address (per-purpose throttle).
    await expect(service.createAndSendCode("a@b.c", "reset")).resolves.toMatch(
      /^\d{6}$/,
    );
  });

  it("throttles resends within the window and persists across restarts", async () => {
    const { service, database } = fixture();
    await service.createAndSendCode("a@b.c", "register");

    await expect(
      service.createAndSendCode("a@b.c", "register"),
    ).rejects.toMatchObject({ errorCode: "AUTH_CODE_RESEND_THROTTLED" });

    // A fresh service instance (simulated restart) still sees the persisted
    // created_at and keeps throttling.
    const restarted = new AuthService({
      database,
      config: enabledAuthConfig(),
      emailer: SILENT_EMAILER,
    });
    await expect(
      restarted.createAndSendCode("a@b.c", "register"),
    ).rejects.toMatchObject({ errorCode: "AUTH_CODE_RESEND_THROTTLED" });
  });

  it("does not block the flow when the email send fails", async () => {
    const failing = {
      sendVerificationEmail: () => Promise.resolve(false),
    };
    const { service, database } = fixture({ emailer: failing });
    const code = await service.createAndSendCode("a@b.c", "register");
    expect(code).toMatch(/^\d{6}$/);
    const stored = database
      .prepare("SELECT COUNT(*) AS count FROM email_verifications")
      .get() as { count: number };
    expect(stored.count).toBe(1);
  });
});

describe("registration and login", () => {
  it("registers via code, promotes the first user when no allowlist exists", async () => {
    const { service } = fixture();
    const code = await service.createAndSendCode("first@b.c", "register");
    const session = service.registerUserVerified("First@B.C", code, "secret1");
    expect(session.user.email).toBe("first@b.c");
    expect(session.user.emailVerified).toBe(true);
    expect(session.user.isActive).toBe(true);
    expect(session.user.displayName).toBe("first");
    expect(session.user.subscription).toBe("free");
    // Deviation: first registered user becomes admin without an allowlist.
    expect(session.user.role).toBe("admin");

    const authentication = service.authenticateToken(session.token);
    expect(authentication.status).toBe("active");
    expect(authentication.user?.id).toBe(session.user.id);

    const secondCode = await service.createAndSendCode(
      "second@b.c",
      "register",
    );
    const second = service.registerUserVerified(
      "second@b.c",
      secondCode,
      "secret1",
    );
    expect(second.user.role).toBe("user");
  });

  it("honors the admin email allowlist", async () => {
    const { service } = fixture({
      config: enabledAuthConfig({ MUSES_ADMIN_EMAILS: "root@b.c" }),
    });
    const adminCode = await service.createAndSendCode("root@b.c", "register");
    const plainCode = await service.createAndSendCode("plain@b.c", "register");
    expect(
      service.registerUserVerified("root@b.c", adminCode, "secret1").user.role,
    ).toBe("admin");
    expect(
      service.registerUserVerified("plain@b.c", plainCode, "secret1").user.role,
    ).toBe("user");
  });

  it("rejects invalid codes and short passwords at registration", async () => {
    const { service } = fixture();
    await service.createAndSendCode("a@b.c", "register");
    expectServiceError(
      () => service.registerUserVerified("a@b.c", "1234567", "secret1"),
      "AUTH_CODE_INVALID",
    );

    const code = await service.createAndSendCode("fresh@b.c", "register");
    expectServiceError(
      () => service.registerUserVerified("fresh@b.c", code, "short"),
      "AUTH_INPUT_INVALID",
    );
    // The short-password failure happens before consumption, so the same
    // code still registers on retry.
    const retried = service.registerUserVerified("fresh@b.c", code, "secret1");
    expect(retried.user.email).toBe("fresh@b.c");
  });

  it("answers unknown users and wrong passwords identically", async () => {
    const { service } = fixture();
    const code = await service.createAndSendCode("known@b.c", "register");
    service.registerUserVerified("known@b.c", code, "secret1");

    const unknown = expectServiceError(
      () => service.loginUser("ghost@b.c", "secret1"),
      "AUTH_LOGIN_FAILED",
    );
    const wrong = expectServiceError(
      () => service.loginUser("known@b.c", "wrong-password"),
      "AUTH_LOGIN_FAILED",
    );
    expect(unknown.message).toBe(wrong.message);
    expect(unknown.statusCode).toBe(wrong.statusCode);
  });

  it("rejects deactivated accounts on login", async () => {
    const { service } = fixture();
    const code = await service.createAndSendCode("a@b.c", "register");
    const session = service.registerUserVerified("a@b.c", code, "secret1");
    service.setUserActive(session.user.id, false);

    expectServiceError(
      () => service.loginUser("a@b.c", "secret1"),
      "ACCOUNT_INACTIVE",
    );
    // Issued tokens die immediately: every request re-reads the database.
    expect(service.authenticateToken(session.token).status).toBe("inactive");
  });

  it("marks deleted users as deleted for lingering tokens", async () => {
    const { service } = fixture();
    const code = await service.createAndSendCode("a@b.c", "register");
    const session = service.registerUserVerified("a@b.c", code, "secret1");
    expect(service.deleteUser(session.user.id)).toBe(true);
    expect(service.authenticateToken(session.token).status).toBe("deleted");
    expect(service.deleteUser(session.user.id)).toBe(false);
  });
});

describe("profile and password management", () => {
  async function registerDefault(): Promise<{
    service: AuthService;
    userId: string;
    clock: MutableClock;
  }> {
    const clock = new MutableClock();
    const created = fixture({ clock });
    const code = await created.service.createAndSendCode("a@b.c", "register");
    const session = created.service.registerUserVerified(
      "a@b.c",
      code,
      "secret1",
    );
    return { service: created.service, userId: session.user.id, clock };
  }

  it("merges settings and renames display names", async () => {
    const { service, userId } = await registerDefault();
    service.updateProfile(userId, "Muses User", { theme: "dark" });
    const updated = service.updateProfile(userId, null, { lang: "zh" });
    expect(updated.displayName).toBe("Muses User");
    expect(updated.settings).toEqual({ lang: "zh", theme: "dark" });
  });

  it("changes passwords only with the correct old password", async () => {
    const { service, userId } = await registerDefault();
    expectServiceError(
      () => service.changePassword(userId, "wrong", "newsecret"),
      "AUTH_WRONG_PASSWORD",
    );
    service.changePassword(userId, "secret1", "newsecret");
    expect(service.loginUser("a@b.c", "newsecret").user.id).toBe(userId);
  });

  it("resets passwords via reset-purpose codes and reactivates", async () => {
    const { service, userId, clock } = await registerDefault();
    const resetCode = await service.createAndSendCode("a@b.c", "reset");
    // A register-purpose code must not unlock a reset.
    const registerCode = await service.createAndSendCode(
      "fresh@b.c",
      "register",
    );
    expectServiceError(
      () => service.resetPasswordVerified("a@b.c", registerCode, "hacked1"),
      "AUTH_CODE_INVALID",
    );

    service.resetPasswordVerified("a@b.c", resetCode, "newsecret");
    expect(service.loginUser("a@b.c", "newsecret").user.id).toBe(userId);

    // Deactivated + reset => active again (contract behavior). Advance the
    // clock past the resend window first: reset codes for one address are
    // throttled per email+purpose.
    service.setUserActive(userId, false);
    clock.advanceMilliseconds(61 * 1000);
    const secondReset = await service.createAndSendCode("a@b.c", "reset");
    service.resetPasswordVerified("a@b.c", secondReset, "another1");
    expect(service.loginUser("a@b.c", "another1").user.isActive).toBe(true);
  });
});

describe("admin user management", () => {
  it("lists users newest-first with zero report counts", async () => {
    const { service } = fixture();
    const first = service.registerUserVerified(
      "first@b.c",
      await service.createAndSendCode("first@b.c", "register"),
      "secret1",
    );
    const second = service.registerUserVerified(
      "second@b.c",
      await service.createAndSendCode("second@b.c", "register"),
      "secret1",
    );
    const users = service.listUsers(100);
    expect(users.map((user) => user.email)).toEqual([
      "second@b.c",
      "first@b.c",
    ]);
    expect(users.every((user) => user.reportCount === 0)).toBe(true);
    expect(service.listUsers(1).map((user) => user.id)).toEqual([
      second.user.id,
    ]);
    expect(service.getUserById(first.user.id)?.email).toBe("first@b.c");
    expect(service.setUserActive("missing", false)).toBeNull();
  });
});
