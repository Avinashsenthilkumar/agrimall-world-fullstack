// GET /api/admin/returns — every open return across the platform.
import { handler, ok } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { listReturns } from '../../../../lib/server/returns';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const status = new URL(req.url).searchParams.get('status') ?? undefined;
  const returns = await listReturns({ status, take: 200 });
  return ok({ returns });
});
