// GET /api/seller/inventory — §5 "Inventory": stock plus movement history.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseQuery } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';
import { paginationSchema } from '../../../../lib/server/schemas';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const session = await requireSeller();
  const { page, perPage } = parseQuery(req, paginationSchema);
  const lowOnly = new URL(req.url).searchParams.get('low') === 'true';

  const products = await prisma.product.findMany({
    where: { sellerId: session.sellerId },
    orderBy: { name: 'asc' },
    skip: (page - 1) * perPage,
    take: perPage,
    select: {
      id: true,
      name: true,
      sku: true,
      status: true,
      price: true,
      images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
      inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true, updatedAt: true } },
    },
  });

  const rows = products
    .map((p) => {
      const onHand = p.inventory?.onHand ?? 0;
      const reserved = p.inventory?.reserved ?? 0;
      const threshold = p.inventory?.lowStockThreshold ?? 10;
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        status: p.status,
        price: p.price,
        imageUrl: p.images[0]?.url ?? null,
        onHand,
        reserved,
        available: onHand - reserved,
        lowStockThreshold: threshold,
        isLow: onHand - reserved <= threshold,
        updatedAt: p.inventory?.updatedAt ?? null,
      };
    })
    .filter((r) => (lowOnly ? r.isLow : true));

  const movements = await prisma.inventoryMovement.findMany({
    where: { sellerId: session.sellerId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { product: { select: { name: true } } },
  });

  return ok({
    inventory: rows,
    movements: movements.map((m) => ({
      id: m.id,
      productName: m.product.name,
      reason: m.reason,
      delta: m.delta,
      reservedDelta: m.reservedDelta,
      onHandAfter: m.onHandAfter,
      reservedAfter: m.reservedAfter,
      refType: m.refType,
      refId: m.refId,
      note: m.note,
      createdAt: m.createdAt,
    })),
  });
});
