// GET /api/seller/orders — §5, §23. THIS SELLER'S SUB-ORDERS ONLY.
//
// The scoping is the point: a seller sees SellerOrder rows where
// sellerId = their own session value. There is no parameter that lets them
// widen it, and the customer order those rows belong to is never exposed in
// full (they see their own parcel, not the other sellers' items or totals).
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseQuery } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';
import { orderListQuerySchema } from '../../../../lib/server/schemas';
import { nextSellerOrderStatus, SELLER_ORDER_ACTION_LABEL, type SellerOrderStatus } from '../../../../lib/shared/order-status';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const session = await requireSeller();
  const q = parseQuery(req, orderListQuerySchema);

  const where = {
    sellerId: session.sellerId, // from the session, always
    paymentStatus: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as never },
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.q
      ? {
          OR: [
            { sellerOrderNumber: { contains: q.q.toUpperCase() } },
            { order: { orderNumber: { contains: q.q.toUpperCase() } } },
          ],
        }
      : {}),
  };

  const [rows, total, counts] = await Promise.all([
    prisma.sellerOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: {
        items: true,
        order: { select: { orderNumber: true, createdAt: true, shippingAddress: true } },
        shipments: { select: { id: true, courier: true, trackingNumber: true, status: true } },
        returns: { select: { id: true, returnNumber: true, status: true } },
      },
    }),
    prisma.sellerOrder.count({ where }),
    prisma.sellerOrder.groupBy({
      by: ['status'],
      where: { sellerId: session.sellerId, paymentStatus: 'CAPTURED' },
      _count: true,
    }),
  ]);

  return ok({
    orders: rows.map((so) => {
      const status = so.status as SellerOrderStatus;
      const next = nextSellerOrderStatus(status);
      const addr = so.order.shippingAddress as Record<string, string>;

      return {
        id: so.id,
        sellerOrderNumber: so.sellerOrderNumber,
        customerOrderNumber: so.order.orderNumber,
        status,
        placedAt: so.order.createdAt,
        items: so.items.map((i) => ({
          id: i.id,
          name: i.productNameSnapshot,
          sku: i.skuSnapshot,
          image: i.imageSnapshot,
          variant: i.variantSnapshot,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
        })),
        itemsLabel: so.items
          .map((i) => `${i.productNameSnapshot}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
          .join(', '),
        money: {
          subtotal: so.subtotal,
          discount: so.discount,
          tax: so.tax,
          shippingFee: so.shippingFee,
          gross: so.grossAmount,
          commissionRate: Number(so.commissionRate),
          commission: so.commissionAmount,
          // What the seller actually earns — shown openly, as it should be.
          earning: so.sellerEarning,
        },
        payoutStatus: so.payoutStatus,
        // §5: "Customer shipping information as permitted" — the seller gets
        // what they need to ship, and only once they've accepted the order.
        shipTo:
          status === 'PENDING'
            ? { city: addr.city, state: addr.state, pincode: addr.pincode }
            : {
                fullName: addr.fullName,
                phone: addr.phone,
                line1: addr.line1,
                line2: addr.line2,
                city: addr.city,
                state: addr.state,
                pincode: addr.pincode,
                country: addr.country,
              },
        shipment: so.shipments[0] ?? null,
        returns: so.returns,
        nextAction: next ? { to: next, label: SELLER_ORDER_ACTION_LABEL[next] ?? next } : null,
        requiresCourierDetails: next === 'SHIPPED',
      };
    }),
    statusCounts: counts.map((c) => ({ status: c.status, count: c._count })),
    pagination: { page: q.page, perPage: q.perPage, total, pages: Math.ceil(total / q.perPage) },
  });
});
