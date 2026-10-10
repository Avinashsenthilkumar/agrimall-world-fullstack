// lib/server/returns.ts — §18. Marketplace-aware returns and refunds.
//
// A return belongs to a SELLER ORDER, not to the customer order: you return
// the parcel that arrived damaged, not the whole multi-vendor basket.
//
// A completed refund correctly moves five things, in one transaction:
//   1. customer payment   → Refund row + provider refund
//   2. platform commission→ reversed pro-rata (Commission.reversedAmount)
//   3. seller earning     → debited pro-rata (Payout.refundAdjustment)
//   4. inventory          → restocked if the goods are resaleable
//   5. payout             → reduced, or held if fully refunded

import { prisma, serializableTransaction } from './prisma';
import { conflict, forbidden, notFound } from './http';
import { restock } from './inventory';
import { applyRefundToPayout } from './payouts';
import { notify } from './notifications';
import { audit } from './audit';
import { getReturnWindowDays } from './settings';
import { reverseCommission } from '../shared/commission';
import { deriveOrderStatus, type Role, type SellerOrderStatus } from '../shared/order-status';
import { allocate } from '../shared/money';

async function nextReturnNumber(): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const candidate = `RET-${Math.floor(10_000 + Math.random() * 90_000)}`;
    const exists = await prisma.returnRequest.findUnique({
      where: { returnNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `RET-${Date.now().toString(36).toUpperCase()}`;
}

export interface CreateReturnArgs {
  customerId: string;
  customerUserId: string;
  sellerOrderId: string;
  reason: string;
  description?: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  imageUrls?: string[];
}

/** Customer raises a return against one seller's parcel. */
export async function createReturnRequest(args: CreateReturnArgs) {
  const windowDays = await getReturnWindowDays();
  const returnNumber = await nextReturnNumber();

  return serializableTransaction(async (tx) => {
    const so = await tx.sellerOrder.findFirst({
      where: { id: args.sellerOrderId, order: { customerId: args.customerId } },
      include: {
        items: true,
        order: { select: { id: true, orderNumber: true, paymentStatus: true } },
        seller: { select: { userId: true, businessName: true } },
        returns: { where: { status: { notIn: ['REJECTED', 'CANCELLED'] } }, include: { items: true } },
      },
    });
    // 404 rather than 403: don't confirm the existence of another customer's order.
    if (!so) throw notFound('Order not found.');

    if (so.status !== 'DELIVERED') {
      throw conflict('You can request a return once the parcel has been delivered.');
    }
    if (so.order.paymentStatus !== 'CAPTURED') {
      throw conflict('This order has no captured payment to refund.');
    }

    // Return window.
    if (so.deliveredAt) {
      const deadline = so.deliveredAt.getTime() + windowDays * 86_400_000;
      if (Date.now() > deadline) {
        throw conflict(`The ${windowDays}-day return window for this parcel has closed.`);
      }
    }

    // Validate the requested items belong to THIS sub-order, and that the
    // quantities don't exceed what was bought minus what's already returned.
    const itemById = new Map(so.items.map((i) => [i.id, i]));
    const alreadyReturned = new Map<string, number>();
    for (const r of so.returns) {
      for (const ri of r.items) {
        alreadyReturned.set(ri.orderItemId, (alreadyReturned.get(ri.orderItemId) ?? 0) + ri.quantity);
      }
    }

    let refundable = 0;
    const validated: Array<{ orderItemId: string; quantity: number; refundAmount: number }> = [];

    for (const req of args.items) {
      const item = itemById.get(req.orderItemId);
      if (!item) throw conflict('One of the items is not part of this parcel.');

      const outstanding = item.quantity - (alreadyReturned.get(item.id) ?? 0);
      if (outstanding <= 0) throw conflict(`${item.productNameSnapshot} has already been returned.`);
      if (req.quantity > outstanding) {
        throw conflict(
          `You can return at most ${outstanding} × ${item.productNameSnapshot}.`,
        );
      }

      // Pro-rata refund for a partial-quantity return, using exact integer
      // allocation so N partial returns can never exceed the item's total.
      const perUnit = allocate(item.total, new Array(item.quantity).fill(1));
      const amount = perUnit.slice(0, req.quantity).reduce((a, b) => a + b, 0);

      refundable += amount;
      validated.push({ orderItemId: item.id, quantity: req.quantity, refundAmount: amount });
    }

    const returnRequest = await tx.returnRequest.create({
      data: {
        returnNumber,
        sellerOrderId: so.id,
        customerId: args.customerId,
        reason: args.reason,
        description: args.description ?? null,
        status: 'REQUESTED',
        imageUrls: (args.imageUrls ?? []) as unknown as object,
        refundAmount: refundable,
        items: { create: validated },
      },
      include: { items: true },
    });

    // Reflect the dispute on the sub-order and freeze its payout.
    await tx.sellerOrder.update({
      where: { id: so.id },
      data: { status: 'RETURN_REQUESTED', payoutStatus: 'ON_HOLD' },
    });
    await tx.sellerOrderStatusLog.create({
      data: {
        sellerOrderId: so.id,
        fromStatus: 'DELIVERED',
        toStatus: 'RETURN_REQUESTED',
        actorId: args.customerUserId,
        actorRole: 'CUSTOMER',
        note: `Return ${returnNumber}: ${args.reason}`,
      },
    });
    await tx.payout.updateMany({
      where: { sellerOrderId: so.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'ON_HOLD', failureReason: `Return ${returnNumber} pending` },
    });

    const siblings = await tx.sellerOrder.findMany({
      where: { orderId: so.order.id },
      select: { status: true },
    });
    await tx.order.update({
      where: { id: so.order.id },
      data: {
        orderStatus: deriveOrderStatus(
          siblings.map((s) => ({ status: s.status as SellerOrderStatus })),
          { captured: true },
        ),
      },
    });

    await notify(tx, {
      userId: so.seller.userId,
      type: 'RETURN_REQUEST',
      title: `Return requested: ${returnNumber}`,
      body: `A customer has requested a return on ${so.sellerOrderNumber}.`,
      linkUrl: `/seller/returns/${returnRequest.id}`,
    });

    return returnRequest;
  });
}

/** Seller or admin approves / rejects the request. */
export async function decideReturn(args: {
  returnId: string;
  decision: 'APPROVE' | 'REJECT';
  rejectionReason?: string;
  restock: boolean;
  actor: { userId: string; role: Role };
}) {
  return serializableTransaction(async (tx) => {
    const req = await tx.returnRequest.findUnique({
      where: { id: args.returnId },
      include: {
        sellerOrder: { include: { order: { select: { id: true } }, seller: { select: { userId: true } } } },
        customer: { select: { userId: true } },
      },
    });
    if (!req) throw notFound('Return request not found.');
    if (req.status !== 'REQUESTED' && req.status !== 'APPROVED') {
      throw conflict(`This return is already ${req.status.toLowerCase().replace(/_/g, ' ')}.`);
    }
    if (args.actor.role === 'SELLER' && req.sellerOrder.seller.userId !== args.actor.userId) {
      throw forbidden('This return belongs to another seller.');
    }

    if (args.decision === 'REJECT') {
      await tx.returnRequest.update({
        where: { id: req.id },
        data: {
          status: 'REJECTED',
          rejectionReason: args.rejectionReason ?? 'Not eligible for return',
          reviewedById: args.actor.userId,
          reviewedAt: new Date(),
        },
      });
      // Put the parcel back to DELIVERED and release the payout hold.
      await tx.sellerOrder.update({
        where: { id: req.sellerOrderId },
        data: { status: 'DELIVERED', payoutStatus: 'PENDING' },
      });
      await tx.payout.updateMany({
        where: { sellerOrderId: req.sellerOrderId, status: 'ON_HOLD' },
        data: { status: 'PENDING', failureReason: null },
      });
      await notify(tx, {
        userId: req.customer.userId,
        type: 'RETURN_REQUEST',
        title: `Return ${req.returnNumber} was not approved`,
        body: args.rejectionReason ?? undefined,
        linkUrl: `/account/returns/${req.id}`,
      });
    } else {
      await tx.returnRequest.update({
        where: { id: req.id },
        data: {
          status: 'APPROVED',
          restock: args.restock,
          reviewedById: args.actor.userId,
          reviewedAt: new Date(),
        },
      });
      await notify(tx, {
        userId: req.customer.userId,
        type: 'RETURN_REQUEST',
        title: `Return ${req.returnNumber} approved`,
        body: 'We will arrange a pickup for the item.',
        linkUrl: `/account/returns/${req.id}`,
      });
    }

    await audit(tx, {
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: `RETURN_${args.decision}`,
      entityType: 'ReturnRequest',
      entityId: req.id,
      metadata: { reason: args.rejectionReason ?? null },
    });

    return { returnId: req.id, decision: args.decision };
  });
}

/** Move an approved return through pickup → received → inspected. */
export async function progressReturn(args: {
  returnId: string;
  status: 'PICKUP_SCHEDULED' | 'PICKED_UP' | 'RECEIVED' | 'INSPECTED';
  pickupScheduledAt?: Date;
  inspectionNote?: string;
  approvedRefundPaise?: number;
  actor: { userId: string; role: Role };
}) {
  const order: Record<string, number> = {
    APPROVED: 0,
    PICKUP_SCHEDULED: 1,
    PICKED_UP: 2,
    RECEIVED: 3,
    INSPECTED: 4,
  };

  return serializableTransaction(async (tx) => {
    const req = await tx.returnRequest.findUnique({
      where: { id: args.returnId },
      include: { items: true, sellerOrder: { select: { id: true, sellerId: true } } },
    });
    if (!req) throw notFound('Return request not found.');

    const current = order[req.status];
    const target = order[args.status];
    if (current === undefined) throw conflict(`A ${req.status.toLowerCase()} return cannot be progressed.`);
    if (target !== current + 1) {
      throw conflict(`A return must go through the pickup steps in order (currently ${req.status}).`);
    }

    const data: Record<string, unknown> = { status: args.status };
    if (args.status === 'PICKUP_SCHEDULED') data.pickupScheduledAt = args.pickupScheduledAt ?? new Date();
    if (args.status === 'RECEIVED') data.receivedAt = new Date();
    if (args.status === 'INSPECTED') {
      data.inspectionNote = args.inspectionNote ?? null;
      if (args.approvedRefundPaise != null) {
        if (args.approvedRefundPaise > req.refundAmount) {
          throw conflict('The approved refund cannot exceed the requested amount.');
        }
        data.refundAmount = args.approvedRefundPaise;
      }
    }

    await tx.returnRequest.update({ where: { id: req.id }, data });

    // Goods are physically back and checked: restock if resaleable.
    if (args.status === 'RECEIVED' && req.restock) {
      const items = await tx.orderItem.findMany({
        where: { id: { in: req.items.map((i) => i.orderItemId) } },
        select: { id: true, productId: true, variantId: true },
      });
      const qtyByItem = new Map(req.items.map((i) => [i.orderItemId, i.quantity]));
      await restock(
        tx,
        items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: qtyByItem.get(i.id) ?? 0,
        })),
        {
          reason: 'RETURN_RESTOCK',
          refType: 'RETURN',
          refId: req.id,
          actorId: args.actor.userId,
        },
      );
      await tx.sellerOrder.update({
        where: { id: req.sellerOrderId },
        data: { status: 'RETURNED' },
      });
    }

    await audit(tx, {
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: `RETURN_${args.status}`,
      entityType: 'ReturnRequest',
      entityId: req.id,
      metadata: { note: args.inspectionNote ?? null },
    });

    return { returnId: req.id, status: args.status };
  });
}

