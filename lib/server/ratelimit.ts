// lib/server/ratelimit.ts — brute-force protection for auth endpoints.
//
// An in-process fixed-window counter. Honest about its limits: it is per
// instance, so behind multiple servers it should be swapped for Redis (the
// interface below is deliberately the same shape). It is still worth having —
// it stops a single host hammering /api/auth/login thousands of times.
//
// Account lockout (User.failedLoginAttempts / lockedUntil) is the durable,
// cross-instance half of the defence and lives in the login route.

import { tooManyRequests } from './http';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
  // Hard cap so a flood of distinct keys can't grow the map without bound.
  if (buckets.size > 50_000) buckets.clear();
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Throws a 429 when over the limit. */
export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const result = rateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw tooManyRequests(
      `Too many attempts. Please try again in ${result.retryAfterSeconds} second(s).`,
    );
  }
}

/** Reset a key after a legitimate success, so one bad typo isn't punished. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

export const LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  checkout: { limit: 20, windowMs: 10 * 60_000 },
  upload: { limit: 40, windowMs: 10 * 60_000 },
  review: { limit: 20, windowMs: 60 * 60_000 },
  coupon: { limit: 30, windowMs: 10 * 60_000 },
} as const;
