// GET /api/admin/orders — every order, with the full seller split (§21).
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseQuery } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { orderListQuerySchema } from '../../../../lib/server/schemas';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const q = parseQuery(req, orderListQuerySchema);
  const sellerId = new URL(req.url).searchParams.get('sellerId');

  const where: Prisma.OrderWhereInput = {
    ...(q.status ? { orderStatus: q.status as never } : {}),
    ...(sellerId ? { sellerOrders: { some: { sellerId } } } : {}),
    ...(q.q
      ? {
          OR: [
            { orderNumber: { contains: q.q.toUpperCase() } },
            { customer: { fullName: { contains: q.q, mode: 'insensitive' } } },
            { sellerOrders: { some: { sellerOrderNumber: { contains: q.q.toUpperCase() } } } },
          ],
        }
      : {}),
  };

  const [rows, total, statusCounts] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: {
        customer: { select: { id: true, fullName: true, user: { select: { email: true } } } },
        sellerOrders: {
          include: {
            seller: { select: { id: true, businessName: true } },
            items: { select: { productNameSnapshot: true, quantity: true } },
            shipments: { select: { courier: true, trackingNumber: true, status: true } },
          },
        },
        payments: { select: { provider: true, status: true, method: true, amount: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ['orderStatus'], _count: true }),
  ]);

  return ok({
    orders: rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customer: {
        id: o.customer.id,
        name: o.customer.fullName,
        email: o.customer.user.email,
      },
      status: o.orderStatus,
      paymentStatus: o.paymentStatus,
      subtotal: o.subtotal,
      discount: o.discount,
      tax: o.tax,
      shippingFee: o.shippingFee,
      grandTotal: o.grandTotal,
      payment: o.payments[0] ?? null,
      shippingAddress: o.shippingAddress,
      createdAt: o.createdAt,
      // The complete fan-out, which only admins see.
      sellerOrders: o.sellerOrders.map((so) => ({
        id: so.id,
        sellerOrderNumber: so.sellerOrderNumber,
        seller: so.seller,
        status: so.status,
        gross: so.grossAmount,
        commissionRate: Number(so.commissionRate),
        commission: so.commissionAmount,
        sellerEarning: so.sellerEarning,
        payoutStatus: so.payoutStatus,
        itemsLabel: so.items
          .map((i) => `${i.productNameSnapshot}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
          .join(', '),
        shipment: so.shipments[0] ?? null,
      })),
    })),
    statusCounts: statusCounts.map((s) => ({ status: s.orderStatus, count: s._count })),
    pagination: { page: q.page, perPage: q.perPage, total, pages: Math.ceil(total / q.perPage) },
  });
});
