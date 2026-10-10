// GET /api/orders/[id] — order detail with SEPARATE TRACKING PER SELLER (§16, §17).
//
// This is the shape v1 could not produce: one order, a tracking ladder per
// seller shipment, each with its own real recorded events.
import { handler, ok } from '../../../../lib/server/http';
import { requireCustomer } from '../../../../lib/server/auth';
import { getCustomerOrderDetail } from '../../../../lib/server/orders';
import {
  CUSTOMER_TRACKING_LADDER,
  TRACKING_PROGRESS,
  ladderIndex,
  type SellerOrderStatus,
} from '../../../../lib/shared/order-status';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const session = await requireCustomer();
  const order = await getCustomerOrderDetail(params.id, session.customerId);

  return ok({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.orderStatus,
      paymentStatus: order.paymentStatus,
      subtotal: order.subtotal,
      discount: order.discount,
      tax: order.tax,
      shippingFee: order.shippingFee,
      grandTotal: order.grandTotal,
      couponCode: order.couponCode,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      createdAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      customerNote: order.customerNote,
      payment: order.payments[0]
        ? {
            provider: order.payments[0].provider,
            method: order.payments[0].method,
            status: order.payments[0].status,
            capturedAt: order.payments[0].capturedAt,
            amount: order.payments[0].amount,
          }
        : null,
    },
    // One entry per seller — each independently trackable.
    parcels: order.sellerOrders.map((so) => {
      const status = so.status as SellerOrderStatus;
      const currentIdx = ladderIndex(status);
      const shipment = so.shipments[0] ?? null;
      const events = shipment?.events ?? [];

      return {
        id: so.id,
        sellerOrderNumber: so.sellerOrderNumber,
        status,
        seller: {
          id: so.seller.id,
          name: so.seller.businessName,
          slug: so.seller.slug,
          location: [so.seller.city, so.seller.state].filter(Boolean).join(', '),
        },
        items: so.items.map((i) => ({
          id: i.id,
          name: i.productNameSnapshot,
          sku: i.skuSnapshot,
          image: i.imageSnapshot,
          variant: i.variantSnapshot,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
          productId: i.productId,
          // Drives the "Write a review" button (§19).
          reviewable: so.status === 'DELIVERED' && !i.reviewedAt,
          reviewed: Boolean(i.reviewedAt),
        })),
        totals: {
          subtotal: so.subtotal,
          discount: so.discount,
          tax: so.tax,
          shippingFee: so.shippingFee,
          total: so.grossAmount,
        },
        shipment: shipment
          ? {
              id: shipment.id,
              courier: shipment.courier,
              trackingNumber: shipment.trackingNumber,
              status: shipment.status,
              estimatedDelivery: shipment.estimatedDelivery,
              deliveredAt: shipment.deliveredAt,
            }
          : null,
        progress: TRACKING_PROGRESS[status] ?? 0,
        // The ladder, marked up with the real event that produced each step.
        ladder: CUSTOMER_TRACKING_LADDER.map((step, i) => {
          const event = events.find((e) => trackingMatches(e.status, step.status));
          return {
            status: step.status,
            title: step.title,
            note: step.note,
            icon: step.icon,
            done: currentIdx >= 0 && i < currentIdx,
            current: step.status === status,
            at: event?.eventTime ?? null,
            location: event?.location ?? null,
            message: event?.message ?? null,
          };
        }),
        events: events.map((e) => ({
          status: e.status,
          location: e.location,
          message: e.message,
          at: e.eventTime,
        })),
        cancellable: ['PENDING', 'ACCEPTED', 'PACKING'].includes(so.status),
        returnable: so.status === 'DELIVERED' && so.returns.length === 0,
        returns: so.returns,
      };
    }),
  });
});

/** Tracking event types don't map 1:1 onto ladder statuses. */
function trackingMatches(eventStatus: string, ladderStatus: SellerOrderStatus): boolean {
  const map: Record<string, SellerOrderStatus> = {
    ORDER_CONFIRMED: 'ACCEPTED',
    PACKED: 'PACKING',
    READY_FOR_PICKUP: 'READY_FOR_PICKUP',
    PICKED_UP: 'SHIPPED',
    IN_TRANSIT: 'IN_TRANSIT',
    ARRIVED_AT_HUB: 'IN_TRANSIT',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
  };
  return map[eventStatus] === ladderStatus;
}
