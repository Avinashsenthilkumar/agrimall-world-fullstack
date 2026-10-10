// GET /api/auth/me — who the server thinks you are. The client never decides.
import { handler, ok } from '../../../../lib/server/http';
import { getSessionUser } from '../../../../lib/server/session';
import { prisma } from '../../../../lib/server/prisma';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await getSessionUser();
  if (!session) return ok({ user: null });

  const unread = await prisma.notification.count({
    where: { userId: session.userId, readAt: null },
  });

  return ok({
    user: {
      id: session.userId,
      email: session.email,
      name: session.name,
      role: session.role,
      sellerId: session.sellerId ?? null,
      sellerStatus: session.sellerStatus ?? null,
      customerId: session.customerId ?? null,
    },
    unreadNotifications: unread,
  });
});
