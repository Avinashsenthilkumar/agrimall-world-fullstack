// GET /api/admin/customers — §21 customer management.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseQuery } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { paginationSchema } from '../../../../lib/server/schemas';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const { page, perPage } = parseQuery(req, paginationSchema);
  const q = new URL(req.url).searchParams.get('q');

  const where = q
    ? {
        OR: [
          { fullName: { contains: q, mode: 'insensitive' as const } },
          { user: { email: { contains: q, mode: 'insensitive' as const } } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        fullName: true,
        createdAt: true,
        user: {
          select: { email: true, phone: true, isActive: true, emailVerifiedAt: true, lastLoginAt: true },
        },
        _count: { select: { orders: true, reviews: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  // Lifetime value per customer, for the list.
  const spend = await prisma.order.groupBy({
    by: ['customerId'],
    where: { customerId: { in: rows.map((r) => r.id) }, paymentStatus: 'CAPTURED' },
    _sum: { grandTotal: true },
  });
  const spendBy = new Map(spend.map((s) => [s.customerId, s._sum.grandTotal ?? 0]));

  return ok({
    customers: rows.map((c) => ({
      id: c.id,
      name: c.fullName,
      email: c.user.email,
      phone: c.user.phone,
      isActive: c.user.isActive,
      emailVerified: Boolean(c.user.emailVerifiedAt),
      lastLoginAt: c.user.lastLoginAt,
      joinedAt: c.createdAt,
      orderCount: c._count.orders,
      reviewCount: c._count.reviews,
      lifetimeSpend: spendBy.get(c.id) ?? 0,
    })),
    pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
  });
});
