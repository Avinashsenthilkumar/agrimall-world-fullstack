// GET /api/admin/audit — the privileged-action trail.
import { handler, ok, parseQuery } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { listAuditLogs } from '../../../../lib/server/audit';
import { paginationSchema } from '../../../../lib/server/schemas';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const { page, perPage } = parseQuery(req, paginationSchema);
  const url = new URL(req.url);

  const logs = await listAuditLogs({
    entityType: url.searchParams.get('entityType') ?? undefined,
    entityId: url.searchParams.get('entityId') ?? undefined,
    actorId: url.searchParams.get('actorId') ?? undefined,
    take: perPage,
    skip: (page - 1) * perPage,
  });

  return ok({ logs });
});
