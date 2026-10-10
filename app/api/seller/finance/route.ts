// GET /api/seller/finance — §5 "Finance". Gross, commission, refunds, net.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';
import { getSellerEarnings } from '../../../../lib/server/payouts';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireSeller();

  const [earnings, commissions, refunds, monthly] = await Promise.all([
    getSellerEarnings(session.sellerId),
    prisma.commission.findMany({
      where: { sellerId: session.sellerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        sellerOrder: { select: { sellerOrderNumber: true, status: true, createdAt: true } },
      },
    }),
    prisma.refund.findMany({
      where: { sellerOrder: { sellerId: session.sellerId } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { sellerOrder: { select: { sellerOrderNumber: true } } },
    }),
    // 12-month revenue trend for the chart.
    prisma.$queryRaw<Array<{ month: string; gross: bigint; commission: bigint; earning: bigint; orders: bigint }>>`
      SELECT to_char(date_trunc('month', so."createdAt"), 'YYYY-MM') AS month,
             COALESCE(SUM(so."grossAmount"), 0)::bigint      AS gross,
             COALESCE(SUM(so."commissionAmount"), 0)::bigint AS commission,
             COALESCE(SUM(so."sellerEarning"), 0)::bigint    AS earning,
             COUNT(*)::bigint                                AS orders
      FROM "seller_orders" so
      WHERE so."sellerId" = ${session.sellerId}
        AND so."paymentStatus" = 'CAPTURED'
        AND so."createdAt" >= date_trunc('month', now()) - interval '11 months'
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  ]);

  return ok({
    summary: earnings,
    commissions: commissions.map((c) => ({
      id: c.id,
      sellerOrderNumber: c.sellerOrder.sellerOrderNumber,
      orderStatus: c.sellerOrder.status,
      rate: Number(c.rate),
      gross: c.grossAmount,
      commission: c.commissionAmount,
      earning: c.sellerAmount,
      reversed: c.reversedAmount,
      status: c.status,
      createdAt: c.createdAt,
    })),
    refunds: refunds.map((r) => ({
      id: r.id,
      sellerOrderNumber: r.sellerOrder?.sellerOrderNumber ?? null,
      amount: r.amount,
      commissionReversed: r.commissionReversed,
      sellerDebit: r.sellerDebit,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
    monthly: monthly.map((m) => ({
      month: m.month,
      gross: Number(m.gross),
      commission: Number(m.commission),
      earning: Number(m.earning),
      orders: Number(m.orders),
    })),
  });
});
