// GET /api/admin/products — the product moderation queue (§7, §21).
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseQuery } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { paginationSchema } from '../../../../lib/server/schemas';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const { page, perPage } = parseQuery(req, paginationSchema);
  const url = new URL(req.url);
  const approval = url.searchParams.get('approval');
  const q = url.searchParams.get('q');

  const where: Prisma.ProductWhereInput = {
    ...(approval ? { approvalStatus: approval as never } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { seller: { businessName: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total, queue] = await Promise.all([
    prisma.product.findMany({
      where,
      // Pending first — the queue should surface work, not the newest row.
      orderBy: [{ approvalStatus: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        images: { take: 3, orderBy: { sortOrder: 'asc' }, select: { url: true } },
        category: { select: { name: true, slug: true } },
        seller: { select: { id: true, businessName: true, status: true, slug: true } },
        inventory: { select: { onHand: true, reserved: true } },
      },
    }),
    prisma.product.count({ where }),
    prisma.product.groupBy({ by: ['approvalStatus'], _count: true }),
  ]);

  return ok({
    products: rows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      latinName: p.latinName,
      description: p.description,
      sku: p.sku,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      status: p.status,
      approvalStatus: p.approvalStatus,
      rejectionReason: p.rejectionReason,
      images: p.images.map((i) => i.url),
      category: p.category,
      seller: p.seller,
      stock: p.inventory ? p.inventory.onHand - p.inventory.reserved : 0,
      createdAt: p.createdAt,
    })),
    queueCounts: queue.map((g) => ({ approvalStatus: g.approvalStatus, count: g._count })),
    pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
  });
});
