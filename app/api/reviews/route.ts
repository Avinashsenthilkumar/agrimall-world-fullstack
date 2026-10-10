// POST /api/reviews — §19. Only verified purchasers can review.
//
// THE GUARANTEE, enforced in three places:
//   1. The review is attached to an ORDER ITEM, and that order item must
//      belong to the signed-in customer's own delivered sub-order.
//   2. `Review.orderItemId` is UNIQUE, so one purchase = at most one review,
//      even under a double-submit race.
//   3. A seller cannot review their own product (checked explicitly).
import { prisma } from '../../../lib/server/prisma';
import { handler, created, ok, parseBody, conflict, notFound, forbidden } from '../../../lib/server/http';
import { requireCustomer } from '../../../lib/server/auth';
import { reviewCreateSchema } from '../../../lib/server/schemas';
import { enforceRateLimit, LIMITS } from '../../../lib/server/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  enforceRateLimit(`review:${session.userId}`, LIMITS.review.limit, LIMITS.review.windowMs);

  const body = await parseBody(req, reviewCreateSchema);

  // (1) The purchase must be this customer's, and delivered.
  const item = await prisma.orderItem.findFirst({
    where: {
      id: body.orderItemId,
      sellerOrder: {
        order: { customerId: session.customerId },
      },
    },
    include: {
      sellerOrder: {
        select: {
          status: true,
          deliveredAt: true,
          sellerId: true,
          seller: { select: { userId: true } },
        },
      },
      review: { select: { id: true } },
    },
  });

  if (!item) throw notFound('We could not find that purchase on your account.');
  if (item.sellerOrder.status !== 'DELIVERED') {
    throw conflict('You can review an item once it has been delivered.');
  }
  if (item.review) throw conflict('You have already reviewed this item.');
  // (3) No self-reviews.
  if (item.sellerOrder.seller.userId === session.userId) {
    throw forbidden('You cannot review your own product.');
  }

  const review = await prisma.$transaction(async (tx) => {
    const r = await tx.review.create({
      data: {
        customerId: session.customerId,
        productId: item.productId,
        orderItemId: item.id,
        rating: body.rating,
        title: body.title ?? null,
        comment: body.comment ?? null,
        imageUrls: body.imageUrls as unknown as object,
        status: 'PUBLISHED',
      },
    });

    await tx.orderItem.update({ where: { id: item.id }, data: { reviewedAt: new Date() } });

    // Recompute the product's aggregate from the actual rows, rather than
    // nudging a running average (which drifts and can't be repaired).
    const agg = await tx.review.aggregate({
      where: { productId: item.productId, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: true,
    });
    await tx.product.update({
      where: { id: item.productId },
      data: {
        ratingAvg: Number((agg._avg.rating ?? 0).toFixed(2)),
        ratingCount: agg._count,
      },
    });

    // And the seller's overall rating.
    const sellerAgg = await tx.review.aggregate({
      where: { product: { sellerId: item.sellerOrder.sellerId }, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: true,
    });
    await tx.seller.update({
      where: { id: item.sellerOrder.sellerId },
      data: {
        ratingAvg: Number((sellerAgg._avg.rating ?? 0).toFixed(2)),
        ratingCount: sellerAgg._count,
      },
    });

    return r;
  });

  return created({ review: { id: review.id, rating: review.rating, status: review.status } });
});

// GET /api/reviews — the customer's own reviews, and what they still can review.
export const GET = handler(async () => {
  const session = await requireCustomer();

  const [mine, pending] = await Promise.all([
    prisma.review.findMany({
      where: { customerId: session.customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        product: { select: { name: true, slug: true, images: { take: 1, select: { url: true } } } },
      },
    }),
    prisma.orderItem.findMany({
      where: {
        sellerOrder: { order: { customerId: session.customerId }, status: 'DELIVERED' },
        reviewedAt: null,
      },
      take: 50,
      orderBy: { sellerOrder: { deliveredAt: 'desc' } },
      select: {
        id: true,
        productId: true,
        productNameSnapshot: true,
        imageSnapshot: true,
        sellerOrder: { select: { sellerOrderNumber: true, deliveredAt: true } },
      },
    }),
  ]);

  return ok({
    reviews: mine.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      comment: r.comment,
      createdAt: r.createdAt,
      status: r.status,
      sellerReply: r.sellerReply,
      product: {
        name: r.product.name,
        slug: r.product.slug,
        image: r.product.images[0]?.url ?? null,
      },
    })),
    awaitingReview: pending.map((p) => ({
      orderItemId: p.id,
      productId: p.productId,
      name: p.productNameSnapshot,
      image: p.imageSnapshot,
      orderNumber: p.sellerOrder.sellerOrderNumber,
      deliveredAt: p.sellerOrder.deliveredAt,
    })),
  });
});
