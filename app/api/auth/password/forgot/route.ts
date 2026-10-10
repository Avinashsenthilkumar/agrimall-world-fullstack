// POST /api/auth/password/forgot
//
// Always answers the same way, whether or not the address is registered —
// otherwise this endpoint becomes a way to enumerate customer emails.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok, parseBody } from '../../../../../lib/server/http';
import { requestPasswordResetSchema } from '../../../../../lib/server/schemas';
import { createVerificationToken } from '../../../../../lib/server/session';
import { enforceRateLimit, LIMITS } from '../../../../../lib/server/ratelimit';
import { sendEmail, passwordResetTemplate } from '../../../../../lib/server/notifications';
import { clientIp } from '../../../../../lib/server/audit';
import { env } from '../../../../../lib/server/env';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const ip = clientIp(req) ?? 'unknown';
  enforceRateLimit(`pwreset:${ip}`, LIMITS.passwordReset.limit, LIMITS.passwordReset.windowMs);

  const body = await parseBody(req, requestPasswordResetSchema);
  const user = await prisma.user.findUnique({ where: { email: body.email } });

  if (user && user.isActive) {
    const token = await createVerificationToken(user.id, 'PASSWORD_RESET', 60);
    const tpl = passwordResetTemplate({
      name: user.name ?? 'there',
      resetUrl: `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`,
    });
    await sendEmail({ ...tpl, to: user.email });
  }

  return ok({
    message: 'If an account exists for that address, a reset link is on its way.',
  });
});