/**
 * Issue the refund. This is the function that touches all five ledgers (§18).
 *
 * `processWithProvider` is a callback so the DB transaction does not stay open
 * across an HTTP call to Razorpay/Stripe. We record the refund as PROCESSING,
 * call the provider, then settle — a crash in between leaves a PROCESSING row
 * for the admin to reconcile rather than silent money loss.
 */
export async function issueRefund(args: {
  sellerOrderId: string;
  amountPaise?: number;
  reason: string;
  returnId?: string;
  actor: { userId: string; role: Role };
  processWithProvider?: (input: {
    providerPaymentId: string;
    amountPaise: number;
  }) => Promise<{ providerRefundId: string }>;
}) {
  // --- Phase 1: validate and record intent, inside a transaction ----------
  const prepared = await serializableTransaction(async (tx) => {
    const so = await tx.sellerOrder.findUnique({
      where: { id: args.sellerOrderId },
      include: {
        items: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            paymentStatus: true,
            payments: {
              where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } },
              select: { id: true, providerPaymentId: true, amount: true, refundedAmount: true },
            },
          },
        },
        refunds: { select: { amount: true, status: true } },
        commission: true,
      },
    });
    if (!so) throw notFound('Order not found.');
    if (so.order.paymentStatus !== 'CAPTURED' && so.order.paymentStatus !== 'PARTIALLY_REFUNDED') {
      throw conflict('There is no captured payment on this order to refund.');
    }

    const alreadyRefunded = so.refunds
      .filter((r) => r.status !== 'FAILED')
      .reduce((a, r) => a + r.amount, 0);
    const maxRefundable = so.grossAmount - alreadyRefunded;
    if (maxRefundable <= 0) throw conflict('This parcel has already been fully refunded.');

    const amount = args.amountPaise ?? maxRefundable;
    if (amount <= 0) throw conflict('The refund amount must be greater than zero.');
    if (amount > maxRefundable) {
      throw conflict(
        `At most ₹${(maxRefundable / 100).toLocaleString('en-IN')} can still be refunded on this parcel.`,
      );
    }

    // Split the refund between platform and seller in their original ratio.
    const rev = reverseCommission({
      refundAmount: amount,
      originalGross: so.grossAmount,
      originalCommission: so.commissionAmount,
    });

    const payment = so.order.payments[0] ?? null;

    const refund = await tx.refund.create({
      data: {
        orderId: so.order.id,
        sellerOrderId: so.id,
        paymentId: payment?.id ?? null,
        returnId: args.returnId ?? null,
        amount,
        commissionReversed: rev.commissionReversed,
        sellerDebit: rev.sellerDebit,
        reason: args.reason,
        status: 'PROCESSING',
      },
    });

    return {
      refundId: refund.id,
      amount,
      rev,
      orderId: so.order.id,
      sellerOrderId: so.id,
      providerPaymentId: payment?.providerPaymentId ?? null,
      paymentId: payment?.id ?? null,
      fullyRefunded: alreadyRefunded + amount >= so.grossAmount,
      returnId: args.returnId ?? null,
      customerId: so.order.customerId,
    };
  });

  // --- Phase 2: talk to the provider, outside the transaction -------------
  let providerRefundId: string | null = null;
  if (args.processWithProvider && prepared.providerPaymentId) {
    try {
      const res = await args.processWithProvider({
        providerPaymentId: prepared.providerPaymentId,
        amountPaise: prepared.amount,
      });
      providerRefundId = res.providerRefundId;
    } catch (err) {
      await prisma.refund.update({
        where: { id: prepared.refundId },
        data: {
          status: 'FAILED',
          reason: `${args.reason} — provider error: ${String((err as Error).message).slice(0, 200)}`,
        },
      });
      throw err;
    }
  }

  // --- Phase 3: settle the ledgers ----------------------------------------
  return serializableTransaction(async (tx) => {
    await tx.refund.update({
      where: { id: prepared.refundId },
      data: {
        status: 'COMPLETED',
        providerRefundId,
        processedAt: new Date(),
      },
    });

    // 1. Payment record
    if (prepared.paymentId) {
      const payment = await tx.payment.findUnique({ where: { id: prepared.paymentId } });
      if (payment) {
        const refundedAmount = payment.refundedAmount + prepared.amount;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundedAmount,
            status: refundedAmount >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          },
        });
      }
    }

    // 2. Commission reversal
    await tx.commission.updateMany({
      where: { sellerOrderId: prepared.sellerOrderId },
      data: {
        reversedAmount: { increment: prepared.rev.commissionReversed },
        ...(prepared.fullyRefunded ? { status: 'REVERSED' } : {}),
      },
    });

    // 3 & 5. Seller debit against the payout
    await applyRefundToPayout(tx, {
      sellerOrderId: prepared.sellerOrderId,
      sellerDebit: prepared.rev.sellerDebit,
    });

    // Sub-order final state
    if (prepared.fullyRefunded) {
      await tx.sellerOrder.update({
        where: { id: prepared.sellerOrderId },
        data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
      });
    } else {
      await tx.sellerOrder.update({
        where: { id: prepared.sellerOrderId },
        data: { paymentStatus: 'PARTIALLY_REFUNDED' },
      });
    }

    if (prepared.returnId) {
      await tx.returnRequest.update({
        where: { id: prepared.returnId },
        data: { status: 'COMPLETED' },
      });
    }

    // Parent order status + payment status
    const siblings = await tx.sellerOrder.findMany({
      where: { orderId: prepared.orderId },
      select: { status: true },
    });
    const allRefunded = siblings.every((s) => s.status === 'REFUNDED');
    await tx.order.update({
      where: { id: prepared.orderId },
      data: {
        orderStatus: deriveOrderStatus(
          siblings.map((s) => ({ status: s.status as SellerOrderStatus })),
          { captured: true },
        ),
        paymentStatus: allRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      },
    });

    const customer = await tx.customer.findUnique({
      where: { id: prepared.customerId },
      select: { userId: true },
    });
    if (customer) {
      await notify(tx, {
        userId: customer.userId,
        type: 'REFUND',
        title: `Refund of ₹${(prepared.amount / 100).toLocaleString('en-IN')} issued`,
        body: providerRefundId
          ? 'It should reach your original payment method in 5-7 working days.'
          : 'Our team will complete the transfer shortly.',
        linkUrl: `/account/orders/${prepared.orderId}`,
      });
    }

    await audit(tx, {
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: 'REFUND_ISSUED',
      entityType: 'Refund',
      entityId: prepared.refundId,
      metadata: {
        amount: prepared.amount,
        commissionReversed: prepared.rev.commissionReversed,
        sellerDebit: prepared.rev.sellerDebit,
        providerRefundId,
      },
    });

    return {
      refundId: prepared.refundId,
      amount: prepared.amount,
      commissionReversed: prepared.rev.commissionReversed,
      sellerDebit: prepared.rev.sellerDebit,
      providerRefundId,
    };
  });
}

export async function listReturns(scope: {
  customerId?: string;
  sellerId?: string;
  status?: string;
  take?: number;
}) {
  return prisma.returnRequest.findMany({
    where: {
      ...(scope.customerId ? { customerId: scope.customerId } : {}),
      ...(scope.sellerId ? { sellerOrder: { sellerId: scope.sellerId } } : {}),
      ...(scope.status ? { status: scope.status as never } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: scope.take ?? 50,
    include: {
      items: { include: { orderItem: { select: { productNameSnapshot: true, imageSnapshot: true } } } },
      sellerOrder: {
        select: {
          sellerOrderNumber: true,
          seller: { select: { businessName: true } },
          order: { select: { orderNumber: true } },
        },
      },
      refund: { select: { id: true, amount: true, status: true } },
    },
  });
}
