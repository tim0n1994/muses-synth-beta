import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 JWT signer/verifier, hand-rolled for the mail2profile port.
 *
 * Deviation from the contract: the skill uses PyJWT; Muses hand-writes HS256
 * with node:crypto to keep the zero-new-dependency constraint. Only HS256 is
 * accepted on verify (the header `alg` must be exactly "HS256"), so algorithm
 * confusion is not possible. Signature comparison uses timingSafeEqual and
 * expiry (`exp`, seconds) is enforced.
 */

export interface JwtClaims {
  readonly sub: string;
  readonly email: string;
  readonly iat: number;
  readonly exp: number;
}

const JWT_HEADER_JSON = '{"alg":"HS256","typ":"JWT"}';

function base64Url(input: Buffer): string {
  return input.toString("base64url");
}

function decodeJsonPart(part: string): unknown {
  try {
    return JSON.parse(
      Buffer.from(part, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    return undefined;
  }
}

export function signJwt(claims: JwtClaims, secret: string): string {
  const headerPart = base64Url(Buffer.from(JWT_HEADER_JSON, "utf8"));
  const payloadPart = base64Url(Buffer.from(JSON.stringify(claims), "utf8"));
  const signature = createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  return `${headerPart}.${payloadPart}.${base64Url(signature)}`;
}

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (
    headerPart === undefined ||
    payloadPart === undefined ||
    signaturePart === undefined
  ) {
    return null;
  }

  const header = decodeJsonPart(headerPart);
  if (
    typeof header !== "object" ||
    header === null ||
    (header as { alg?: unknown }).alg !== "HS256"
  ) {
    return null;
  }

  const signature = Buffer.from(signaturePart, "base64url");
  const expected = createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  if (signature.length !== expected.length) {
    return null;
  }
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  const payload = decodeJsonPart(payloadPart);
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const candidate = payload as {
    sub?: unknown;
    email?: unknown;
    exp?: unknown;
    iat?: unknown;
  };
  if (
    typeof candidate.sub !== "string" ||
    candidate.sub.length === 0 ||
    typeof candidate.email !== "string" ||
    typeof candidate.exp !== "number" ||
    !Number.isFinite(candidate.exp)
  ) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= candidate.exp) {
    return null;
  }

  return {
    sub: candidate.sub,
    email: candidate.email,
    exp: candidate.exp,
    iat: typeof candidate.iat === "number" ? candidate.iat : nowSeconds,
  };
}
