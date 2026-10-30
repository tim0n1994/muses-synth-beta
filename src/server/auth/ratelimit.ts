import type { FastifyRequest } from "fastify";

/**
 * Lightweight in-memory rate limiting, a faithful port of the mail2profile
 * skill's ratelimit.py: fixed-window counters keyed by endpoint + client,
 * process-local storage (accurate for the single-instance local authority),
 * garbage collection every 256 hits for windows idle over an hour.
 *
 * Unlike the skill there is no ENV=test bypass — tests construct fresh
 * limiter instances instead, which keeps production semantics unconditional.
 */

interface RateWindow {
  start: number;
  count: number;
}

export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface AuthRateLimits {
  readonly sendCode: RateLimitRule;
  readonly register: RateLimitRule;
  readonly login: RateLimitRule;
  readonly resetPassword: RateLimitRule;
}

/** Contract values: send-code 5/60s, register 5/60s, login 10/60s, reset 5/60s. */
export const CONTRACT_RATE_LIMITS: AuthRateLimits = Object.freeze({
  sendCode: Object.freeze({ limit: 5, windowSeconds: 60 }),
  register: Object.freeze({ limit: 5, windowSeconds: 60 }),
  login: Object.freeze({ limit: 10, windowSeconds: 60 }),
  resetPassword: Object.freeze({ limit: 5, windowSeconds: 60 }),
});

/**
 * Client identity for rate limiting. Only CF-Connecting-IP is trusted (the
 * Cloudflare edge overwrites it, so it cannot be spoofed through the
 * tunnel); visitor-supplied X-Forwarded-For entries survive proxy appending
 * and must never key a bucket — otherwise spoofed headers mint fresh
 * buckets and defeat every limit. Without the header, fall back to the
 * socket address (local/direct deployments).
 */
export function clientRateKey(request: FastifyRequest): string {
  const cf = request.headers["cf-connecting-ip"];
  const value = Array.isArray(cf) ? cf[0] : cf;
  if (typeof value === "string" && value.trim().length > 0) {
    return `ip:${value.trim()}`;
  }
  return `ip:${request.ip}`;
}

export class RateLimiter {
  private readonly buckets = new Map<string, RateWindow>();
  private gcCounter = 0;

  /** Records one request. Returns true when allowed, false when over limit. */
  public hit(key: string, limit: number, windowSeconds: number): boolean {
    const now = Date.now();
    this.gcCounter += 1;
    if (this.gcCounter > 256) {
      this.gc(now);
      this.gcCounter = 0;
    }
    const existing = this.buckets.get(key);
    if (existing === undefined || now - existing.start > windowSeconds * 1000) {
      this.buckets.set(key, { start: now, count: 1 });
      return true;
    }
    existing.count += 1;
    return existing.count <= limit;
  }

  private gc(now: number): void {
    for (const [key, window] of this.buckets.entries()) {
      if (now - window.start > 3_600_000) {
        this.buckets.delete(key);
      }
    }
  }

  /** Test helper: forget every window. */
  public clear(): void {
    this.buckets.clear();
  }
}
