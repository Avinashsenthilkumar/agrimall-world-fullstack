// GET   /api/notifications — this user's notifications.
// PATCH /api/notifications — mark read.
import { handler, ok, parseBody } from '../../../lib/server/http';
import { requireUser } from '../../../lib/server/auth';
import { listNotifications, markNotificationsRead } from '../../../lib/server/notifications';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const session = await requireUser();
  const unreadOnly = new URL(req.url).searchParams.get('unread') === 'true';
  const notifications = await listNotifications(session.userId, { unreadOnly });
  return ok({
    notifications,
    unreadCount: notifications.filter((n) => !n.readAt).length,
  });
});

export const PATCH = handler(async (req: Request) => {
  const session = await requireUser();
  const body = await parseBody(req, z.object({ ids: z.array(z.string()).max(200).optional() }).strict());
  const count = await markNotificationsRead(session.userId, body.ids);
  return ok({ markedRead: count });
});
