// POST /api/auth/verify-email
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseBody, badRequest } from '../../../../lib/server/http';
import { verifyEmailSchema } from '../../../../lib/server/schemas';
import { consumeVerificationToken } from '../../../../lib/server/session';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const body = await parseBody(req, verifyEmailSchema);
  const claimed = await consumeVerificationToken(body.token, 'EMAIL_VERIFY');
  if (!claimed) throw badRequest('That verification link is invalid or has expired.');

  await prisma.user.update({
    where: { id: claimed.userId },
    data: { emailVerifiedAt: new Date() },
  });
  return ok({ verified: true });
});
