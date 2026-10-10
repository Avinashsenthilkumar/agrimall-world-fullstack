// POST /api/cron/release-reservations — §11. Frees stock from abandoned carts.
//
// Call every few minutes (Vercel Cron, systemd timer, or GitHub Actions):
//   curl -XPOST -H "x-cron-secret: $CRON_SECRET" https://.../api/cron/release-reservations
import { handler, ok } from '../../../../lib/server/http';
import { assertCronSecret } from '../../../../lib/server/payments';
import { releaseExpiredReservations } from '../../../../lib/server/inventory';
import { purgeExpiredSessions } from '../../../../lib/server/session';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  assertCronSecret(req);
  const released = await releaseExpiredReservations(500);
  const sessions = await purgeExpiredSessions();
  return ok({ reservationsReleased: released, sessionsPurged: sessions });
});
