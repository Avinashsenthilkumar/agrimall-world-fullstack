// GET /api/seller/orders/[id] — one of this seller's sub-orders.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok } from '../../../../../lib/server/http';
import { requireSeller, ownedSellerOrder } from '../../../../../lib/server/auth';
import { nextSellerOrderStatus, SELLER_ORDER_ACTION_LABEL, type SellerOrderStatus } from '../../../../../lib/shared/order-status';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSeller();
  await ownedSellerOrder(session, params.id);

  const so = await prisma.sellerOrder.findUnique({
    where: { id: params.id },
    include: {
      items: true,
      order: { select: { orderNumber: true, createdAt: true, shippingAddress: true, customerNote: true } },
      shipments: { include: { events: { orderBy: { eventTime: 'asc' } } } },
      statusLog: { orderBy: { createdAt: 'asc' } },
      commission: true,
      payout: true,
      returns: { include: { items: true } },
    },
  });
  if (!so) return ok({ order: null });

  const status = so.status as SellerOrderStatus;
  const next = nextSellerOrderStatus(status);
  const addr = so.order.shippingAddress as Record<string, string>;

  return ok({
    order: {
      id: so.id,
      sellerOrderNumber: so.sellerOrderNumber,
      customerOrderNumber: so.order.orderNumber,
      status,
      placedAt: so.order.createdAt,
      customerNote: so.order.customerNote,
      items: so.items,
      money: {
        subtotal: so.subtotal,
        discount: so.discount,
        tax: so.tax,
        shippingFee: so.shippingFee,
        gross: so.grossAmount,
        commissionRate: Number(so.commissionRate),
        commission: so.commissionAmount,
        earning: so.sellerEarning,
      },
      commission: so.commission,
      payout: so.payout,
      payoutStatus: so.payoutStatus,
      shipTo:
        status === 'PENDING'
          ? { city: addr.city, state: addr.state, pincode: addr.pincode }
          : addr,
      shipment: so.shipments[0] ?? null,
      trackingEvents: so.shipments[0]?.events ?? [],
      statusHistory: so.statusLog,
      returns: so.returns,
      nextAction: next ? { to: next, label: SELLER_ORDER_ACTION_LABEL[next] ?? next } : null,
      requiresCourierDetails: next === 'SHIPPED',
    },
  });
});
