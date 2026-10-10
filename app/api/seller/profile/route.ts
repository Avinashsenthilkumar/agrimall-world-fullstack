// GET   /api/seller/profile — the seller's own record (KYC status, not numbers).
// PATCH /api/seller/profile — edit business details.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseBody } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';
import { sellerProfileUpdateSchema } from '../../../../lib/server/schemas';
import { sellerSelfView } from '../../../../lib/server/sellers';
import { auditNow } from '../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireSeller();
  const seller = await sellerSelfView(session.sellerId);
  return ok({
    seller: {
      ...seller,
      commissionRate: seller.commissionRate != null ? Number(seller.commissionRate) : null,
      ratingAvg: Number(seller.ratingAvg),
    },
  });
});

export const PATCH = handler(async (req: Request) => {
  const session = await requireSeller();
  const body = await parseBody(req, sellerProfileUpdateSchema);

  await prisma.seller.update({ where: { id: session.sellerId }, data: body });

  await auditNow({
    actorId: session.userId,
    actorRole: 'SELLER',
    action: 'SELLER_PROFILE_UPDATED',
    entityType: 'Seller',
    entityId: session.sellerId,
    metadata: { fields: Object.keys(body) },
  });

  const seller = await sellerSelfView(session.sellerId);
  return ok({ seller, message: 'Store details updated.' });
});
