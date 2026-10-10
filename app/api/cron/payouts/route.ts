// POST /api/cron/payouts — §13. Promotes eligible payouts to PROCESSING.
//
// It never marks anything PAID: that still requires the provider's
// confirmation through the admin endpoint.
import { handler, ok } from '../../../../lib/server/http';
import { assertCronSecret } from '../../../../lib/server/payments';
import { submitPayoutBatch } from '../../../../lib/server/payouts';
import { prisma } from '../../../../lib/server/prisma';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  assertCronSecret(req);

  // Attribute the batch to a system admin for the audit trail.
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const result = await submitPayoutBatch({
    actorId: admin?.id ?? 'system',
    limit: 500,
  });

  return ok({
    ...result,
    note: 'Payouts are now PROCESSING. Confirm each as PAID once the payment provider reports success.',
  });
});
