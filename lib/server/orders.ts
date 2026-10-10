// lib/server/orders.ts — §8, §9, §15, §32.
//
// THE FAN-OUT. This module contains the single function that makes AgriMall a
// marketplace rather than a shop:
//
//     createOrderFromQuote()
//
//   ONE Order (what the customer pays)
//     ├── SellerOrder A  → items, commission, shipment, payout
//     ├── SellerOrder B  → items, commission, shipment, payout
//     └── SellerOrder C  → …
//
// Everything in here runs inside a single SERIALIZABLE transaction: the order,
// its sub-orders, their items, the stock reservations and the commission rows
// are either all written or none are (§32).

import { prisma, serializableTransaction, type Tx } from './prisma';
import { conflict, forbidden, notFound } from './http';
import { reserveStock, restock, commitReservations } from './inventory';
import { resolveCart, type CartLineRequest } from './pricing';
import { getReturnWindowDays } from './settings';
import { notify } from './notifications';
import { audit } from './audit';
import { sellerOrderSuffix, type Quote } from '../shared/pricing';
import {
  canTransitionSellerOrder,
  deriveOrderStatus,
  STATUS_TO_SHIPMENT_STATUS,
  STATUS_TO_TRACKING_EVENT,
  type Role,
  type SellerOrderStatus,
} from '../shared/order-status';
import { reverseCommission } from '../shared/commission';
import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Order numbers
// ---------------------------------------------------------------------------
// Human-friendly, non-sequential-looking, collision-checked: AGM-4821.
// A monotonic counter would leak order volume to competitors.

