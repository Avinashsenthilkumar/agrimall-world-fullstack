// POST /api/seller/orders/[id]/transition — §15. The fulfilment button.
//
// The server decides whether the move is legal, for this role, from this
// status. There is no way to set a status directly.
import { handler, ok, parseBody, forbidden } from '../../../../../../lib/server/http';
import { requireApprovedSeller, ownedSellerOrder } from '../../../../../../lib/server/auth';
import { sellerOrderTransitionSchema } from '../../../../../../lib/server/schemas';
import { transitionSellerOrder } from '../../../../../../lib/server/orders';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireApprovedSeller();
  await ownedSellerOrder(session, params.id);

  const body = await parseBody(req, sellerOrderTransitionSchema);

  // A seller cannot sign for their own delivery, nor finalise a refund.
  // The state machine enforces this too; rejecting early gives a clearer
  // message than a generic transition error.
  if (body.to === 'DELIVERED' || body.to === 'REFUNDED') {
    throw forbidden(
      body.to === 'DELIVERED'
        ? 'Delivery is confirmed by the courier, not the seller.'
        : 'Refunds are finalised by the Agri Mall team.',
    );
  }

  const result = await transitionSellerOrder({
    sellerOrderId: params.id,
    to: body.to,
    actor: { userId: session.userId, role: 'SELLER' },
    note: body.note,
    location: body.location,
    shipment:
      body.to === 'SHIPPED'
        ? {
            courier: body.courier,
            trackingNumber: body.trackingNumber,
            estimatedDelivery: body.estimatedDelivery,
          }
        : undefined,
  });

  return ok({
    ...result,
    message: `Order moved to ${result.to.toLowerCase().replace(/_/g, ' ')}. The customer's tracking has been updated.`,
  });
});
