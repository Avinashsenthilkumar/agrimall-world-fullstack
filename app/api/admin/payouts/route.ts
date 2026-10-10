// GET  /api/admin/payouts — the settlement queue (§13, §21).
// POST /api/admin/payouts — submit a batch, confirm paid, fail, or hold.
//
// MARK_PAID demands a providerReference. There is no way, through any route in
// this application, to mark a payout paid without evidence from the provider.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseBody, badRequest } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { payoutActionSchema } from '../../../../lib/server/schemas';
import {
  submitPayoutBatch,
  markPayoutPaid,
  markPayoutFailed,
  holdPayout,
} from '../../../../lib/server/payouts';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const sellerId = url.searchParams.get('sellerId');

  const where = {
    ...(status ? { status: status as never } : {}),
    ...(sellerId ? { sellerId } : {}),
  };

  const [payouts, groups, dueNow] = await Promise.all([
    prisma.payout.findMany({
      where,
      orderBy: [{ status: 'asc' }, { eligibleAt: 'asc' }],
      take: 100,
      include: {
        seller: {
          select: {
            id: true,
            businessName: true,
            bankAccount: {
              // Enough to reconcile a transfer; never the full account number.
              select: { accountHolderName: true, accountLast4: true, ifsc: true, isVerified: true },
            },
          },
        },
        sellerOrder: {
          select: {
            sellerOrderNumber: true,
            status: true,
            deliveredAt: true,
            order: { select: { orderNumber: true } },
          },
        },
      },
    }),
    prisma.payout.groupBy({ by: ['status'], _sum: { netAmount: true }, _count: true }),
    prisma.payout.aggregate({
      where: { status: 'PENDING', eligibleAt: { lte: new Date() } },
      _sum: { netAmount: true },
      _count: true,
    }),
  ]);

  return ok({
    payouts: payouts.map((p) => ({
      id: p.id,
      seller: p.seller,
      sellerOrderNumber: p.sellerOrder.sellerOrderNumber,
      customerOrderNumber: p.sellerOrder.order.orderNumber,
      deliveredAt: p.sellerOrder.deliveredAt,
      gross: p.grossAmount,
      commission: p.commissionAmount,
      refundAdjustment: p.refundAdjustment,
      net: p.netAmount,
      status: p.status,
      eligibleAt: p.eligibleAt,
      eligibleNow: p.status === 'PENDING' && Boolean(p.eligibleAt && p.eligibleAt <= new Date()),
      reference: p.providerReference,
      failureReason: p.failureReason,
      processedAt: p.processedAt,
    })),
    summary: {
      byStatus: groups.map((g) => ({
        status: g.status,
        amount: g._sum.netAmount ?? 0,
        count: g._count,
      })),
      dueNow: { amount: dueNow._sum.netAmount ?? 0, count: dueNow._count },
    },
  });
});

export const POST = handler(async (req: Request) => {
  const session = await requireAdmin();
  const body = await parseBody(req, payoutActionSchema);

  switch (body.action) {
    case 'SUBMIT_BATCH': {
      const result = await submitPayoutBatch({
        sellerId: body.sellerId,
        payoutIds: body.payoutIds,
        actorId: session.userId,
      });
      return ok({
        ...result,
        message:
          result.submitted === 0
            ? 'No payouts are eligible yet — they are released after each parcel clears its return window.'
            : `${result.submitted} payout(s) marked as processing, totalling ₹${(result.totalPaise / 100).toLocaleString('en-IN')}. Mark each paid once the provider confirms the transfer.`,
      });
    }

    case 'MARK_PAID': {
      if (!body.payoutId || !body.providerReference) throw badRequest('Payout and provider reference are required.');
      await markPayoutPaid({
        payoutId: body.payoutId,
        providerReference: body.providerReference,
        actorId: session.userId,
        actorRole: 'ADMIN',
      });
      return ok({ message: 'Payout confirmed as paid and the seller has been notified.' });
    }

    case 'MARK_FAILED': {
      if (!body.payoutId || !body.reason) throw badRequest('Payout and reason are required.');
      await markPayoutFailed({ payoutId: body.payoutId, reason: body.reason, actorId: session.userId });
      return ok({ message: 'Payout marked failed. It will be retried in the next batch.' });
    }

    case 'HOLD': {
      if (!body.payoutId || !body.reason) throw badRequest('Payout and reason are required.');
      await holdPayout({ payoutId: body.payoutId, reason: body.reason, actorId: session.userId });
      return ok({ message: 'Payout placed on hold.' });
    }

    default:
      throw badRequest('Unknown payout action.');
  }
});
