// GET / POST / PATCH /api/admin/categories — §21. Includes the category-level
// commission override the pricing engine reads.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, created, parseBody, conflict, badRequest } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { categorySchema } from '../../../../lib/server/schemas';
import { auditNow } from '../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  await requireAdmin();
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } }, parent: { select: { name: true } } },
  });
  return ok({
    categories: categories.map((c) => ({
      ...c,
      commissionRate: c.commissionRate != null ? Number(c.commissionRate) : null,
      taxRate: Number(c.taxRate),
      productCount: c._count.products,
      parentName: c.parent?.name ?? null,
      _count: undefined,
      parent: undefined,
    })),
  });
});

export const POST = handler(async (req: Request) => {
  const session = await requireAdmin();
  const body = await parseBody(req, categorySchema);

  const slug = body.slug ?? slugify(body.name);
  const existing = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  if (existing) throw conflict(`A category with the slug "${slug}" already exists.`);

  const category = await prisma.category.create({
    data: {
      name: body.name,
      slug,
      parentId: body.parentId ?? null,
      imageUrl: body.imageUrl ?? null,
      description: body.description ?? null,
      commissionRate: body.commissionRate ?? null,
      taxRate: body.taxRate,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    },
  });

  await auditNow({
    actorId: session.userId,
    actorRole: 'ADMIN',
    action: 'CATEGORY_CREATED',
    entityType: 'Category',
    entityId: category.id,
    metadata: { name: category.name, commissionRate: body.commissionRate ?? null },
  });

  return created({ category });
});

export const PATCH = handler(async (req: Request) => {
  const session = await requireAdmin();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw badRequest('Category id is required.');
  const body = await parseBody(req, categorySchema.partial());

  const category = await prisma.category.update({ where: { id }, data: body });

  await auditNow({
    actorId: session.userId,
    actorRole: 'ADMIN',
    action: 'CATEGORY_UPDATED',
    entityType: 'Category',
    entityId: id,
    metadata: { fields: Object.keys(body) },
  });

  return ok({ category });
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'category'
  );
}
