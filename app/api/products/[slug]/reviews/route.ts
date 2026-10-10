// GET /api/products/[slug]/reviews — paginated published reviews.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok, notFound, parseQuery } from '../../../../../lib/server/http';
import { paginationSchema } from '../../../../../lib/server/schemas';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request, { params }: { params: { slug: string } }) => {
  const { page, perPage } = parseQuery(req, paginationSchema);

  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    select: { id: true },
  });
  if (!product) throw notFound('Product not found.');

  const where = { productId: product.id, status: 'PUBLISHED' as const };
  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        rating: true,
        title: true,
        comment: true,
        imageUrls: true,
        createdAt: true,
        sellerReply: true,
        customer: { select: { fullName: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);

  return ok({
    reviews: rows.map((r) => ({
      ...r,
      author: r.customer.fullName.split(/\s+/)[0],
      customer: undefined,
    })),
    pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
  });
});
