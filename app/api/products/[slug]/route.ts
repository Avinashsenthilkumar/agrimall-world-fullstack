// GET /api/products/[slug] — product detail page.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, notFound } from '../../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, { params }: { params: { slug: string } }) => {
  const product = await prisma.product.findFirst({
    where: {
      slug: params.slug,
      approvalStatus: 'APPROVED',
      status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
      seller: { status: 'APPROVED' },
    },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      variants: {
        where: { isActive: true },
        include: { inventory: { select: { onHand: true, reserved: true } } },
      },
      category: { select: { id: true, name: true, slug: true } },
      brand: { select: { name: true, slug: true } },
      seller: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          city: true,
          state: true,
          country: true,
          ratingAvg: true,
          ratingCount: true,
          logoUrl: true,
        },
      },
      inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } },
      reviews: {
        where: { status: 'PUBLISHED' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          rating: true,
          title: true,
          comment: true,
          createdAt: true,
          sellerReply: true,
          sellerRepliedAt: true,
          customer: { select: { fullName: true } },
        },
      },
    },
  });

  if (!product) throw notFound('That plant is no longer listed.');

  const available = product.inventory
    ? Math.max(0, product.inventory.onHand - product.inventory.reserved)
    : 0;

  // Rating histogram for the reviews panel.
  const histogram = await prisma.review.groupBy({
    by: ['rating'],
    where: { productId: product.id, status: 'PUBLISHED' },
    _count: true,
  });

  return ok({
    product: {
      id: product.id,
      name: product.name,
      slug: product.slug,
      latinName: product.latinName,
      description: product.description,
      sku: product.sku,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      taxRate: Number(product.taxRate),
      images: product.images.map((i) => ({ url: i.url, alt: i.alt })),
      variants: product.variants.map((v) => ({
        id: v.id,
        name: v.name,
        value: v.value,
        price: v.price ?? product.price,
        inStock: v.inventory ? v.inventory.onHand - v.inventory.reserved > 0 : false,
      })),
      category: product.category,
      brand: product.brand,
      seller: { ...product.seller, ratingAvg: Number(product.seller.ratingAvg) },
      care: {
        light: product.careLight,
        water: product.careWater,
        temp: product.careTemp,
        difficulty: product.careDifficulty,
        safety: product.careSafety,
      },
      weightGrams: product.weightGrams,
      originLabel: product.originLabel,
      rating: Number(product.ratingAvg),
      reviewCount: product.ratingCount,
      inStock: available > 0,
      lowStock: available > 0 && available <= (product.inventory?.lowStockThreshold ?? 10),
      // A shopper needs to know they can't add 20; they don't need the exact
      // figure unless it is low enough to matter.
      maxOrderQuantity: Math.min(available, 10),
    },
    reviews: product.reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      comment: r.comment,
      createdAt: r.createdAt,
      author: maskName(r.customer.fullName),
      sellerReply: r.sellerReply,
      sellerRepliedAt: r.sellerRepliedAt,
    })),
    ratingHistogram: [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: histogram.find((h) => h.rating === star)?._count ?? 0,
    })),
  });
});

/** "Priya Menon" → "Priya M." — reviews shouldn't publish full names. */
function maskName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
