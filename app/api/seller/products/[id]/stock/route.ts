// PATCH /api/seller/products/[id]/stock — §11. Inventory edit, audited.
//
// Refuses to set stock below the quantity already reserved by customers who
// are mid-checkout, which is what stops a seller accidentally overselling.
import { prisma, serializableTransaction } from '../../../../../../lib/server/prisma';
import { handler, ok, parseBody } from '../../../../../../lib/server/http';
import { requireApprovedSeller, ownedProduct } from '../../../../../../lib/server/auth';
import { stockUpdateSchema } from '../../../../../../lib/server/schemas';
import { setStock } from '../../../../../../lib/server/inventory';

export const dynamic = 'force-dynamic';

export const PATCH = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireApprovedSeller();
  await ownedProduct(session, params.id);
  const body = await parseBody(req, stockUpdateSchema);

  const result = await serializableTransaction((tx) =>
    setStock(tx, {
      productId: params.id,
      variantId: body.variantId,
      onHand: body.onHand,
      actorId: session.userId,
      note: body.note,
    }),
  );

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    select: { status: true, name: true },
  });

  return ok({
    stock: result,
    productStatus: product?.status,
    message:
      result.available === 0
        ? `${product?.name} is now marked out of stock.`
        : 'Stock updated.',
  });
});
