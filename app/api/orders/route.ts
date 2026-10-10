// GET /api/orders — the signed-in customer's own orders only (§23).
import { prisma } from '../../../lib/server/prisma';
import { handler, ok, parseQuery } from '../../../lib/server/http';
import { requireCustomer } from '../../../lib/server/auth';
import { orderListQuerySchema } from '../../../lib/server/schemas';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const session = await requireCustomer();
  const q = parseQuery(req, orderListQuerySchema);

  // customerId is from the session, never the query string.
  const where = {
    customerId: session.customerId,
    ...(q.status ? { orderStatus: q.status as never } : {}),
    ...(q.q ? { orderNumber: { contains: q.q.toUpperCase() } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        orderStatus: true,
        paymentStatus: true,
        createdAt: true,
        sellerOrders: {
          select: {
            id: true,
            sellerOrderNumber: true,
            status: true,
            grossAmount: true,
            seller: { select: { businessName: true, slug: true } },
            items: {
              select: { productNameSnapshot: true, imageSnapshot: true, quantity: true },
            },
            shipments: { select: { status: true, trackingNumber: true, courier: true } },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return ok({
    orders: rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      grandTotal: o.grandTotal,
      status: o.orderStatus,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
      // The customer sees one order containing N seller parcels (§16).
      parcelCount: o.sellerOrders.length,
      parcels: o.sellerOrders.map((so) => ({
        id: so.id,
        sellerOrderNumber: so.sellerOrderNumber,
        sellerName: so.seller.businessName,
        sellerSlug: so.seller.slug,
        status: so.status,
        total: so.grossAmount,
        itemCount: so.items.reduce((a, i) => a + i.quantity, 0),
        thumbnail: so.items[0]?.imageSnapshot ?? null,
        itemsLabel: so.items
          .map((i) => `${i.productNameSnapshot}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
          .join(', '),
        courier: so.shipments[0]?.courier ?? null,
        trackingNumber: so.shipments[0]?.trackingNumber ?? null,
      })),
    })),
    pagination: { page: q.page, perPage: q.perPage, total, pages: Math.ceil(total / q.perPage) },
  });
});
