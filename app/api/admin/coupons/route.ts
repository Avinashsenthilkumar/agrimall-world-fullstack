// GET  /api/admin/coupons — §20.
// POST /api/admin/coupons — create one (platform / seller / category / product).
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, created, parseBody, conflict } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { couponSchema } from '../../../../lib/server/schemas';
import { auditNow } from '../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  await requireAdmin();
  const coupons = await prisma.coupon.findMany({
    orderBy: [{ isActive: 'desc' }, { expiresAt: 'desc' }],
    take: 200,
    include: {
      seller: { select: { businessName: true } },
      category: { select: { name: true } },
      product: { select: { name: true } },
      _count: { select: { usages: true } },
    },
  });

  const now = new Date();
  return ok({
    coupons: coupons.map((c) => ({
      id: c.id,
      code: c.code,
      scope: c.scope,
      description: c.description,
      discountType: c.discountType,
      discountValue: c.discountValue,
      maxDiscount: c.maxDiscount,
      minOrderValue: c.minOrderValue,
      target:
        c.seller?.businessName ?? c.category?.name ?? c.product?.name ?? 'All of Agri Mall',
      startsAt: c.startsAt,
      expiresAt: c.expiresAt,
      usageLimit: c.usageLimit,
      usageCount: c.usageCount,
      perCustomerLimit: c.perCustomerLimit,
      isActive: c.isActive,
      redemptions: c._count.usages,
      state: !c.isActive
        ? 'DISABLED'
        : c.startsAt > now
          ? 'SCHEDULED'
          : c.expiresAt < now
            ? 'EXPIRED'
            : c.usageLimit != null && c.usageCount >= c.usageLimit
              ? 'EXHAUSTED'
              : 'LIVE',
    })),
  });
});

export const POST = handler(async (req: Request) => {
  const session = await requireAdmin();
  const body = await parseBody(req, couponSchema);

  const existing = await prisma.coupon.findUnique({ where: { code: body.code }, select: { id: true } });
  if (existing) throw conflict(`A coupon with the code ${body.code} already exists.`);

  // PERCENT keeps its 1-100 value; FIXED is entered in rupees → paise.
  const discountValue =
    body.discountType === 'PERCENT' ? Math.round(body.discountValue) : Math.round(body.discountValue * 100);

  const coupon = await prisma.coupon.create({
    data: {
      code: body.code,
      scope: body.scope,
      description: body.description ?? null,
      discountType: body.discountType,
      discountValue,
      maxDiscount: body.maxDiscountRupees != null ? Math.round(body.maxDiscountRupees * 100) : null,
      minOrderValue: Math.round(body.minOrderRupees * 100),
      sellerId: body.sellerId ?? null,
      categoryId: body.categoryId ?? null,
      productId: body.productId ?? null,
      startsAt: body.startsAt,
      expiresAt: body.expiresAt,
      usageLimit: body.usageLimit ?? null,
      perCustomerLimit: body.perCustomerLimit,
      isActive: body.isActive,
    },
  });

  await auditNow({
    actorId: session.userId,
    actorRole: 'ADMIN',
    action: 'COUPON_CREATED',
    entityType: 'Coupon',
    entityId: coupon.id,
    metadata: { code: coupon.code, scope: coupon.scope, discountValue },
  });

  return created({ coupon, message: `Coupon ${coupon.code} created.` });
});

// PATCH /api/admin/coupons?id=... — enable/disable without deleting history.
export const PATCH = handler(async (req: Request) => {
  const session = await requireAdmin();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw conflict('Coupon id is required.');
  const body = (await req.json().catch(() => ({}))) as { isActive?: boolean };

  const coupon = await prisma.coupon.update({
    where: { id },
    data: { isActive: Boolean(body.isActive) },
  });

  await auditNow({
    actorId: session.userId,
    actorRole: 'ADMIN',
    action: coupon.isActive ? 'COUPON_ENABLED' : 'COUPON_DISABLED',
    entityType: 'Coupon',
    entityId: coupon.id,
  });

  return ok({ coupon });
});
