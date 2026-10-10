// GET /api/returns/[id] — visible to the customer who raised it, the seller
// it concerns, or an admin. Ownership resolved by role in ownedReturn().
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok } from '../../../../lib/server/http';
import { requireUser, ownedReturn } from '../../../../lib/server/auth';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const session = await requireUser();
  await ownedReturn(session, params.id);

  const row = await prisma.returnRequest.findUnique({
    where: { id: params.id },
    include: {
      items: {
        include: {
          orderItem: {
            select: { productNameSnapshot: true, imageSnapshot: true, unitPrice: true, quantity: true },
          },
        },
      },
      sellerOrder: {
        select: {
          id: true,
          sellerOrderNumber: true,
          status: true,
          seller: { select: { businessName: true } },
          order: { select: { orderNumber: true } },
        },
      },
      refund: { select: { id: true, amount: true, status: true, processedAt: true } },
    },
  });

  return ok({ returnRequest: row });
});
