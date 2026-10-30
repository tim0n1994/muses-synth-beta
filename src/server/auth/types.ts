import type { FastifyRequest } from "fastify";

export type AuthPurpose = "register" | "reset";

export type UserRole = "user" | "admin";

/**
 * Public user shape, mirroring the mail2profile contract `User` interface.
 * `subscription` is reported as the constant "free" because the contract's
 * subscription column (an optional business field) is not carried to Muses.
 */
export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly subscription: string;
  readonly role: UserRole;
  readonly emailVerified: boolean;
  readonly isActive: boolean;
  readonly settings: Readonly<Record<string, unknown>>;
}

/** User as returned by the admin list endpoint. */
export interface AdminUserView extends PublicUser {
  /**
   * Always 0: the skill's ResourceHooks (count_user_resources) are not ported
   * because Muses has no per-user business resources. The field is kept for
   * frontend shape compatibility with the contract.
   */
  readonly reportCount: number;
}

export interface AuthSession {
  readonly user: PublicUser;
  readonly token: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by the bearer gate (and protected auth routes) after auth. */
    user?: PublicUser;
  }
}

export type AuthenticatedRequest = FastifyRequest;
