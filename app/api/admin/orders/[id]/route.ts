// GET /api/admin/orders/[id] — full order forensics for support.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok, notFound } from '../../../../../lib/server/http';
import { requireAdmin } from '../../../../../lib/server/auth';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireAdmin();

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { fullName: true, user: { select: { email: true, phone: true } } } },
      sellerOrders: {
        include: {
          seller: { select: { id: true, businessName: true, businessPhone: true } },
          items: true,
          shipments: { include: { events: { orderBy: { eventTime: 'asc' } } } },
          statusLog: { orderBy: { createdAt: 'asc' } },
          commission: true,
          payout: true,
          returns: { include: { items: true, refund: true } },
        },
      },
      payments: true,
      refunds: true,
      reservations: true,
      couponUsage: { include: { coupon: { select: { code: true, discountType: true } } } },
    },
  });

  if (!order) throw notFound('Order not found.');
  return ok({ order });
});
