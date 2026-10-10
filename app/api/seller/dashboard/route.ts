// GET /api/seller/dashboard — §5. This seller's numbers only.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';
import { getSellerDashboardStats } from '../../../../lib/server/sellers';
import { getSellerEarnings } from '../../../../lib/server/payouts';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  // requireSeller (not requireApprovedSeller) so a pending seller still sees
  // their dashboard, with a banner explaining what is blocked.
  const session = await requireSeller();

  const seller = await prisma.seller.findUnique({
    where: { id: session.sellerId },
    select: {
      businessName: true,
      status: true,
      rejectionReason: true,
      commissionRate: true,
      city: true,
      state: true,
      kyc: { select: { verificationStatus: true, submittedAt: true, rejectionReason: true } },
    },
  });

  const isApproved = seller?.status === 'APPROVED';

  // A non-approved seller has no sales, so skip the aggregate queries.
  const [stats, earnings, recentOrders, lowStock] = await Promise.all([
    isApproved ? getSellerDashboardStats(session.sellerId) : null,
    isApproved ? getSellerEarnings(session.sellerId) : null,
    isApproved
      ? prisma.sellerOrder.findMany({
          where: { sellerId: session.sellerId, paymentStatus: 'CAPTURED' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            sellerOrderNumber: true,
            status: true,
            grossAmount: true,
            sellerEarning: true,
            createdAt: true,
            items: { select: { productNameSnapshot: true, quantity: true } },
            order: { select: { orderNumber: true, shippingAddress: true } },
          },
        })
      : [],
    isApproved
      ? prisma.$queryRaw<Array<{ id: string; name: string; available: number; threshold: number }>>`
          SELECT p."id", p."name",
                 (i."onHand" - i."reserved") AS available,
                 i."lowStockThreshold" AS threshold
          FROM "inventory" i
          JOIN "products" p ON p."id" = i."productId"
          WHERE p."sellerId" = ${session.sellerId}
            AND (i."onHand" - i."reserved") <= i."lowStockThreshold"
          ORDER BY available ASC
          LIMIT 10
        `
      : [],
  ]);

  return ok({
    seller: {
      businessName: seller?.businessName ?? '',
      status: seller?.status ?? 'DRAFT',
      rejectionReason: seller?.rejectionReason ?? null,
      commissionRate: seller?.commissionRate != null ? Number(seller.commissionRate) : null,
      location: [seller?.city, seller?.state].filter(Boolean).join(', '),
      kycStatus: seller?.kyc?.verificationStatus ?? 'DRAFT',
      kycRejectionReason: seller?.kyc?.rejectionReason ?? null,
      kycSubmittedAt: seller?.kyc?.submittedAt ?? null,
      canSell: isApproved,
    },
    stats,
    earnings,
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      sellerOrderNumber: o.sellerOrderNumber,
      orderNumber: o.order.orderNumber,
      status: o.status,
      total: o.grossAmount,
      earning: o.sellerEarning,
      createdAt: o.createdAt,
      itemsLabel: o.items
        .map((i) => `${i.productNameSnapshot}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
        .join(', '),
      // Only the city — a seller needs the destination, not the doorstep,
      // until they accept the order.
      destination: (o.order.shippingAddress as { city?: string })?.city ?? '',
    })),
    lowStock: lowStock.map((r) => ({
      id: r.id,
      name: r.name,
      available: Number(r.available),
      threshold: Number(r.threshold),
    })),
  });
});
