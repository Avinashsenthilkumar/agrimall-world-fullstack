// GET /api/orders/track/[orderNumber]?phone=XXXXXXXXXX
//
// Guest tracking for the "Track Order" box on the storefront.
//
// Access control: knowing an order number is NOT enough — the request must
// also match the last 4 digits of the delivery phone on that order. Without
// that, sequential order numbers would expose other customers' addresses.
// A signed-in customer tracking their own order skips the check.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok, notFound, badRequest } from '../../../../../lib/server/http';
import { getSessionUser } from '../../../../../lib/server/session';
import { enforceRateLimit } from '../../../../../lib/server/ratelimit';
import { clientIp } from '../../../../../lib/server/audit';
import { TRACKING_PROGRESS, type SellerOrderStatus } from '../../../../../lib/shared/order-status';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request, { params }: { params: { orderNumber: string } }) => {
  const ip = clientIp(req) ?? 'unknown';
  // Keeps this from being used to enumerate order numbers.
  enforceRateLimit(`track:${ip}`, 20, 10 * 60_000);

  const orderNumber = params.orderNumber.trim().toUpperCase();
  const url = new URL(req.url);
  const phoneLast4 = (url.searchParams.get('phone') ?? '').replace(/\D/g, '').slice(-4);

  const session = await getSessionUser();

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      orderStatus: true,
      paymentStatus: true,
      createdAt: true,
      shippingAddress: true,
      sellerOrders: {
        select: {
          sellerOrderNumber: true,
          status: true,
          seller: { select: { businessName: true, city: true, state: true } },
          items: { select: { productNameSnapshot: true, quantity: true } },
          shipments: {
            select: {
              courier: true,
              trackingNumber: true,
              status: true,
              estimatedDelivery: true,
              deliveredAt: true,
              events: {
                orderBy: { eventTime: 'asc' },
                select: { status: true, location: true, message: true, eventTime: true },
              },
            },
          },
        },
      },
    },
  });

  if (!order) throw notFound(`We could not find an order numbered ${orderNumber}.`);

  const isOwner = Boolean(session?.customerId && session.customerId === order.customerId);

  if (!isOwner) {
    const addr = order.shippingAddress as { phone?: string } | null;
    const expected = (addr?.phone ?? '').replace(/\D/g, '').slice(-4);
    if (!phoneLast4) {
      throw badRequest(
        'Please also enter the last 4 digits of the delivery phone number to view this order.',
      );
    }
    if (!expected || phoneLast4 !== expected) {
      // Same message as "not found", so a wrong guess reveals nothing.
      throw notFound(`We could not find an order numbered ${orderNumber}.`);
    }
  }

  return ok({
    orderNumber: order.orderNumber,
    status: order.orderStatus,
    placedAt: order.createdAt,
    // Guest view deliberately omits the full address and all money.
    parcels: order.sellerOrders.map((so) => {
      const shipment = so.shipments[0] ?? null;
      return {
        sellerOrderNumber: so.sellerOrderNumber,
        sellerName: so.seller.businessName,
        origin: [so.seller.city, so.seller.state].filter(Boolean).join(', '),
        status: so.status,
        progress: TRACKING_PROGRESS[so.status as SellerOrderStatus] ?? 0,
        itemsLabel: so.items
          .map((i) => `${i.productNameSnapshot}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
          .join(', '),
        courier: shipment?.courier ?? null,
        trackingNumber: shipment?.trackingNumber ?? null,
        estimatedDelivery: shipment?.estimatedDelivery ?? null,
        deliveredAt: shipment?.deliveredAt ?? null,
        events: shipment?.events ?? [],
      };
    }),
  });
});
