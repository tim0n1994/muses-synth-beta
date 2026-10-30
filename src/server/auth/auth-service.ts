import { randomBytes, randomInt } from "node:crypto";

import {
  type Clock,
  systemClock,
  toIsoTimestamp,
  type SqliteDatabase,
} from "../db/types.js";
import type { AuthConfig } from "./config.js";
import type { VerificationEmailSender } from "./email-service.js";
import { signJwt, verifyJwt } from "./jwt.js";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "./password.js";
import type {
  AdminUserView,
  AuthPurpose,
  AuthSession,
  PublicUser,
  UserRole,
} from "./types.js";

/**
 * Auth core: email-code registration, password login with anti-enumeration, JWT
 * sessions, and admin user management.
 *
 * Contract invariants preserved here:
 *   - Codes are persisted before the email is sent; send failures never
 *     block the flow.
 *   - Resend throttling reads email_verifications.created_at, so it survives
 *     restarts and applies across processes sharing the database.
 *   - consume_code requires unconsumed + unexpired + matching code+purpose.
 *   - Login answers "邮箱或密码错误" identically for missing users and wrong
 *     passwords (plus a dummy scrypt verification so timing matches too).
 *   - Every authenticated request re-reads the database, so deactivation and
 *     deletion take effect on already-issued tokens without a blacklist.
 *
 * Implementation details:
 *   - scrypt is used for passwords, HS256 for JWTs, and crypto.randomInt
 *     for verification codes.
 *   - When MUSES_ADMIN_EMAILS is unset, the FIRST registered user becomes
 *     admin (bootstrap so an enabled deployment has an administrator).
 *   - ResourceHooks are not ported: listUsers reports reportCount 0 and
 *     deletion has no host-resource cascade (Muses has no per-user resources).
 */

export type TokenAuthenticationStatus =
  "active" | "invalid" | "deleted" | "inactive";

export interface TokenAuthentication {
  readonly status: TokenAuthenticationStatus;
  readonly user?: PublicUser;
}

export class AuthServiceError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  public constructor(
    message: string,
    statusCode: 400 | 401 | 404,
    errorCode: string,
  ) {
    super(message);
    this.name = "AuthServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: string;
  settings_json: string;
  role: string;
  email_verified: number;
  is_active: number;
}

export interface AuthServiceDeps {
  readonly database: SqliteDatabase;
  readonly config: AuthConfig;
  readonly emailer: VerificationEmailSender;
  readonly clock?: Clock;
}

const USER_COLUMNS =
  "id, email, display_name, password_hash, created_at, settings_json, role, email_verified, is_active";

export class AuthService {
  private readonly database: SqliteDatabase;
  private readonly config: AuthConfig;
  private readonly emailer: VerificationEmailSender;
  private readonly clock: Clock;

  public constructor(deps: AuthServiceDeps) {
    this.database = deps.database;
    this.config = deps.config;
    this.emailer = deps.emailer;
    this.clock = deps.clock ?? systemClock;
  }

  // ── Verification codes ─────────────────────────────────────────────

