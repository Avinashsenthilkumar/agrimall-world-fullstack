// lib/server/payouts.ts — §13. Seller settlements.
//
// THE RULE THE SPEC IS EMPHATIC ABOUT:
//   "Do NOT automatically mark seller payouts as completed unless the payment
//    provider confirms the payout."
//
// So `markPayoutPaid` is reachable only from a verified provider callback or
// an explicit admin action that records a provider reference. Nothing in this
// codebase sets status = PAID on a timer.
//
// Lifecycle:
//   delivery        → Payout(PENDING, eligibleAt = delivered + return window)
//   window elapses  → PROCESSING (batch submitted to the provider)
//   provider says ok→ PAID (+ providerReference)
//   provider fails  → FAILED (+ failureReason), retryable
//   dispute/return  → ON_HOLD

import { prisma, type Tx } from './prisma';
import { conflict, notFound } from './http';
import { notify } from './notifications';
import { audit } from './audit';
import type { PayoutStatus } from '@prisma/client';

export interface SellerEarningsSummary {
  grossSales: number;
  commission: number;
  refunds: number;
  netEarnings: number;
  availableForPayout: number;
  pendingPayout: number;
  processingPayout: number;
  paidPayout: number;
  onHoldPayout: number;
}

/**
 * The seller's finance panel (§5 "Finance").
 *
 * Gross sales counts only CAPTURED sub-orders, so an unpaid order never
 * inflates a seller's dashboard.
 */
export async function getSellerEarnings(sellerId: string): Promise<SellerEarningsSummary> {
  const [captured, refundAgg, payoutGroups] = await Promise.all([
    prisma.sellerOrder.aggregate({
      where: { sellerId, paymentStatus: 'CAPTURED' },
      _sum: { grossAmount: true, commissionAmount: true, sellerEarning: true },
    }),
    prisma.refund.aggregate({
      where: { sellerOrder: { sellerId }, status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] } },
      _sum: { amount: true, sellerDebit: true },
    }),
    prisma.payout.groupBy({
      by: ['status'],
      where: { sellerId },
      _sum: { netAmount: true },
    }),
  ]);

  const byStatus = (s: PayoutStatus) =>
    payoutGroups.find((g) => g.status === s)?._sum.netAmount ?? 0;

  const grossSales = captured._sum.grossAmount ?? 0;
  const commission = captured._sum.commissionAmount ?? 0;
  const sellerEarning = captured._sum.sellerEarning ?? 0;
  const sellerDebit = refundAgg._sum.sellerDebit ?? 0;

  // What the seller may actually be paid now: delivered, past the return
  // window, not on hold.
  const available = await prisma.payout.aggregate({
    where: {
      sellerId,
      status: 'PENDING',
      eligibleAt: { lte: new Date() },
    },
    _sum: { netAmount: true },
  });

  return {
    grossSales,
    commission,
    refunds: refundAgg._sum.amount ?? 0,
    netEarnings: Math.max(0, sellerEarning - sellerDebit),
    availableForPayout: available._sum.netAmount ?? 0,
    pendingPayout: byStatus('PENDING'),
    processingPayout: byStatus('PROCESSING'),
    paidPayout: byStatus('PAID'),
    onHoldPayout: byStatus('ON_HOLD'),
  };
}

export async function listSellerPayouts(
  sellerId: string,
  opts: { take?: number; skip?: number } = {},
) {
  return prisma.payout.findMany({
    where: { sellerId },
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 50,
    skip: opts.skip ?? 0,
    include: {
      sellerOrder: {
        select: {
          sellerOrderNumber: true,
          deliveredAt: true,
          order: { select: { orderNumber: true } },
        },
      },
    },
  });
}

/**
 * Admin action: submit eligible payouts to the provider.
 *
 * Moves PENDING → PROCESSING only. It never sets PAID — that requires the
 * provider's confirmation via `markPayoutPaid`.
 */
export async function submitPayoutBatch(args: {
  sellerId?: string;
  payoutIds?: string[];
  actorId: string;
  limit?: number;
}): Promise<{ submitted: number; totalPaise: number; payoutIds: string[] }> {
  const now = new Date();

  const eligible = await prisma.payout.findMany({
    where: {
      status: 'PENDING',
      eligibleAt: { lte: now },
      ...(args.sellerId ? { sellerId: args.sellerId } : {}),
      ...(args.payoutIds?.length ? { id: { in: args.payoutIds } } : {}),
      // Never pay out a sub-order that is in dispute.
      sellerOrder: { status: 'DELIVERED', payoutStatus: 'PENDING' },
    },
    take: args.limit ?? 200,
    select: { id: true, netAmount: true, sellerId: true },
  });

  if (eligible.length === 0) return { submitted: 0, totalPaise: 0, payoutIds: [] };

  const ids = eligible.map((p) => p.id);

  await prisma.$transaction(async (tx) => {
    await tx.payout.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    await tx.sellerOrder.updateMany({
      where: { payout: { id: { in: ids } } },
      data: { payoutStatus: 'PROCESSING' },
    });
    await audit(tx, {
      actorId: args.actorId,
      actorRole: 'ADMIN',
      action: 'PAYOUT_BATCH_SUBMITTED',
      entityType: 'Payout',
      metadata: { count: ids.length, payoutIds: ids },
    });
  });

  return {
    submitted: eligible.length,
    totalPaise: eligible.reduce((a, p) => a + p.netAmount, 0),
    payoutIds: ids,
  };
}

/**
 * Confirm a payout as PAID.
 *
 * `providerReference` is REQUIRED — this function cannot be used to mark a
 * payout complete without evidence from the payment provider.
 */
