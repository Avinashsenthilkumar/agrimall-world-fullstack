// GET /api/admin/sellers/[id] — the KYC review screen.
//
// This is the one place KYC identifiers are returned, to the one role that
// needs them, and every access is written to the audit log.
import { handler, ok } from '../../../../../lib/server/http';
import { requireAdmin } from '../../../../../lib/server/auth';
import { adminSellerDetail } from '../../../../../lib/server/sellers';
import { auditNow, clientIp } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireAdmin();
  const seller = await adminSellerDetail(params.id);

  // Viewing someone's KYC is itself a privileged act. Record it.
  await auditNow({
    actorId: session.userId,
    actorRole: 'ADMIN',
    action: 'KYC_VIEWED',
    entityType: 'Seller',
    entityId: params.id,
    ip: clientIp(req),
  });

  return ok({
    seller: {
      ...seller,
      commissionRate: seller.commissionRate != null ? Number(seller.commissionRate) : null,
      ratingAvg: Number(seller.ratingAvg),
      productCount: seller._count.products,
      orderCount: seller._count.sellerOrders,
      _count: undefined,
    },
  });
});