  /**
   * Generates a 6-digit code, persists it, then sends the email. Returns the
   * code (the route decides whether dev-mode echoing is allowed).
   */
  public async createAndSendCode(
    rawEmail: string,
    purpose: AuthPurpose,
  ): Promise<string> {
    const email = this.normalizeEmail(rawEmail);
    this.assertEmailShape(email);
    const now = this.clock.now();
    const nowIso = toIsoTimestamp(now);

    if (purpose === "register") {
      const existing = this.database
        .prepare("SELECT 1 AS one FROM users WHERE email = ?")
        .get(email) as { one: number } | undefined;
      if (existing !== undefined) {
        throw new AuthServiceError(
          "该邮箱已被注册",
          400,
          "AUTH_EMAIL_ALREADY_REGISTERED",
        );
      }
    }

    const last = this.database
      .prepare(
        `SELECT created_at FROM email_verifications
         WHERE email = ? AND purpose = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(email, purpose) as { created_at: string } | undefined;
    if (last !== undefined) {
      const elapsedSeconds =
        (now.getTime() - Date.parse(last.created_at)) / 1000;
      if (
        !Number.isNaN(elapsedSeconds) &&
        elapsedSeconds < this.config.codeResendSeconds
      ) {
        throw new AuthServiceError(
          `发送过于频繁，请 ${Math.ceil(this.config.codeResendSeconds - elapsedSeconds)} 秒后再试`,
          400,
          "AUTH_CODE_RESEND_THROTTLED",
        );
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresIso = toIsoTimestamp(
      new Date(now.getTime() + this.config.codeTtlSeconds * 1000),
    );
    // Void all previous unconsumed codes for this email+purpose first.
    this.database
      .prepare(
        `UPDATE email_verifications SET consumed_at = ?
         WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
      )
      .run(nowIso, email, purpose);
    this.database
      .prepare(
        `INSERT INTO email_verifications
           (email, code, purpose, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(email, code, purpose, nowIso, expiresIso);

    // Contract rule: sending must never block — the code is already stored.
    await this.emailer.sendVerificationEmail(email, code, purpose);
    return code;
  }

  /** Unconsumed + unexpired + matching code+purpose; consumes on success. */
  public consumeCode(
    rawEmail: string,
    code: string,
    purpose: AuthPurpose,
  ): boolean {
    const email = this.normalizeEmail(rawEmail);
    const row = this.database
      .prepare(
        `SELECT expires_at FROM email_verifications
         WHERE email = ? AND code = ? AND purpose = ? AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(email, code, purpose) as { expires_at: string } | undefined;
    if (row === undefined) {
      return false;
    }
    const expiresAt = Date.parse(row.expires_at);
    const now = this.clock.now().getTime();
    if (Number.isNaN(expiresAt) || expiresAt < now) {
      return false;
    }
    this.database
      .prepare(
        `UPDATE email_verifications SET consumed_at = ?
         WHERE email = ? AND code = ? AND purpose = ?`,
      )
      .run(toIsoTimestamp(this.clock.now()), email, code, purpose);
    return true;
  }

  // ── Registration / login ───────────────────────────────────────────

  public registerUserVerified(
    rawEmail: string,
    code: string,
    password: string,
    displayName?: string,
  ): AuthSession {
    const email = this.normalizeEmail(rawEmail);
    this.assertEmailShape(email);
    this.assertPasswordShape(password);
    if (!this.consumeCode(email, code, "register")) {
      throw new AuthServiceError(
        "验证码无效或已过期",
        400,
        "AUTH_CODE_INVALID",
      );
    }
    return this.insertVerifiedUser(email, password, displayName);
  }

  public loginUser(rawEmail: string, password: string): AuthSession {
    const email = this.normalizeEmail(rawEmail);
    const row = this.selectUserByEmail(email);
    if (row === undefined) {
      // Constant-information anti-enumeration: pay the same scrypt cost and
      // raise the same error as the wrong-password branch below.
      verifyPassword(password, DUMMY_PASSWORD_HASH);
      throw new AuthServiceError("邮箱或密码错误", 401, "AUTH_LOGIN_FAILED");
    }
    if (!verifyPassword(password, row.password_hash)) {
      throw new AuthServiceError("邮箱或密码错误", 401, "AUTH_LOGIN_FAILED");
    }
    if (row.is_active === 0) {
      throw new AuthServiceError(
        "该账号已被停用，请联系管理员",
        401,
        "ACCOUNT_INACTIVE",
      );
    }
    return {
      user: this.rowToUser(row),
      token: this.createToken(row.id, row.email),
    };
  }

  /**
   * Every protected request re-reads the database (contract rule), so a
   * deactivated or deleted user is rejected immediately even with a valid
   * JWT — no token blacklist needed.
   */
  public authenticateToken(token: string): TokenAuthentication {
    const claims = verifyJwt(token, this.config.jwtSecret);
    if (claims === null) {
      return { status: "invalid" };
    }
    const row = this.selectUserById(claims.sub);
    if (row === undefined) {
      return { status: "deleted" };
    }
    const user = this.rowToUser(row);
    if (!user.isActive) {
      return { status: "inactive" };
    }
    return { status: "active", user };
  }

  // ── Profile ────────────────────────────────────────────────────────

  public getUserById(userId: string): PublicUser | null {
    const row = this.selectUserById(userId);
    return row === undefined ? null : this.rowToUser(row);
  }

  public updateProfile(
    userId: string,
    displayName: string | null,
    settings: Readonly<Record<string, unknown>> | null,
  ): PublicUser {
    const row = this.database
      .prepare("SELECT display_name, settings_json FROM users WHERE id = ?")
      .get(userId) as
      { display_name: string; settings_json: string } | undefined;
    if (row === undefined) {
      throw new AuthServiceError("用户不存在", 400, "AUTH_USER_NOT_FOUND");
    }
    if (displayName !== null) {
      this.database
        .prepare("UPDATE users SET display_name = ? WHERE id = ?")
        .run(displayName.trim(), userId);
    }
    if (settings !== null) {
      const merged = {
        ...parseSettings(row.settings_json),
        ...settings,
      } as Record<string, unknown>;
      this.database
        .prepare("UPDATE users SET settings_json = ? WHERE id = ?")
        .run(JSON.stringify(merged), userId);
    }
    const updated = this.getUserById(userId);
    if (updated === null) {
      throw new AuthServiceError("用户不存在", 400, "AUTH_USER_NOT_FOUND");
    }
    return updated;
  }

  public changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): void {
    if (newPassword.length < 6) {
      throw new AuthServiceError(
        "新密码至少 6 个字符",
        400,
        "AUTH_INPUT_INVALID",
      );
    }
    const row = this.database
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(userId) as { password_hash: string } | undefined;
    if (row === undefined) {
      throw new AuthServiceError("用户不存在", 400, "AUTH_USER_NOT_FOUND");
    }
    if (!verifyPassword(oldPassword, row.password_hash)) {
      throw new AuthServiceError("当前密码错误", 400, "AUTH_WRONG_PASSWORD");
    }
    this.database
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(hashPassword(newPassword), userId);
  }

