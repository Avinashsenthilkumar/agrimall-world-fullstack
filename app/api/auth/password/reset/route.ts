// POST /api/auth/password/reset — consume a single-use token, set a new password.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok, parseBody, badRequest, unprocessable } from '../../../../../lib/server/http';
import { resetPasswordSchema } from '../../../../../lib/server/schemas';
import { hashPassword, checkPasswordPolicy } from '../../../../../lib/server/password';
import { consumeVerificationToken, revokeAllSessions } from '../../../../../lib/server/session';
import { auditNow, clientIp } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const body = await parseBody(req, resetPasswordSchema);

  const policy = checkPasswordPolicy(body.password);
  if (!policy.valid) throw unprocessable('Please choose a stronger password.', { password: policy.problems });

  const claimed = await consumeVerificationToken(body.token, 'PASSWORD_RESET');
  if (!claimed) throw badRequest('That reset link is invalid or has expired. Please request a new one.');

  await prisma.user.update({
    where: { id: claimed.userId },
    data: {
      passwordHash: await hashPassword(body.password),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // A password reset signs out every device — the right behaviour if the
  // account was compromised.
  await revokeAllSessions(claimed.userId);
  await auditNow({
    actorId: claimed.userId,
    action: 'PASSWORD_RESET',
    entityType: 'User',
    entityId: claimed.userId,
    ip: clientIp(req),
  });

  return ok({ message: 'Your password has been changed. Please sign in.' });
});
