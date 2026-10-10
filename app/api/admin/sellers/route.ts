// GET /api/admin/sellers — the seller directory and approval queue (§21).
import { handler, ok, parseQuery } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { listSellersForAdmin } from '../../../../lib/server/sellers';
import { paginationSchema } from '../../../../lib/server/schemas';
import type { SellerStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const { page, perPage } = parseQuery(req, paginationSchema);
  const url = new URL(req.url);

  const result = await listSellersForAdmin({
    status: (url.searchParams.get('status') as SellerStatus) ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page,
    perPage,
  });

  return ok({
    sellers: result.rows.map((s) => ({
      ...s,
      commissionRate: s.commissionRate != null ? Number(s.commissionRate) : null,
      productCount: s._count.products,
      orderCount: s._count.sellerOrders,
      _count: undefined,
    })),
    pagination: {
      page: result.page,
      perPage: result.perPage,
      total: result.total,
      pages: result.pages,
    },
  });
});