  public resetPasswordVerified(
    rawEmail: string,
    code: string,
    newPassword: string,
  ): void {
    const email = this.normalizeEmail(rawEmail);
    this.assertEmailShape(email);
    this.assertPasswordShape(newPassword, "密码至少 6 个字符");
    if (!this.consumeCode(email, code, "reset")) {
      throw new AuthServiceError(
        "验证码无效或已过期",
        400,
        "AUTH_CODE_INVALID",
      );
    }
    const row = this.database
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email) as { id: string } | undefined;
    if (row === undefined) {
      throw new AuthServiceError("用户不存在", 400, "AUTH_USER_NOT_FOUND");
    }
    // Contract behavior: a successful reset also reactivates the account.
    this.database
      .prepare("UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?")
      .run(hashPassword(newPassword), row.id);
  }

  // ── Admin user management ──────────────────────────────────────────

  public listUsers(limit: number): readonly AdminUserView[] {
    const rows = this.database
      .prepare(
        `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as readonly UserRow[];
    return rows.map((row) => ({
      ...this.rowToUser(row),
      reportCount: 0,
    }));
  }

  public setUserActive(userId: string, isActive: boolean): PublicUser | null {
    const result = this.database
      .prepare("UPDATE users SET is_active = ? WHERE id = ?")
      .run(isActive ? 1 : 0, userId);
    if (Number(result.changes) === 0) {
      return null;
    }
    return this.getUserById(userId);
  }

  public deleteUser(userId: string): boolean {
    const result = this.database
      .prepare("DELETE FROM users WHERE id = ?")
      .run(userId);
    return Number(result.changes) > 0;
  }

  // ── internals ──────────────────────────────────────────────────────

  private insertVerifiedUser(
    email: string,
    password: string,
    displayName: string | undefined,
  ): AuthSession {
    const trimmed = displayName?.trim() ?? "";
    const resolvedName =
      trimmed.length > 0 ? trimmed : (email.split("@")[0] ?? email);
    const userId = randomBytes(8).toString("hex");
    const createdAt = toIsoTimestamp(this.clock.now());
    const role = this.resolveRole(email);
    try {
      this.database
        .prepare(
          `INSERT INTO users
             (id, email, display_name, password_hash, created_at,
              settings_json, role, email_verified, is_active)
           VALUES (?, ?, ?, ?, ?, '{}', ?, 1, 1)`,
        )
        .run(
          userId,
          email,
          resolvedName,
          hashPassword(password),
          createdAt,
          role,
        );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toUpperCase().includes("UNIQUE")
      ) {
        throw new AuthServiceError(
          "该邮箱已被注册",
          400,
          "AUTH_EMAIL_ALREADY_REGISTERED",
        );
      }
      throw error;
    }
    const user = this.getUserById(userId);
    if (user === null) {
      throw new Error("registered user row missing after insert");
    }
    return { user, token: this.createToken(userId, email) };
  }

  private resolveRole(email: string): UserRole {
    if (this.config.isAdminEmail(email)) {
      return "admin";
    }
    // Deviation from the skill: when no administrator allowlist is
    // configured, the first registered user is promoted so an enabled
    // deployment is never locked out of /api/admin/*.
    if (this.config.adminEmails.size === 0) {
      const row = this.database
        .prepare("SELECT COUNT(*) AS count FROM users")
        .get() as { count: number };
      if (row.count === 0) {
        return "admin";
      }
    }
    return "user";
  }

  private createToken(userId: string, email: string): string {
    const issuedAtSeconds = Math.floor(this.clock.now().getTime() / 1000);
    return signJwt(
      {
        sub: userId,
        email,
        iat: issuedAtSeconds,
        exp: issuedAtSeconds + this.config.jwtExpirySeconds,
      },
      this.config.jwtSecret,
    );
  }

  private selectUserByEmail(email: string): UserRow | undefined {
    return this.database
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
      .get(email) as UserRow | undefined;
  }

  private selectUserById(userId: string): UserRow | undefined {
    return this.database
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
      .get(userId) as UserRow | undefined;
  }

  private rowToUser(row: UserRow): PublicUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      createdAt: row.created_at,
      subscription: "free",
      role: row.role === "admin" ? "admin" : "user",
      emailVerified: row.email_verified !== 0,
      isActive: row.is_active !== 0,
      settings: parseSettings(row.settings_json),
    };
  }

  private normalizeEmail(rawEmail: string): string {
    return rawEmail.trim().toLowerCase();
  }

  private assertEmailShape(email: string): void {
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new AuthServiceError(
        "请输入有效的邮箱地址",
        400,
        "AUTH_INPUT_INVALID",
      );
    }
  }

  private assertPasswordShape(
    password: string,
    message = "密码至少 6 个字符",
  ): void {
    if (password.length < 6) {
      throw new AuthServiceError(message, 400, "AUTH_INPUT_INVALID");
    }
  }
}

function parseSettings(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
