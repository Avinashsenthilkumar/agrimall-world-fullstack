// GET /api/seller/returns — returns raised against this seller's parcels.
import { handler, ok } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';
import { listReturns } from '../../../../lib/server/returns';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const session = await requireSeller();
  const status = new URL(req.url).searchParams.get('status') ?? undefined;
  const returns = await listReturns({ sellerId: session.sellerId, status });
  return ok({ returns });
});
