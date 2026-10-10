// POST /api/auth/login — one login for all roles (§3).
//
// Defences: per-IP rate limit, per-account lockout after repeated failures,
// a single generic error message so the response can't be used to discover
// which emails are registered, and bcrypt comparison that takes the same time
// whether or not the user exists.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseBody, unauthorized, forbidden } from '../../../../lib/server/http';
import { loginSchema } from '../../../../lib/server/schemas';
import { verifyPassword, needsRehash, hashPassword } from '../../../../lib/server/password';
import { createSession } from '../../../../lib/server/session';
import { enforceRateLimit, clearRateLimit, LIMITS } from '../../../../lib/server/ratelimit';
import { auditNow, clientIp } from '../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export const POST = handler(async (req: Request) => {
  const ip = clientIp(req) ?? 'unknown';
  const body = await parseBody(req, loginSchema);

  enforceRateLimit(`login:${ip}`, LIMITS.login.limit, LIMITS.login.windowMs);
  enforceRateLimit(`login:${body.email}`, LIMITS.login.limit, LIMITS.login.windowMs);

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    include: { seller: { select: { id: true, status: true } }, customer: { select: { id: true } } },
  });

  // Deliberately identical for "no such user" and "wrong password".
  const genericFailure = unauthorized('Those sign-in details are not correct.');

  if (!user) {
    // Burn the same time a real comparison would take.
    await verifyPassword(body.password, '');
    throw genericFailure;
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw forbidden(`Too many failed attempts. Please try again in ${mins} minute(s).`);
  }

  if (!user.isActive) throw forbidden('This account has been deactivated. Please contact support.');

  const valid = await verifyPassword(body.password, user.passwordHash);

  if (!valid) {
    const failed = user.failedLoginAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    await auditNow({ actorId: user.id, action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id, ip });
    throw genericFailure;
  }

  // Success: reset counters, upgrade the hash if the work factor has moved on.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(needsRehash(user.passwordHash)
        ? { passwordHash: await hashPassword(body.password) }
        : {}),
    },
  });

  clearRateLimit(`login:${body.email}`);
  await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip });
  await auditNow({ actorId: user.id, actorRole: user.role, action: 'LOGIN', entityType: 'User', entityId: user.id, ip });

  return ok({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: Boolean(user.emailVerifiedAt),
      sellerId: user.seller?.id ?? null,
      sellerStatus: user.seller?.status ?? null,
      customerId: user.customer?.id ?? null,
    },
    // Where the UI should send them after login.
    redirectTo:
      user.role === 'ADMIN'
        ? '/admin'
        : user.role === 'SELLER'
          ? '/seller/dashboard'
          : user.role === 'LOGISTICS'
            ? '/logistics'
            : '/customer',
  });
});
