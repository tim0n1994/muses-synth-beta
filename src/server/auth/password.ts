import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing, ported from the mail2profile skill.
 *
 * Deviation from the contract: node:crypto scrypt replaces bcrypt. Rationale:
 * Muses forbids new dependencies for this port and scrypt (N=16384, r=8, p=1
 * — the Node defaults, pinned explicitly) is an OWASP-accepted password
 * hashing function with no native addon requirement.
 *
 * Storage format: `scrypt$<saltHex>$<hashHex>` with a 16-byte random salt and
 * a 64-byte derived key. Comparison uses timingSafeEqual.
 */

const KEY_LENGTH_BYTES = 64;
const SALT_LENGTH_BYTES = 16;
const SCRYPT_PARAMETERS = { N: 16384, p: 1, r: 8 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const hash = scryptSync(password, salt, KEY_LENGTH_BYTES, SCRYPT_PARAMETERS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  const scheme = parts[0];
  const saltHex = parts[1];
  const hashHex = parts[2];
  if (
    parts.length !== 3 ||
    scheme !== "scrypt" ||
    saltHex === undefined ||
    hashHex === undefined
  ) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (salt.length === 0 || expected.length !== KEY_LENGTH_BYTES) {
    return false;
  }
  try {
    const actual = scryptSync(
      password,
      salt,
      KEY_LENGTH_BYTES,
      SCRYPT_PARAMETERS,
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Fixed dummy digest: when a login targets a missing user we still run a full
 * scrypt verification against this constant so the missing-user and
 * wrong-password paths are timing-identical (the contract's anti-enumeration
 * rule, hardened beyond the skill's same-message-only guarantee).
 */
export const DUMMY_PASSWORD_HASH: string = hashPassword(
  "muses-auth-timing-equalizer",
);
