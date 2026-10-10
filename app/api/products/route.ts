// GET /api/products — the public storefront catalogue.
//
// Only ever returns products that are ACTIVE + APPROVED and whose seller is
// APPROVED. A suspended seller's listings disappear from the shop without
// anything having to be deleted.
import { prisma } from '../../../lib/server/prisma';
import { handler, ok, parseQuery } from '../../../lib/server/http';
import { productQuerySchema } from '../../../lib/server/schemas';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const q = parseQuery(req, productQuerySchema);

  const where: Prisma.ProductWhereInput = {
    approvalStatus: 'APPROVED',
    status: q.inStock === 'true' ? 'ACTIVE' : { in: ['ACTIVE', 'OUT_OF_STOCK'] },
    seller: { status: 'APPROVED' },
    ...(q.category ? { category: { slug: q.category } } : {}),
    ...(q.seller ? { sellerId: q.seller } : {}),
    ...(q.minPrice != null || q.maxPrice != null
      ? {
          price: {
            ...(q.minPrice != null ? { gte: Math.round(q.minPrice * 100) } : {}),
            ...(q.maxPrice != null ? { lte: Math.round(q.maxPrice * 100) } : {}),
          },
        }
      : {}),
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: 'insensitive' } },
            { latinName: { contains: q.q, mode: 'insensitive' } },
            { description: { contains: q.q, mode: 'insensitive' } },
            { originLabel: { contains: q.q, mode: 'insensitive' } },
            { category: { name: { contains: q.q, mode: 'insensitive' } } },
            { seller: { businessName: { contains: q.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    q.sort === 'price_asc'
      ? [{ price: 'asc' }]
      : q.sort === 'price_desc'
        ? [{ price: 'desc' }]
        : q.sort === 'rating'
          ? [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }]
          : q.sort === 'newest'
            ? [{ createdAt: 'desc' }]
            : [{ soldCount: 'desc' }, { ratingAvg: 'desc' }];

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      select: {
        id: true,
        name: true,
        slug: true,
        latinName: true,
        price: true,
        compareAtPrice: true,
        status: true,
        ratingAvg: true,
        ratingCount: true,
        soldCount: true,
        careDifficulty: true,
        careSafety: true,
        originLabel: true,
        images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true, alt: true } },
        category: { select: { slug: true, name: true } },
        seller: { select: { id: true, businessName: true, slug: true, city: true, state: true } },
        inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return ok({
    products: rows.map((p) => {
      const available = p.inventory ? Math.max(0, p.inventory.onHand - p.inventory.reserved) : 0;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        latinName: p.latinName,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        imageUrl: p.images[0]?.url ?? null,
        rating: Number(p.ratingAvg),
        reviewCount: p.ratingCount,
        category: p.category,
        seller: p.seller,
        careDifficulty: p.careDifficulty,
        careSafety: p.careSafety,
        originLabel: p.originLabel,
        // Exact stock counts are a competitor's business, not a shopper's.
        inStock: available > 0,
        lowStock: available > 0 && available <= (p.inventory?.lowStockThreshold ?? 10),
      };
    }),
    pagination: { page: q.page, perPage: q.perPage, total, pages: Math.ceil(total / q.perPage) },
  });
});
