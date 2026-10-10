// DELETE /api/wishlist/[productId]
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok } from '../../../../lib/server/http';
import { requireCustomer } from '../../../../lib/server/auth';

export const dynamic = 'force-dynamic';

export const DELETE = handler(async (_req: Request, { params }: { params: { productId: string } }) => {
  const session = await requireCustomer();
  await prisma.wishlistItem.deleteMany({
    where: { productId: params.productId, wishlist: { customerId: session.customerId } },
  });
  return ok({ removed: true });
});
