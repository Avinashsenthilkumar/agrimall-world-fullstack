// GET /api/admin/dashboard — §21. Platform-wide overview.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { getPlatformFinanceSummary } from '../../../../lib/server/payouts';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  await requireAdmin();

  const [finance, counts, recentOrders, trend, topSellers] = await Promise.all([
    getPlatformFinanceSummary(),
    Promise.all([
      prisma.customer.count(),
      prisma.seller.count(),
      prisma.seller.count({ where: { status: 'APPROVED' } }),
      prisma.seller.count({ where: { status: { in: ['PENDING_REVIEW', 'UNDER_REVIEW'] } } }),
      prisma.product.count({ where: { status: 'ACTIVE', approvalStatus: 'APPROVED' } }),
      prisma.product.count({ where: { approvalStatus: 'PENDING' } }),
      prisma.order.count(),
      prisma.returnRequest.count({ where: { status: { notIn: ['COMPLETED', 'REJECTED', 'CANCELLED'] } } }),
      prisma.payout.count({ where: { status: 'PENDING', eligibleAt: { lte: new Date() } } }),
    ]),
    prisma.order.findMany({
      where: { paymentStatus: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        orderStatus: true,
        createdAt: true,
        customer: { select: { fullName: true } },
        sellerOrders: {
          select: {
            sellerOrderNumber: true,
            status: true,
            grossAmount: true,
            commissionAmount: true,
            seller: { select: { businessName: true } },
          },
        },
      },
    }),
    prisma.$queryRaw<Array<{ day: string; gmv: bigint; revenue: bigint; orders: bigint }>>`
      SELECT to_char(date_trunc('day', o."createdAt"), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(o."grandTotal"), 0)::bigint AS gmv,
             COALESCE((
               SELECT SUM(so."commissionAmount")
               FROM "seller_orders" so
               WHERE so."orderId" = ANY(array_agg(o."id"))
             ), 0)::bigint AS revenue,
             COUNT(*)::bigint AS orders
      FROM "orders" o
      WHERE o."paymentStatus" IN ('CAPTURED','PARTIALLY_REFUNDED')
        AND o."createdAt" >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 ASC
    `,
    prisma.$queryRaw<Array<{ sellerId: string; name: string; revenue: bigint; orders: bigint }>>`
      SELECT s."id" AS "sellerId", s."businessName" AS name,
             COALESCE(SUM(so."grossAmount"), 0)::bigint AS revenue,
             COUNT(so."id")::bigint AS orders
      FROM "sellers" s
      LEFT JOIN "seller_orders" so
        ON so."sellerId" = s."id" AND so."paymentStatus" = 'CAPTURED'
      WHERE s."status" = 'APPROVED'
      GROUP BY 1, 2
      ORDER BY revenue DESC
      LIMIT 10
    `,
  ]);

  const [
    customerCount, sellerCount, approvedSellers, pendingSellers,
    activeProducts, pendingProducts, orderCount, openReturns, payoutsDue,
  ] = counts;

  return ok({
    finance,
    counts: {
      customers: customerCount,
      sellers: sellerCount,
      approvedSellers,
      pendingSellers,
      activeProducts,
      pendingProducts,
      orders: orderCount,
      openReturns,
      payoutsDue,
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customer: o.customer.fullName,
      total: o.grandTotal,
      status: o.orderStatus,
      createdAt: o.createdAt,
      // Admin sees the full split — the view neither seller gets.
      sellerOrders: o.sellerOrders.map((so) => ({
        sellerOrderNumber: so.sellerOrderNumber,
        sellerName: so.seller.businessName,
        status: so.status,
        gross: so.grossAmount,
        commission: so.commissionAmount,
      })),
    })),
    trend: trend.map((t) => ({
      day: t.day,
      gmv: Number(t.gmv),
      revenue: Number(t.revenue),
      orders: Number(t.orders),
    })),
    topSellers: topSellers.map((s) => ({
      sellerId: s.sellerId,
      name: s.name,
      revenue: Number(s.revenue),
      orders: Number(s.orders),
    })),
  });
});
