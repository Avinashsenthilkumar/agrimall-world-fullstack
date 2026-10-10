// POST /api/admin/products/[id]/moderate — approve or reject a listing (§7).
//
// Approval is what makes a product purchasable: the storefront query requires
// approvalStatus = APPROVED, so nothing is sellable until this runs.
import { prisma } from '../../../../../../lib/server/prisma';
import { handler, ok, parseBody, notFound, conflict } from '../../../../../../lib/server/http';
import { requireAdmin } from '../../../../../../lib/server/auth';
import { productModerationSchema } from '../../../../../../lib/server/schemas';
import { notify } from '../../../../../../lib/server/notifications';
import { audit } from '../../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireAdmin();
  const body = await parseBody(req, productModerationSchema);

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: params.id },
      include: {
        seller: { select: { userId: true, businessName: true, status: true } },
        inventory: { select: { onHand: true, reserved: true } },
      },
    });
    if (!product) throw notFound('Product not found.');

    if (body.decision === 'APPROVE') {
      if (product.seller.status !== 'APPROVED') {
        throw conflict('Approve the seller account before approving their listings.');
      }

      const available = product.inventory
        ? product.inventory.onHand - product.inventory.reserved
        : 0;

      await tx.product.update({
        where: { id: product.id },
        data: {
          approvalStatus: 'APPROVED',
          // Goes live immediately, unless there is nothing to sell.
          status: available > 0 ? 'ACTIVE' : 'OUT_OF_STOCK',
          approvedAt: new Date(),
          approvedById: session.userId,
          rejectionReason: null,
        },
      });

      await notify(tx, {
        userId: product.seller.userId,
        type: 'PRODUCT_APPROVED',
        title: `${product.name} is now live`,
        body:
          available > 0
            ? 'Your listing has been approved and is visible to customers.'
            : 'Your listing is approved but shows as out of stock — add stock to make it buyable.',
        linkUrl: `/seller/products/${product.id}`,
      });
    } else {
      await tx.product.update({
        where: { id: product.id },
        data: {
          approvalStatus: 'REJECTED',
          status: 'REJECTED',
          rejectionReason: body.reason ?? 'Did not meet listing guidelines',
          approvedAt: null,
        },
      });

      await notify(tx, {
        userId: product.seller.userId,
        type: 'PRODUCT_REJECTED',
        title: `${product.name} was not approved`,
        body: body.reason ?? undefined,
        linkUrl: `/seller/products/${product.id}`,
      });
    }

    await audit(tx, {
      actorId: session.userId,
      actorRole: 'ADMIN',
      action: `PRODUCT_${body.decision}`,
      entityType: 'Product',
      entityId: product.id,
      metadata: { reason: body.reason ?? null, sellerId: product.sellerId },
    });

    return { productId: product.id, name: product.name, decision: body.decision };
  });

  return ok({
    ...result,
    message:
      body.decision === 'APPROVE'
        ? `${result.name} is approved and live on the marketplace.`
        : `${result.name} was rejected and the seller has been told why.`,
  });
});
