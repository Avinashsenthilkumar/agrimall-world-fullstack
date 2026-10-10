// GET /api/categories — navigation tree with live product counts.
import { prisma } from '../../../lib/server/prisma';
import { handler, ok } from '../../../lib/server/http';

export const revalidate = 60;

export const GET = handler(async () => {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      parentId: true,
      _count: {
        select: {
          products: {
            where: { status: 'ACTIVE', approvalStatus: 'APPROVED', seller: { status: 'APPROVED' } },
          },
        },
      },
    },
  });

  return ok({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      imageUrl: c.imageUrl,
      parentId: c.parentId,
      productCount: c._count.products,
    })),
  });
});
