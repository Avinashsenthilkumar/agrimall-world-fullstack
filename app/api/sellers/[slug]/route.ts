// GET /api/sellers/[slug] — a seller's public storefront.
// Returns no KYC, no bank details, no contact email (§4).
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok } from '../../../../lib/server/http';
import { publicSellerProfile } from '../../../../lib/server/sellers';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, { params }: { params: { slug: string } }) => {
  const seller = await publicSellerProfile(params.slug);

  const products = await prisma.product.findMany({
    where: {
      sellerId: seller.id,
      status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
      approvalStatus: 'APPROVED',
    },
    orderBy: [{ soldCount: 'desc' }],
    take: 48,
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
    },
  });

  return ok({
    seller: {
      ...seller,
      ratingAvg: Number(seller.ratingAvg),
      productCount: seller._count.products,
      _count: undefined,
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      imageUrl: p.images[0]?.url ?? null,
      rating: Number(p.ratingAvg),
      reviewCount: p.ratingCount,
      inStock: p.status === 'ACTIVE',
    })),
  });
});
