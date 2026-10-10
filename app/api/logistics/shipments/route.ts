// GET /api/logistics/shipments — §2 LOGISTICS role: the courier's work queue.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok } from '../../../../lib/server/http';
import { requireLogistics } from '../../../../lib/server/auth';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  await requireLogistics();
  const status = new URL(req.url).searchParams.get('status');

  const shipments = await prisma.shipment.findMany({
    where: {
      ...(status ? { status: status as never } : { status: { notIn: ['DELIVERED', 'RETURNED'] } }),
      sellerOrder: { paymentStatus: 'CAPTURED' },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: 200,
    include: {
      sellerOrder: {
        select: {
          id: true,
          sellerOrderNumber: true,
          status: true,
          seller: { select: { businessName: true, city: true, state: true, businessPhone: true } },
          order: { select: { orderNumber: true, shippingAddress: true } },
          items: { select: { productNameSnapshot: true, quantity: true } },
        },
      },
      events: { orderBy: { eventTime: 'desc' }, take: 1 },
    },
  });

  return ok({
    shipments: shipments.map((s) => {
      const addr = s.sellerOrder.order.shippingAddress as Record<string, string>;
      return {
        id: s.id,
        sellerOrderId: s.sellerOrder.id,
        sellerOrderNumber: s.sellerOrder.sellerOrderNumber,
        customerOrderNumber: s.sellerOrder.order.orderNumber,
        orderStatus: s.sellerOrder.status,
        shipmentStatus: s.status,
        courier: s.courier,
        trackingNumber: s.trackingNumber,
        estimatedDelivery: s.estimatedDelivery,
        pickup: {
          name: s.sellerOrder.seller.businessName,
          location: [s.sellerOrder.seller.city, s.sellerOrder.seller.state].filter(Boolean).join(', '),
          phone: s.sellerOrder.seller.businessPhone,
        },
        deliverTo: {
          name: addr.fullName,
          phone: addr.phone,
          line1: addr.line1,
          line2: addr.line2,
          city: addr.city,
          state: addr.state,
          pincode: addr.pincode,
        },
        contents: s.sellerOrder.items
          .map((i) => `${i.productNameSnapshot}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
          .join(', '),
        lastEvent: s.events[0] ?? null,
      };
    }),
  });
});
