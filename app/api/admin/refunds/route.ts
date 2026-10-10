// GET  /api/admin/refunds — refund ledger.
// POST /api/admin/refunds — issue a refund (§18).
//
// Issuing a refund moves customer money, platform commission, seller earning,
// inventory and the payout together, in one transaction.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, created, parseBody } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { refundSchema } from '../../../../lib/server/schemas';
import { issueRefund } from '../../../../lib/server/returns';
import { refundWithProvider } from '../../../../lib/server/payments';
import { onlinePaymentConfigured } from '../../../../lib/server/env';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  await requireAdmin();
  const refunds = await prisma.refund.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      order: { select: { orderNumber: true } },
      sellerOrder: {
        select: { sellerOrderNumber: true, seller: { select: { businessName: true } } },
      },
      returnRequest: { select: { returnNumber: true, reason: true } },
    },
  });

  const totals = await prisma.refund.groupBy({
    by: ['status'],
    _sum: { amount: true, commissionReversed: true, sellerDebit: true },
    _count: true,
  });

  return ok({
    refunds: refunds.map((r) => ({
      id: r.id,
      orderNumber: r.order.orderNumber,
      sellerOrderNumber: r.sellerOrder?.sellerOrderNumber ?? null,
      sellerName: r.sellerOrder?.seller.businessName ?? null,
      returnNumber: r.returnRequest?.returnNumber ?? null,
      amount: r.amount,
      commissionReversed: r.commissionReversed,
      sellerDebit: r.sellerDebit,
      reason: r.reason,
      status: r.status,
      providerRefundId: r.providerRefundId,
      processedAt: r.processedAt,
      createdAt: r.createdAt,
    })),
    totals: totals.map((t) => ({
      status: t.status,
      amount: t._sum.amount ?? 0,
      commissionReversed: t._sum.commissionReversed ?? 0,
      sellerDebit: t._sum.sellerDebit ?? 0,
      count: t._count,
    })),
  });
});

export const POST = handler(async (req: Request) => {
  const session = await requireAdmin();
  const body = await parseBody(req, refundSchema);

  const result = await issueRefund({
    sellerOrderId: body.sellerOrderId,
    amountPaise: body.amountRupees != null ? Math.round(body.amountRupees * 100) : undefined,
    reason: body.reason,
    returnId: body.returnId,
    actor: { userId: session.userId, role: 'ADMIN' },
    // With no provider keys the ledger is still correct; the transfer is
    // flagged as needing a manual bank transfer rather than faked.
    processWithProvider: onlinePaymentConfigured()
      ? (input) =>
          refundWithProvider({
            providerPaymentId: input.providerPaymentId,
            amountPaise: input.amountPaise,
            reason: body.reason,
          })
      : undefined,
  });

  return created({
    refund: result,
    message: result.providerRefundId
      ? `₹${(result.amount / 100).toLocaleString('en-IN')} refunded via the payment provider. Commission of ₹${(result.commissionReversed / 100).toLocaleString('en-IN')} reversed.`
      : `Refund of ₹${(result.amount / 100).toLocaleString('en-IN')} recorded. No payment provider is configured, so the transfer must be made manually.`,
  });
});
