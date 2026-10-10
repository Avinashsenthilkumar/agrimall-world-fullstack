// POST /api/auth/password/change — signed-in password change.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok, parseBody, unauthorized, unprocessable } from '../../../../../lib/server/http';
import { changePasswordSchema } from '../../../../../lib/server/schemas';
import { requireUser } from '../../../../../lib/server/auth';
import { hashPassword, verifyPassword, checkPasswordPolicy } from '../../../../../lib/server/password';
import { revokeAllSessions, createSession } from '../../../../../lib/server/session';
import { auditNow, clientIp } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const session = await requireUser();
  const body = await parseBody(req, changePasswordSchema);

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw unauthorized();

  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw unprocessable('Your current password is not correct.', {
      currentPassword: ['That is not your current password.'],
    });
  }

  const policy = checkPasswordPolicy(body.newPassword);
  if (!policy.valid) throw unprocessable('Please choose a stronger password.', { newPassword: policy.problems });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });

  // Invalidate everything, then re-issue a session for this device so the
  // user isn't logged out of the tab they're using.
  await revokeAllSessions(user.id);
  await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip: clientIp(req) });
  await auditNow({ actorId: user.id, actorRole: user.role, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id });

  return ok({ message: 'Password updated. Other devices have been signed out.' });
});
