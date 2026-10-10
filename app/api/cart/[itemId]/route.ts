// PATCH  /api/cart/[itemId] — change quantity (0 removes).
// DELETE /api/cart/[itemId] — remove a line.
//
// Ownership: the where-clause scopes by the signed-in customer's cart, so one
// customer cannot modify another's cart item even with a valid item id.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseBody, notFound, conflict } from '../../../../lib/server/http';
import { requireCustomer } from '../../../../lib/server/auth';
import { cartUpdateSchema } from '../../../../lib/server/schemas';
import { getAvailability } from '../../../../lib/server/inventory';

export const dynamic = 'force-dynamic';

export const PATCH = handler(async (req: Request, { params }: { params: { itemId: string } }) => {
  const session = await requireCustomer();
  const body = await parseBody(req, cartUpdateSchema);

  const item = await prisma.cartItem.findFirst({
    where: { id: params.itemId, cart: { customerId: session.customerId } },
    include: { product: { select: { name: true } } },
  });
  if (!item) throw notFound('That item is not in your cart.');

  if (body.quantity === 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
    return ok({ removed: true });
  }

  const availability = await getAvailability(item.productId, item.variantId);
  if (body.quantity > availability.available) {
    throw conflict(
      availability.available === 0
        ? `${item.product.name} is out of stock.`
        : `Only ${availability.available} of ${item.product.name} available.`,
    );
  }

  const updated = await prisma.cartItem.update({
    where: { id: item.id },
    data: { quantity: body.quantity },
  });
  return ok({ item: { id: updated.id, quantity: updated.quantity } });
});

export const DELETE = handler(async (_req: Request, { params }: { params: { itemId: string } }) => {
  const session = await requireCustomer();
  const deleted = await prisma.cartItem.deleteMany({
    where: { id: params.itemId, cart: { customerId: session.customerId } },
  });
  if (deleted.count === 0) throw notFound('That item is not in your cart.');
  return ok({ removed: true });
});