export async function markPayoutPaid(args: {
  payoutId: string;
  providerReference: string;
  actorId: string;
  actorRole: 'ADMIN' | 'LOGISTICS';
}): Promise<void> {
  if (!args.providerReference?.trim()) {
    throw conflict('A payout cannot be marked paid without a provider reference.');
  }

  await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({
      where: { id: args.payoutId },
      include: { seller: { select: { userId: true } } },
    });
    if (!payout) throw notFound('Payout not found.');
    if (payout.status === 'PAID') return; // idempotent
    if (payout.status === 'ON_HOLD') {
      throw conflict('This payout is on hold and cannot be paid until the hold is cleared.');
    }

    await tx.payout.update({
      where: { id: payout.id },
      data: {
        status: 'PAID',
        providerReference: args.providerReference.trim(),
        processedAt: new Date(),
        failureReason: null,
      },
    });
    await tx.sellerOrder.update({
      where: { id: payout.sellerOrderId },
      data: { payoutStatus: 'PAID' },
    });
    await notify(tx, {
      userId: payout.seller.userId,
      type: 'PAYOUT',
      title: 'Payout sent',
      body: `Your payout of ₹${(payout.netAmount / 100).toLocaleString('en-IN')} has been released.`,
      linkUrl: '/seller/finance',
    });
    await audit(tx, {
      actorId: args.actorId,
      actorRole: args.actorRole,
      action: 'PAYOUT_PAID',
      entityType: 'Payout',
      entityId: payout.id,
      metadata: { providerReference: args.providerReference, netAmount: payout.netAmount },
    });
  });
}

export async function markPayoutFailed(args: {
  payoutId: string;
  reason: string;
  actorId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: args.payoutId } });
    if (!payout) throw notFound('Payout not found.');
    if (payout.status === 'PAID') throw conflict('That payout has already been paid.');

    await tx.payout.update({
      where: { id: payout.id },
      // Back to PENDING so the next batch retries it, with the reason kept.
      data: { status: 'PENDING', failureReason: args.reason.slice(0, 500) },
    });
    await tx.sellerOrder.update({
      where: { id: payout.sellerOrderId },
      data: { payoutStatus: 'FAILED' },
    });
    await audit(tx, {
      actorId: args.actorId,
      actorRole: 'ADMIN',
      action: 'PAYOUT_FAILED',
      entityType: 'Payout',
      entityId: payout.id,
      metadata: { reason: args.reason },
    });
  });
}

export async function holdPayout(args: {
  payoutId: string;
  reason: string;
  actorId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: args.payoutId } });
    if (!payout) throw notFound('Payout not found.');
    if (payout.status === 'PAID') throw conflict('That payout has already been paid.');

    await tx.payout.update({
      where: { id: payout.id },
      data: { status: 'ON_HOLD', failureReason: args.reason.slice(0, 500) },
    });
    await tx.sellerOrder.update({
      where: { id: payout.sellerOrderId },
      data: { payoutStatus: 'ON_HOLD' },
    });
    await audit(tx, {
      actorId: args.actorId,
      actorRole: 'ADMIN',
      action: 'PAYOUT_HELD',
      entityType: 'Payout',
      entityId: payout.id,
      metadata: { reason: args.reason },
    });
  });
}

/** Apply a refund's seller-side debit to that sub-order's pending payout. */
export async function applyRefundToPayout(
  tx: Tx,
  args: { sellerOrderId: string; sellerDebit: number },
): Promise<void> {
  const payout = await tx.payout.findUnique({ where: { sellerOrderId: args.sellerOrderId } });
  if (!payout) return;
  if (payout.status === 'PAID') {
    // Already paid out: the debit becomes a negative adjustment carried into
    // the seller's next settlement rather than a clawback of a sent transfer.
    await tx.payout.update({
      where: { id: payout.id },
      data: { refundAdjustment: { increment: args.sellerDebit } },
    });
    return;
  }
  const newNet = Math.max(0, payout.netAmount - args.sellerDebit);
  await tx.payout.update({
    where: { id: payout.id },
    data: {
      refundAdjustment: { increment: args.sellerDebit },
      netAmount: newNet,
      ...(newNet === 0 ? { status: 'ON_HOLD', failureReason: 'Fully refunded' } : {}),
    },
  });
}

/** Admin finance overview (§21). */
export async function getPlatformFinanceSummary() {
  const [gmvAgg, commissionAgg, refundAgg, payoutGroups, pendingKyc, pendingProducts] =
    await Promise.all([
      prisma.order.aggregate({
        where: { paymentStatus: 'CAPTURED' },
        _sum: { grandTotal: true },
        _count: true,
      }),
      prisma.commission.aggregate({
        where: { status: 'EARNED' },
        _sum: { commissionAmount: true, reversedAmount: true },
      }),
      prisma.refund.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.payout.groupBy({ by: ['status'], _sum: { netAmount: true }, _count: true }),
      prisma.sellerKyc.count({ where: { verificationStatus: { in: ['PENDING_REVIEW', 'UNDER_REVIEW'] } } }),
      prisma.product.count({ where: { approvalStatus: 'PENDING' } }),
    ]);

  const commissionEarned = commissionAgg._sum.commissionAmount ?? 0;
  const commissionReversed = commissionAgg._sum.reversedAmount ?? 0;

  return {
    gmv: gmvAgg._sum.grandTotal ?? 0,
    paidOrderCount: gmvAgg._count,
    platformRevenue: Math.max(0, commissionEarned - commissionReversed),
    commissionEarned,
    commissionReversed,
    refundsPaid: refundAgg._sum.amount ?? 0,
    payouts: payoutGroups.map((g) => ({
      status: g.status,
      amount: g._sum.netAmount ?? 0,
      count: g._count,
    })),
    pendingKycCount: pendingKyc,
    pendingProductCount: pendingProducts,
  };
}
