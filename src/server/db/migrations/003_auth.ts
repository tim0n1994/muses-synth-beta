/**
 * Migration 003 — account tables for the optional auth module.
 *
 * Ported from the mail2profile skill contract (users + email_verifications).
 * Deviations from the contract schema, all deliberate:
 *   - The skill's optional business columns (subscription / is_anonymous /
 *     birth_profile_json) are NOT carried over: Muses has no subscription or
 *     birth-profile domain. The public user shape still reports a constant
 *     `subscription: "free"` for frontend shape compatibility.
 *   - oauth_accounts is omitted: the skill itself treats OAuth as an optional
 *     extension that hosts add on demand.
 *   - Columns are NOT NULL / CHECK-constrained (STRICT tables), a safe
 *     tightening of the skill's loose CREATE TABLE.
 */
export const migration003Auth = {
  version: 3,
  name: "auth_users_and_email_verifications",
  sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT;

CREATE TABLE email_verifications (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;

CREATE INDEX idx_verif_email ON email_verifications (email, purpose);
`,
} as const;
