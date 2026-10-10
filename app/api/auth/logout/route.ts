// POST /api/auth/logout — revokes the session server-side, not just the cookie.
import { handler, ok } from '../../../../lib/server/http';
import { destroySession } from '../../../../lib/server/session';

export const dynamic = 'force-dynamic';

export const POST = handler(async () => {
  await destroySession();
  return ok({ signedOut: true });
});
