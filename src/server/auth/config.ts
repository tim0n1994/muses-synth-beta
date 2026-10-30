/**
 * AuthConfig — the auth module's single point of environment reading.
 *
 * Behavior:
 *   - JWT expiry is a fixed 30 days.
 *   - Only the console and resend transports exist; Resend uses native fetch.
 *   - Production detection uses NODE_ENV.
 *   - When auth is enabled and NODE_ENV=production but MUSES_JWT_SECRET is
 *     missing, fromEnv() throws and the process refuses to start.
 *   - Non-production falls back to a fixed development secret so local
 *     experiments work with zero configuration.
 *
 * When the module is disabled (MUSES_AUTH_ENABLED unset/false) nothing is
 * validated beyond the enable flag, so the rest of the server behaves exactly
 * as before the auth module existed.
 */

export class AuthConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export type EmailTransportKind = "console" | "resend";

/** 30 days, in seconds (contract deviation: the skill uses 72 hours). */
export const JWT_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

const DEVELOPMENT_JWT_SECRET = "muses-dev-jwt-secret-do-not-use-in-production";

export class AuthConfig {
  public readonly enabled: boolean;
  public readonly jwtSecret: string;
  public readonly jwtExpirySeconds: number;
  public readonly emailTransport: EmailTransportKind;
  public readonly resendApiKey: string;
  public readonly resendFromEmail: string;
  public readonly brandName: string;
  public readonly adminEmails: ReadonlySet<string>;
  public readonly codeTtlSeconds: number;
  public readonly codeResendSeconds: number;
  public readonly isProduction: boolean;

  private constructor(fields: {
    adminEmails: ReadonlySet<string>;
    brandName: string;
    codeResendSeconds: number;
    codeTtlSeconds: number;
    emailTransport: EmailTransportKind;
    enabled: boolean;
    isProduction: boolean;
    jwtSecret: string;
    resendApiKey: string;
    resendFromEmail: string;
  }) {
    this.enabled = fields.enabled;
    this.jwtSecret = fields.jwtSecret;
    this.jwtExpirySeconds = JWT_EXPIRY_SECONDS;
    this.emailTransport = fields.emailTransport;
    this.resendApiKey = fields.resendApiKey;
    this.resendFromEmail = fields.resendFromEmail;
    this.brandName = fields.brandName;
    this.adminEmails = fields.adminEmails;
    this.codeTtlSeconds = fields.codeTtlSeconds;
    this.codeResendSeconds = fields.codeResendSeconds;
    this.isProduction = fields.isProduction;
    Object.freeze(this);
  }

  /**
   * Only non-production + console transport ever echoes verification codes in
   * API responses, and never when the module is disabled. Production never
   * echoes (the skill's security rule: email verification is meaningless if
   * the code leaks).
   */
  public get devCodeEchoEnabled(): boolean {
    return (
      this.enabled && !this.isProduction && this.emailTransport === "console"
    );
  }

  public isAdminEmail(email: string): boolean {
    return this.adminEmails.has(email.trim().toLowerCase());
  }

  public static fromEnv(source: NodeJS.ProcessEnv = process.env): AuthConfig {
    const enabled = readEnabled(source);
    if (!enabled) {
      // Disabled modules must be behavior-free: no further validation and no
      // startup failures, regardless of how unrelated variables look.
      return new AuthConfig({
        adminEmails: new Set<string>(),
        brandName: "Muses",
        codeResendSeconds: 60,
        codeTtlSeconds: 600,
        emailTransport: "console",
        enabled: false,
        isProduction: false,
        jwtSecret: "",
        resendApiKey: "",
        resendFromEmail: "",
      });
    }

    const isProduction =
      (source.NODE_ENV ?? "").trim().toLowerCase() === "production";

    let jwtSecret = (source.MUSES_JWT_SECRET ?? "").trim();
    if (jwtSecret === "") {
      if (isProduction) {
        throw new AuthConfigurationError(
          "MUSES_JWT_SECRET must be set in production. Generate one with: node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\"",
        );
      }
      jwtSecret = DEVELOPMENT_JWT_SECRET;
      console.warn(
        "[auth] MUSES_JWT_SECRET is not set; using the development fallback secret. Never allow this in any reachable deployment.",
      );
    }

    const emailTransport = readEmailTransport(source);
    const codeTtlSeconds = readPositiveInteger(
      source.CODE_TTL_SECONDS,
      600,
      "CODE_TTL_SECONDS",
    );
    const codeResendSeconds = readPositiveInteger(
      source.CODE_RESEND_SECONDS,
      60,
      "CODE_RESEND_SECONDS",
    );

    return new AuthConfig({
      adminEmails: readAdminEmails(source.MUSES_ADMIN_EMAILS),
      brandName: (source.MUSES_AUTH_BRAND_NAME ?? "").trim() || "Muses",
      codeResendSeconds,
      codeTtlSeconds,
      emailTransport,
      enabled,
      isProduction,
      jwtSecret,
      resendApiKey: (source.RESEND_API_KEY ?? "").trim(),
      resendFromEmail:
        (source.RESEND_FROM_EMAIL ?? "").trim() || "noreply@muses.local",
    });
  }
}

function readEnabled(source: NodeJS.ProcessEnv): boolean {
  const raw = (source.MUSES_AUTH_ENABLED ?? "").trim().toLowerCase();
  if (raw === "" || raw === "false" || raw === "0") {
    return false;
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  throw new AuthConfigurationError(
    'MUSES_AUTH_ENABLED must be "true" or "false"',
  );
}

function readEmailTransport(source: NodeJS.ProcessEnv): EmailTransportKind {
  const raw = (source.EMAIL_TRANSPORT ?? "console").trim().toLowerCase();
  if (raw === "console" || raw === "resend") {
    return raw;
  }
  throw new AuthConfigurationError(
    'EMAIL_TRANSPORT must be "console" or "resend" (the skill\'s smtp transport is not ported)',
  );
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const raw = (value ?? "").trim();
  if (raw === "") {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new AuthConfigurationError(`${name} must be a positive integer`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 1) {
    throw new AuthConfigurationError(`${name} must be a positive integer`);
  }
  return parsed;
}

function readAdminEmails(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}
