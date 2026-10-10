// GET /api/health — row counts and effective configuration, so you can
// confirm at a glance that the database is live and what is wired up.
// (Replaces v1's /api/seed, which both seeded and reported.)
import { prisma } from '../../../lib/server/prisma';
import { handler, ok } from '../../../lib/server/http';
import { onlinePaymentConfigured, env } from '../../../lib/server/env';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const [users, sellers, approvedSellers, products, activeProducts, orders, sellerOrders] =
    await Promise.all([
      prisma.user.count(),
      prisma.seller.count(),
      prisma.seller.count({ where: { status: 'APPROVED' } }),
      prisma.product.count(),
      prisma.product.count({ where: { status: 'ACTIVE', approvalStatus: 'APPROVED' } }),
      prisma.order.count(),
      prisma.sellerOrder.count(),
    ]);

  return ok({
    status: 'ok',
    database: 'connected',
    counts: { users, sellers, approvedSellers, products, activeProducts, orders, sellerOrders },
    config: {
      paymentProvider: env.PAYMENT_PROVIDER,
      // Honest about whether real payments can happen (§29, §1399).
      onlinePaymentConfigured: onlinePaymentConfigured(),
      storageDriver: env.STORAGE_DRIVER,
      emailDriver: env.EMAIL_DRIVER,
    },
  });
});
