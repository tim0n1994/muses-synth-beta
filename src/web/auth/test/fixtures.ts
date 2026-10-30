import type { User } from "../types";

export const sessionToken = "jwt-test-token";

export const adminUser: User = {
  id: "u-admin",
  email: "root@muses.local",
  displayName: "Root",
  createdAt: "2026-10-01T08:00:00.000Z",
  subscription: "free",
  role: "admin",
  emailVerified: true,
  isActive: true,
};

export const memberUser: User = {
  id: "u-ada",
  email: "ada@muses.local",
  displayName: "Ada",
  createdAt: "2026-10-02T09:30:00.000Z",
  subscription: "free",
  role: "user",
  emailVerified: true,
  isActive: true,
};

export const disabledUser: User = {
  ...memberUser,
  id: "u-eve",
  email: "eve@muses.local",
  displayName: "Eve",
  createdAt: "2026-10-03T10:15:00.000Z",
  isActive: false,
};

export function authResult(user: User, token: string = sessionToken) {
  return { token, user };
}
