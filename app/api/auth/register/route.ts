// POST /api/auth/register — customer sign-up (§6).
import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/server/prisma';
import { handler, created, parseBody, conflict, unprocessable } from '../../../../lib/server/http';
import { registerCustomerSchema } from '../../../../lib/server/schemas';
import { hashPassword, checkPasswordPolicy } from '../../../../lib/server/password';
import { createSession, createVerificationToken } from '../../../../lib/server/session';
import { enforceRateLimit, LIMITS } from '../../../../lib/server/ratelimit';
import { sendEmail, emailVerifyTemplate } from '../../../../lib/server/notifications';
import { auditNow, clientIp } from '../../../../lib/server/audit';
import { env } from '../../../../lib/server/env';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const ip = clientIp(req) ?? 'unknown';
  enforceRateLimit(`register:${ip}`, LIMITS.register.limit, LIMITS.register.windowMs);

  const body = await parseBody(req, registerCustomerSchema);

  const policy = checkPasswordPolicy(body.password);
  if (!policy.valid) throw unprocessable('Please choose a stronger password.', { password: policy.problems });

  const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (existing) throw conflict('An account with that email already exists. Please sign in.');

  const passwordHash = await hashPassword(body.password);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: body.email,
        phone: body.phone ?? null,
        passwordHash,
        role: 'CUSTOMER',
        name: body.name,
      },
    });
    const customer = await tx.customer.create({ data: { userId: u.id, fullName: body.name } });
    // Every customer gets a cart and a wishlist up front, so later code never
    // has to handle "the cart might not exist".
    await tx.cart.create({ data: { customerId: customer.id } });
    await tx.wishlist.create({ data: { customerId: customer.id } });
    return u;
  });

  // Email verification (§3). Delivery depends on EMAIL_DRIVER; the token is
  // always real and single-use.
  const token = await createVerificationToken(user.id, 'EMAIL_VERIFY', 60 * 24);
  const tpl = emailVerifyTemplate({
    name: body.name,
    verifyUrl: `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`,
  });
  await sendEmail({ ...tpl, to: user.email });

  await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip });
  await auditNow({ actorId: user.id, actorRole: 'CUSTOMER', action: 'CUSTOMER_REGISTERED', entityType: 'User', entityId: user.id, ip });

  return created({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: false },
  });
});
