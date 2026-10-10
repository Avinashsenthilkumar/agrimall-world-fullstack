// GET / PATCH / DELETE /api/seller/products/[id]
//
// Every handler goes through ownedProduct(), which scopes the lookup by the
// session's sellerId. Seller B's product id returns 404 for Seller A — not
// 403, so ids can't be probed.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok, parseBody, conflict } from '../../../../../lib/server/http';
import { requireSeller, ownedProduct } from '../../../../../lib/server/auth';
import { productUpdateSchema } from '../../../../../lib/server/schemas';
import { auditNow } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSeller();
  await ownedProduct(session, params.id);

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      variants: { include: { inventory: true } },
      category: { select: { id: true, name: true, slug: true } },
      inventory: true,
      movements: { orderBy: { createdAt: 'desc' }, take: 20 },
      _count: { select: { orderItems: true, reviews: true } },
    },
  });

  return ok({ product });
});

export const PATCH = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSeller();
  const existing = await ownedProduct(session, params.id);
  const body = await parseBody(req, productUpdateSchema);

  // A price or substance change on an approved listing sends it back for
  // re-approval, so a seller cannot get a cheap item approved then swap in
  // something else (§7 moderation).
  const materialChange =
    (body.price != null && body.price !== existing.price) ||
    (body.name != null && body.name !== existing.name) ||
    (body.categoryId != null && body.categoryId !== existing.categoryId);

  const needsReapproval = materialChange && existing.approvalStatus === 'APPROVED';

  const { imageUrls, ...fields } = body;

  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.product.update({
      where: { id: params.id },
      data: {
        ...fields,
        ...(needsReapproval
          ? { approvalStatus: 'PENDING', status: 'PENDING_APPROVAL', approvedAt: null }
          : {}),
      },
    });

    if (imageUrls) {
      await tx.productImage.deleteMany({ where: { productId: p.id } });
      if (imageUrls.length > 0) {
        await tx.productImage.createMany({
          data: imageUrls.map((url, i) => ({
            productId: p.id,
            url,
            alt: p.name,
            sortOrder: i,
            isPrimary: i === 0,
          })),
        });
      }
    }
    return p;
  });

  await auditNow({
    actorId: session.userId,
    actorRole: 'SELLER',
    action: 'PRODUCT_UPDATED',
    entityType: 'Product',
    entityId: product.id,
    metadata: { needsReapproval, changed: Object.keys(fields) },
  });

  return ok({
    product: {
      id: product.id,
      name: product.name,
      price: product.price,
      status: product.status,
      approvalStatus: product.approvalStatus,
    },
    message: needsReapproval
      ? 'Saved. Because the price or details changed, the listing needs re-approval before it goes live again.'
      : 'Listing updated.',
  });
});

export const DELETE = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSeller();
  const product = await ownedProduct(session, params.id);

  // Never hard-delete something that appears in an order: order_items
  // reference it, and the sales history must stay intact (§8).
  const soldCount = await prisma.orderItem.count({ where: { productId: product.id } });

  if (soldCount > 0) {
    await prisma.product.update({
      where: { id: product.id },
      data: { status: 'INACTIVE' },
    });
    return ok({
      archived: true,
      message:
        'This plant has order history, so it has been delisted rather than deleted. Your past orders and invoices are unchanged.',
    });
  }

  await prisma.product.delete({ where: { id: product.id } });
  return ok({ deleted: true, message: 'Listing deleted.' });
});
