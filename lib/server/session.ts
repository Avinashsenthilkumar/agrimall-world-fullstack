// lib/server/session.ts — §3. Secure, server-verified sessions.
//
// How it works:
//   1. On login we mint a random 32-byte session id.
//   2. The RAW id goes to the browser in an HttpOnly + SameSite=Lax +
//      Secure cookie. JavaScript cannot read it, so XSS cannot steal it.
//   3. Only a SHA-256 HASH of the id is stored in the sessions table. A
//      leaked database dump therefore cannot be used to impersonate anyone.
//   4. Every protected request looks the session up in Postgres and re-reads
//      the user's CURRENT role. Nothing about identity is taken from the
//      client, and revoking a session or demoting a user takes effect on the
//      very next request (unlike a self-contained JWT).

import { cookies } from 'next/headers';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from './prisma';
import { env, isProd } from './env';
import type { Role } from '@prisma/client';

export const SESSION_COOKIE = 'agrimall_session';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface SessionUser {
  userId: string;
  email: string;
  role: Role;
  name: string | null;
  isActive: boolean;
  /** Present when role === SELLER. */
  sellerId?: string;
  sellerStatus?: string;
  /** Present when role === CUSTOMER. */
  customerId?: string;
}

/** Mint a session and set the cookie. Returns the raw token (for tests). */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ip: meta.ip ?? null,
      expiresAt,
    },
  });

  cookies().set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return raw;
}

/**
 * Read the current session from the cookie and resolve it against the DB.
 * Returns null when there is no valid session. NEVER throws.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return resolveSessionToken(raw);
}

/** Token-based resolution, shared by the cookie path and the test harness. */
export async function resolveSessionToken(raw: string): Promise<SessionUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          name: true,
          isActive: true,
          seller: { select: { id: true, status: true } },
          customer: { select: { id: true } },
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;

  return {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    name: session.user.name,
    isActive: session.user.isActive,
    ...(session.user.seller
      ? { sellerId: session.user.seller.id, sellerStatus: session.user.seller.status }
      : {}),
    ...(session.user.customer ? { customerId: session.user.customer.id } : {}),
  };
}

/** Log out: revoke server-side AND clear the cookie. */
export async function destroySession(): Promise<void> {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (raw) {
    await prisma.session
      .updateMany({
        where: { tokenHash: hashToken(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }
  cookies().delete(SESSION_COOKIE);
}

/** Revoke every session for a user — used on password change and on ban. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Housekeeping, called by /api/cron/cleanup. */
export async function purgeExpiredSessions(): Promise<number> {
  const res = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } },
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// One-time tokens (email verification, password reset)
// ---------------------------------------------------------------------------

export async function createVerificationToken(
  userId: string,
  purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'PHONE_VERIFY',
  ttlMinutes = 60,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      purpose,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    },
  });
  return raw;
}

/** Consume a token atomically — a reset link works exactly once. */
export async function consumeVerificationToken(
  raw: string,
  purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'PHONE_VERIFY',
): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(raw);
  const row = await prisma.verificationToken.findUnique({ where: { tokenHash } });
  if (!row) return null;
  if (row.purpose !== purpose) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  // updateMany with usedAt:null makes double-use impossible even under a race.
  const claimed = await prisma.verificationToken.updateMany({
    where: { tokenHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  return { userId: row.userId };
}

/** Constant-time string compare for signatures and secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
