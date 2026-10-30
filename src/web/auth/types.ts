/**
 * Runtime types for the Muses auth domain, mirroring the backend contract:
 * POST /api/auth/{send-code,register,login,reset-password},
 * GET/PUT /api/auth/me, PUT /api/auth/me/password, /api/admin/users/*.
 *
 * `parseUser` normalizes whatever the server returns so a partial response
 * still renders a usable row instead of crashing the page.
 */

export type UserRole = "admin" | "user";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly subscription: string;
  readonly role: UserRole;
  readonly emailVerified: boolean;
  readonly isActive: boolean;
}

export interface AuthResult {
  readonly token: string;
  readonly user: User;
}

export interface SendCodeResult {
  readonly status: string;
  readonly devCode?: string | undefined;
}

export interface StatusResult {
  readonly status: string;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseUser(value: unknown): User {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    id: asString(record.id, ""),
    email: asString(record.email, ""),
    displayName: asString(record.displayName, ""),
    createdAt: asString(record.createdAt, ""),
    subscription: asString(record.subscription, "free"),
    role: asString(record.role, "user") === "admin" ? "admin" : "user",
    emailVerified: asBoolean(record.emailVerified, false),
    isActive: asBoolean(record.isActive, true),
  };
}
