// GET /api/wishlist — the customer's saved plants (§6).
import { prisma } from '../../../lib/server/prisma';
import { handler, ok, created, parseBody } from '../../../lib/server/http';
import { requireCustomer } from '../../../lib/server/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function wishlistOf(customerId: string) {
  const existing = await prisma.wishlist.findUnique({ where: { customerId } });
  if (existing) return existing;
  return prisma.wishlist.create({ data: { customerId } });
}

export const GET = handler(async () => {
  const session = await requireCustomer();
  const wishlist = await wishlistOf(session.customerId);

  const items = await prisma.wishlistItem.findMany({
    where: { wishlistId: wishlist.id },
    orderBy: { addedAt: 'desc' },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          compareAtPrice: true,
          status: true,
          ratingAvg: true,
          ratingCount: true,
          images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
          seller: { select: { businessName: true, status: true } },
        },
      },
    },
  });

  return ok({
    items: items
      .filter((i) => i.product.seller.status === 'APPROVED')
      .map((i) => ({
        id: i.id,
        productId: i.product.id,
        name: i.product.name,
        slug: i.product.slug,
        price: i.product.price,
        compareAtPrice: i.product.compareAtPrice,
        imageUrl: i.product.images[0]?.url ?? null,
        rating: Number(i.product.ratingAvg),
        reviewCount: i.product.ratingCount,
        sellerName: i.product.seller.businessName,
        inStock: i.product.status === 'ACTIVE',
      })),
  });
});

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = await parseBody(req, z.object({ productId: z.string().min(1) }).strict());
  const wishlist = await wishlistOf(session.customerId);

  // Idempotent: saving twice is not an error.
  await prisma.wishlistItem.upsert({
    where: { wishlistId_productId: { wishlistId: wishlist.id, productId: body.productId } },
    create: { wishlistId: wishlist.id, productId: body.productId },
    update: {},
  });

  return created({ saved: true });
});
