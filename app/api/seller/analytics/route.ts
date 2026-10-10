// GET /api/seller/analytics — §5 "Analytics": sales, top products, trend.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const session = await requireSeller();
  const days = Math.min(Number(new URL(req.url).searchParams.get('days') ?? 30), 365);
  const since = new Date(Date.now() - days * 86_400_000);

  const [daily, topProducts, statusMix, totals] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string; revenue: bigint; orders: bigint }>>`
      SELECT to_char(date_trunc('day', so."createdAt"), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(so."grossAmount"), 0)::bigint AS revenue,
             COUNT(*)::bigint AS orders
      FROM "seller_orders" so
      WHERE so."sellerId" = ${session.sellerId}
        AND so."paymentStatus" = 'CAPTURED'
        AND so."createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1 ASC
    `,
    prisma.$queryRaw<Array<{ productId: string; name: string; units: bigint; revenue: bigint }>>`
      SELECT oi."productId"            AS "productId",
             oi."productNameSnapshot"  AS name,
             SUM(oi."quantity")::bigint AS units,
             SUM(oi."total")::bigint    AS revenue
      FROM "order_items" oi
      JOIN "seller_orders" so ON so."id" = oi."sellerOrderId"
      WHERE oi."sellerId" = ${session.sellerId}
        AND so."paymentStatus" = 'CAPTURED'
        AND so."createdAt" >= ${since}
      GROUP BY 1, 2
      ORDER BY revenue DESC
      LIMIT 10
    `,
    prisma.sellerOrder.groupBy({
      by: ['status'],
      where: { sellerId: session.sellerId, createdAt: { gte: since }, paymentStatus: 'CAPTURED' },
      _count: true,
    }),
    prisma.sellerOrder.aggregate({
      where: { sellerId: session.sellerId, createdAt: { gte: since }, paymentStatus: 'CAPTURED' },
      _sum: { grossAmount: true, sellerEarning: true, commissionAmount: true },
      _count: true,
      _avg: { grossAmount: true },
    }),
  ]);

  return ok({
    periodDays: days,
    totals: {
      revenue: totals._sum.grossAmount ?? 0,
      earning: totals._sum.sellerEarning ?? 0,
      commission: totals._sum.commissionAmount ?? 0,
      orders: totals._count,
      averageOrderValue: Math.round(totals._avg.grossAmount ?? 0),
    },
    daily: daily.map((d) => ({ day: d.day, revenue: Number(d.revenue), orders: Number(d.orders) })),
    topProducts: topProducts.map((p) => ({
      productId: p.productId,
      name: p.name,
      units: Number(p.units),
      revenue: Number(p.revenue),
    })),
    statusMix: statusMix.map((s) => ({ status: s.status, count: s._count })),
  });
});