async function nextOrderNumber(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = `AGM-${Math.floor(1000 + Math.random() * 9000)}${
      attempt > 20 ? `-${Date.now().toString(36).slice(-3).toUpperCase()}` : ''
    }`;
    const existing = await tx.order.findUnique({
      where: { orderNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `AGM-${Date.now().toString(36).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Address snapshots
// ---------------------------------------------------------------------------

export interface AddressSnapshot {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export function toAddressSnapshot(a: {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}): AddressSnapshot {
  return {
    fullName: a.fullName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 ?? null,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    country: a.country,
  };
}

// ---------------------------------------------------------------------------
// THE FAN-OUT
// ---------------------------------------------------------------------------

export interface CreateOrderArgs {
  customerId: string;
  lines: CartLineRequest[];
  shippingAddress: AddressSnapshot;
  billingAddress?: AddressSnapshot;
  couponCode?: string | null;
  customerNote?: string | null;
  /** COD skips the payment gateway but still goes through the same flow. */
  paymentProvider: 'RAZORPAY' | 'STRIPE' | 'COD';
}

export interface CreateOrderResult {
  orderId: string;
  orderNumber: string;
  grandTotal: number;
  paymentId: string;
  sellerOrders: Array<{
    id: string;
    sellerOrderNumber: string;
    sellerId: string;
    grossAmount: number;
    commissionAmount: number;
    sellerEarning: number;
  }>;
  quote: Quote;
}

export async function createOrderFromQuote(args: CreateOrderArgs): Promise<CreateOrderResult> {
  return serializableTransaction(async (tx) => {
    // Re-resolve prices INSIDE the transaction. A quote shown to the customer
    // a minute ago is not authoritative; this is the version that is charged.
    const { quote, sellerByProduct, coupon } = await resolveCart(args.lines, {
      enforceStock: true,
      couponCode: args.couponCode,
      customerId: args.customerId,
      client: tx,
    });

    if (quote.grandTotal <= 0 && args.paymentProvider !== 'COD') {
      throw conflict('Order total must be greater than zero.');
    }

    const orderNumber = await nextOrderNumber(tx);
    const reservationExpiresAt = new Date(Date.now() + 30 * 60_000);

    // ---- 1. The customer-facing order (the payment envelope) -------------
    const order = await tx.order.create({
      data: {
        orderNumber,
        customerId: args.customerId,
        subtotal: quote.subtotal,
        discount: quote.discount,
        tax: quote.tax,
        shippingFee: quote.shippingFee,
        grandTotal: quote.grandTotal,
        paymentStatus: 'PENDING',
        orderStatus: 'PENDING_PAYMENT',
        shippingAddress: args.shippingAddress as unknown as Prisma.InputJsonValue,
        billingAddress: (args.billingAddress ?? args.shippingAddress) as unknown as Prisma.InputJsonValue,
        couponCode: quote.couponCode,
        customerNote: args.customerNote ?? null,
        reservationExpiresAt,
      },
    });

    // ---- 2. One SellerOrder per seller — the actual fan-out --------------
    const sellerOrders: CreateOrderResult['sellerOrders'] = [];

    for (let i = 0; i < quote.perSeller.length; i++) {
      const group = quote.perSeller[i];
      const sellerOrderNumber = `${orderNumber}-${sellerOrderSuffix(i)}`;

      const sellerOrder = await tx.sellerOrder.create({
        data: {
          orderId: order.id,
          sellerId: group.sellerId,
          sellerOrderNumber,
          subtotal: group.subtotal,
          discount: group.discount,
          tax: group.tax,
          shippingFee: group.shippingFee,
          grossAmount: group.grossAmount,
          commissionRate: group.commissionRate,
          commissionAmount: group.commissionAmount,
          sellerEarning: group.sellerEarning,
          status: 'PENDING',
          paymentStatus: 'PENDING',
          payoutStatus: 'PENDING',
        },
      });

      // ---- 3. Items, with immutable snapshots (§8) ----------------------
      for (const line of group.lines) {
        await tx.orderItem.create({
          data: {
            sellerOrderId: sellerOrder.id,
            productId: line.productId,
            variantId: line.variantId ?? null,
            sellerId: group.sellerId,
            productNameSnapshot: line.snapshot.productName,
            skuSnapshot: line.snapshot.sku,
            imageSnapshot: line.snapshot.imageUrl ?? null,
            variantSnapshot: line.snapshot.variantLabel ?? null,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.lineDiscount,
            tax: line.lineTax,
            total: line.lineTotal,
          },
        });
      }

      // ---- 4. Commission ledger row (§12) -------------------------------
      await tx.commission.create({
        data: {
          sellerId: group.sellerId,
          orderId: order.id,
          sellerOrderId: sellerOrder.id,
          rate: group.commissionRate,
          grossAmount: group.grossAmount,
          commissionAmount: group.commissionAmount,
          sellerAmount: group.sellerEarning,
          // PENDING until the money is actually captured.
          status: 'PENDING',
        },
      });

      // ---- 5. A shipment shell per seller order (§16) --------------------
      await tx.shipment.create({
        data: { sellerOrderId: sellerOrder.id, status: 'PENDING' },
      });

      sellerOrders.push({
        id: sellerOrder.id,
        sellerOrderNumber,
        sellerId: group.sellerId,
        grossAmount: group.grossAmount,
        commissionAmount: group.commissionAmount,
        sellerEarning: group.sellerEarning,
      });
    }

    // ---- 6. Hold the stock (§11) ------------------------------------------
    const stockLines = quote.perSeller.flatMap((g) =>
      g.lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
        productName: l.snapshot.productName,
      })),
    );
    await reserveStock(tx, order.id, stockLines, sellerByProduct);

    // ---- 7. Payment intent row — amount from the SERVER quote only ------
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: args.paymentProvider,
        amount: quote.grandTotal,
        currency: 'INR',
        status: 'PENDING',
      },
    });

    // ---- 8. Record coupon usage -------------------------------------------
    if (coupon && quote.discount > 0) {
      await tx.couponUsage.create({
        data: {
          couponId: coupon.id,
          customerId: args.customerId,
          orderId: order.id,
          discount: quote.discount,
        },
      });
      await tx.coupon.update({
        where: { id: coupon.id },
        data: { usageCount: { increment: 1 } },
      });
    }

    return {
      orderId: order.id,
      orderNumber,
      grandTotal: quote.grandTotal,
      paymentId: payment.id,
      sellerOrders,
      quote,
    };
  });
}

// ---------------------------------------------------------------------------
// Payment confirmation (called ONLY from a verified webhook — §14)
// ---------------------------------------------------------------------------

/**
 * Mark an order paid and release it to the sellers.
 *
 * IDEMPOTENT. A webhook that arrives twice performs the work once: the guard
 * is the order's own paymentStatus, re-read inside the transaction.
 */
export async function confirmOrderPaid(args: {
  orderId: string;
  providerPaymentId: string;
  providerOrderId?: string | null;
  providerSignature?: string | null;
  method?: string | null;
  amountPaise: number;
  rawPayload?: unknown;
}): Promise<{ alreadyProcessed: boolean; orderNumber: string }> {
  return serializableTransaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: args.orderId },
      include: { payments: true, sellerOrders: { select: { id: true, status: true } } },
    });
    if (!order) throw notFound('Order not found.');

    // --- Idempotency guard ------------------------------------------------
    if (order.paymentStatus === 'CAPTURED') {
      return { alreadyProcessed: true, orderNumber: order.orderNumber };
    }

    // --- Amount verification: never trust the callback's figure -----------
    // We compare against the amount WE computed and stored at checkout.
    if (args.amountPaise !== order.grandTotal) {
      await tx.payment.updateMany({
        where: { orderId: order.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          failureReason: `Amount mismatch: provider reported ${args.amountPaise}, order total is ${order.grandTotal}`,
        },
      });
      throw conflict('Payment amount did not match the order total.');
    }

    const payment =
      order.payments.find((p) => p.status === 'PENDING') ?? order.payments[0] ?? null;
    if (!payment) throw notFound('No payment record for this order.');

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CAPTURED',
        providerPaymentId: args.providerPaymentId,
        providerOrderId: args.providerOrderId ?? payment.providerOrderId,
        providerSignature: args.providerSignature ?? null,
        method: args.method ?? null,
        capturedAt: new Date(),
        rawPayload: (args.rawPayload ?? null) as Prisma.InputJsonValue,
      },
    });

    // --- Turn holds into real stock depletion -----------------------------
    await commitReservations(tx, order.id);

    // --- Release the sub-orders to their sellers --------------------------
    await tx.sellerOrder.updateMany({
      where: { orderId: order.id },
      data: { paymentStatus: 'CAPTURED' },
    });
    await tx.commission.updateMany({
      where: { orderId: order.id, status: 'PENDING' },
      data: { status: 'EARNED' },
    });

    const derived = deriveOrderStatus(
      order.sellerOrders.map((s) => ({ status: s.status as SellerOrderStatus })),
      { captured: true },
    );

    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'CAPTURED',
        orderStatus: derived,
        confirmedAt: new Date(),
        reservationExpiresAt: null,
      },
    });

    // --- Tell each seller they have an order to fulfil --------------------
    const sellerOrders = await tx.sellerOrder.findMany({
      where: { orderId: order.id },
      include: { seller: { select: { userId: true, businessName: true } } },
    });
    for (const so of sellerOrders) {
      await notify(tx, {
        userId: so.seller.userId,
        type: 'NEW_ORDER',
        title: `New order ${so.sellerOrderNumber}`,
        body: `You have a new paid order to accept and fulfil.`,
        linkUrl: `/seller/orders/${so.id}`,
      });
      // First tracking event: the parcel's journey officially begins.
      const shipment = await tx.shipment.findFirst({ where: { sellerOrderId: so.id } });
      if (shipment) {
        await tx.trackingEvent.create({
          data: {
            shipmentId: shipment.id,
            status: 'ORDER_CONFIRMED',
            location: 'Agri Mall Platform',
            message: 'Payment confirmed. Awaiting seller acceptance.',
          },
        });
      }
    }

    return { alreadyProcessed: false, orderNumber: order.orderNumber };
  });
}

/** Payment definitively failed: release the stock, fail the order. */
export async function failOrderPayment(args: {
  orderId: string;
  reason: string;
  providerPaymentId?: string | null;
}): Promise<void> {
  await serializableTransaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: args.orderId },
      select: { id: true, paymentStatus: true },
    });
    if (!order) return;
    // A captured payment is never downgraded by a late failure event.
    if (order.paymentStatus === 'CAPTURED') return;

    const { releaseReservations } = await import('./inventory');
    await releaseReservations(tx, order.id);

    await tx.payment.updateMany({
      where: { orderId: order.id, status: { in: ['PENDING', 'AUTHORIZED'] } },
      data: {
        status: 'FAILED',
        failureReason: args.reason.slice(0, 500),
        providerPaymentId: args.providerPaymentId ?? undefined,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'FAILED', orderStatus: 'PAYMENT_FAILED', cancelReason: args.reason.slice(0, 500) },
    });
    await tx.sellerOrder.updateMany({
      where: { orderId: order.id, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Payment failed.' },
    });
  });
}

// ---------------------------------------------------------------------------
// Status transitions (§15)
// ---------------------------------------------------------------------------

export interface TransitionArgs {
  sellerOrderId: string;
  to: SellerOrderStatus;
  actor: { userId: string; role: Role };
  note?: string;
  /** Courier details, accepted when moving to SHIPPED. */
  shipment?: { courier?: string; trackingNumber?: string; estimatedDelivery?: Date };
  location?: string;
}

/**
 * Move one seller order along its lifecycle.
 *
 * Does, atomically:
 *   - validates the transition against the state machine AND the actor's role
 *   - updates the seller order + timestamps
 *   - appends an immutable status-log row
 *   - updates that seller's shipment and writes a real tracking event
 *   - recomputes the PARENT order's derived status
 *   - restocks and reverses commission on cancellation
 *   - creates the payout record on delivery
 */
export async function transitionSellerOrder(args: TransitionArgs) {
  const returnWindowDays = await getReturnWindowDays();

  return serializableTransaction(async (tx) => {
    const so = await tx.sellerOrder.findUnique({
      where: { id: args.sellerOrderId },
      include: {
        order: { select: { id: true, orderNumber: true, customerId: true, paymentStatus: true } },
        items: true,
        seller: { select: { userId: true, businessName: true } },
      },
    });
    if (!so) throw notFound('Order not found.');

    const from = so.status as SellerOrderStatus;

    // --- The gate -------------------------------------------------------
    const check = canTransitionSellerOrder(from, args.to, args.actor.role);
    if (!check.allowed) throw conflict(check.reason ?? 'That status change is not allowed.');

    // A seller cannot start work on an order that hasn't been paid for.
    if (so.order.paymentStatus !== 'CAPTURED' && args.to !== 'CANCELLED') {
      throw conflict('This order has not been paid for yet.');
    }

    const now = new Date();
    const timestampField: Partial<Record<SellerOrderStatus, string>> = {
      ACCEPTED: 'acceptedAt',
      PACKING: 'packedAt',
      SHIPPED: 'shippedAt',
      DELIVERED: 'deliveredAt',
      CANCELLED: 'cancelledAt',
    };

    const data: Record<string, unknown> = { status: args.to };
    const tsField = timestampField[args.to];
    if (tsField) data[tsField] = now;
    if (args.to === 'CANCELLED') data.cancelReason = args.note ?? 'Cancelled';

    await tx.sellerOrder.update({ where: { id: so.id }, data });

    // --- Immutable audit trail of the lifecycle -------------------------
    await tx.sellerOrderStatusLog.create({
      data: {
        sellerOrderId: so.id,
        fromStatus: from,
        toStatus: args.to,
        actorId: args.actor.userId,
        actorRole: args.actor.role,
        note: args.note ?? null,
      },
    });

    // --- Shipment + tracking event (§16, §17) ---------------------------
    let shipment = await tx.shipment.findFirst({ where: { sellerOrderId: so.id } });
    if (!shipment) {
      shipment = await tx.shipment.create({ data: { sellerOrderId: so.id, status: 'PENDING' } });
    }

    const shipmentStatus = STATUS_TO_SHIPMENT_STATUS[args.to];
    const shipmentData: Record<string, unknown> = {};
    if (shipmentStatus) shipmentData.status = shipmentStatus;
    if (args.to === 'SHIPPED') {
      if (args.shipment?.courier) shipmentData.courier = args.shipment.courier;
      if (args.shipment?.trackingNumber) shipmentData.trackingNumber = args.shipment.trackingNumber;
      shipmentData.pickupDate = now;
      shipmentData.estimatedDelivery =
        args.shipment?.estimatedDelivery ?? new Date(now.getTime() + 4 * 86_400_000);
    }
    if (args.to === 'DELIVERED') {
      shipmentData.deliveredAt = now;
      shipmentData.actualDelivery = now;
    }
    if (Object.keys(shipmentData).length > 0) {
      await tx.shipment.update({ where: { id: shipment.id }, data: shipmentData });
    }

    const eventType = STATUS_TO_TRACKING_EVENT[args.to];
    if (eventType) {
      await tx.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: eventType,
          location: args.location ?? defaultLocation(args.to, so.seller.businessName),
          message: args.note ?? null,
        },
      });
    }

    // --- Cancellation: stock back, commission reversed -------------------
    if (args.to === 'CANCELLED') {
      await restock(
        tx,
        so.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
        })),
        { reason: 'CANCEL_RESTOCK', refType: 'SELLER_ORDER', refId: so.id, actorId: args.actor.userId },
      );

      if (so.order.paymentStatus === 'CAPTURED') {
        const rev = reverseCommission({
          refundAmount: so.grossAmount,
          originalGross: so.grossAmount,
          originalCommission: so.commissionAmount,
        });
        await tx.commission.updateMany({
          where: { sellerOrderId: so.id },
          data: { status: 'REVERSED', reversedAmount: rev.commissionReversed },
        });
        await tx.refund.create({
          data: {
            orderId: so.order.id,
            sellerOrderId: so.id,
            amount: so.grossAmount,
            commissionReversed: rev.commissionReversed,
            sellerDebit: rev.sellerDebit,
            reason: args.note ?? 'Seller order cancelled',
            status: 'PENDING',
          },
        });
        await tx.sellerOrder.update({
          where: { id: so.id },
          data: { payoutStatus: 'ON_HOLD' },
        });
      }
    }

    // --- Delivery: create the payout, held until the return window ends ---
    if (args.to === 'DELIVERED') {
      const eligibleAt = new Date(now.getTime() + returnWindowDays * 86_400_000);
      await tx.payout.upsert({
        where: { sellerOrderId: so.id },
        create: {
          sellerId: so.sellerId,
          sellerOrderId: so.id,
          grossAmount: so.grossAmount,
          commissionAmount: so.commissionAmount,
          netAmount: so.sellerEarning,
          status: 'PENDING',
          eligibleAt,
        },
        update: { eligibleAt },
      });
    }

    // --- Recompute the parent order's status -----------------------------
    const siblings = await tx.sellerOrder.findMany({
      where: { orderId: so.order.id },
      select: { status: true },
    });
    const derived = deriveOrderStatus(
      siblings.map((s) => ({ status: s.status as SellerOrderStatus })),
      { captured: so.order.paymentStatus === 'CAPTURED' },
    );
    await tx.order.update({
      where: { id: so.order.id },
      data: { orderStatus: derived },
    });

    // --- Keep the customer informed --------------------------------------
    const customer = await tx.customer.findUnique({
      where: { id: so.order.customerId },
      select: { userId: true },
    });
    if (customer) {
      await notify(tx, {
        userId: customer.userId,
        type: 'ORDER_STATUS',
        title: `${so.sellerOrderNumber}: ${humanStatus(args.to)}`,
        body: `Your parcel from ${so.seller.businessName} is now ${humanStatus(args.to).toLowerCase()}.`,
        linkUrl: `/account/orders/${so.order.id}`,
      });
    }

    await audit(tx, {
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: 'SELLER_ORDER_TRANSITION',
      entityType: 'SellerOrder',
      entityId: so.id,
      metadata: { from, to: args.to, note: args.note ?? null },
    });

    return { sellerOrderId: so.id, from, to: args.to, orderStatus: derived };
  });
}

function defaultLocation(status: SellerOrderStatus, sellerName: string): string {
  switch (status) {
    case 'ACCEPTED':
      return sellerName;
    case 'PACKING':
      return `${sellerName} — packing bay`;
    case 'READY_FOR_PICKUP':
      return `${sellerName} — awaiting courier`;
    case 'SHIPPED':
      return 'Origin hub';
    case 'IN_TRANSIT':
      return 'In transit';
    case 'OUT_FOR_DELIVERY':
      return 'Local delivery hub';
    case 'DELIVERED':
      return 'Delivery address';
    default:
      return '';
  }
}

export function humanStatus(status: SellerOrderStatus): string {
  return status
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/** Full order for the customer's order-detail page, grouped by seller (§25). */
export async function getCustomerOrderDetail(orderId: string, customerId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    include: {
      sellerOrders: {
        orderBy: { sellerOrderNumber: 'asc' },
        include: {
          seller: { select: { id: true, businessName: true, slug: true, city: true, state: true } },
          items: true,
          shipments: {
            include: { events: { orderBy: { eventTime: 'asc' } } },
          },
          returns: { select: { id: true, returnNumber: true, status: true } },
        },
      },
      payments: {
        select: { id: true, provider: true, status: true, method: true, capturedAt: true, amount: true },
      },
    },
  });
  if (!order) throw notFound('Order not found.');
  return order;
}

/** A seller's own orders only — scoping enforced by the caller's guard. */
export async function listSellerOrders(
  sellerId: string,
  opts: { status?: SellerOrderStatus; take?: number; skip?: number } = {},
) {
  return prisma.sellerOrder.findMany({
    where: { sellerId, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 50,
    skip: opts.skip ?? 0,
    include: {
      items: true,
      order: {
        select: {
          orderNumber: true,
          createdAt: true,
          shippingAddress: true,
          paymentStatus: true,
        },
      },
      shipments: { select: { id: true, status: true, courier: true, trackingNumber: true } },
    },
  });
}
