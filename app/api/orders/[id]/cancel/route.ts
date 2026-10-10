// POST /api/orders/[id]/cancel — customer cancels, before handover only (§15).
//
// Can cancel a single parcel or the whole order. Each cancellation restocks
// that seller's items and reverses that seller's commission.
import { prisma } from '../../../../../lib/server/prisma';
import { handler, ok, parseBody, conflict, notFound } from '../../../../../lib/server/http';
import { requireCustomer } from '../../../../../lib/server/auth';
import { cancelOrderSchema } from '../../../../../lib/server/schemas';
import { transitionSellerOrder } from '../../../../../lib/server/orders';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireCustomer();
  const body = await parseBody(req, cancelOrderSchema);

  const order = await prisma.order.findFirst({
    where: { id: params.id, customerId: session.customerId },
    include: { sellerOrders: { select: { id: true, status: true, sellerOrderNumber: true } } },
  });
  if (!order) throw notFound('Order not found.');

  const targets = body.sellerOrderId
    ? order.sellerOrders.filter((s) => s.id === body.sellerOrderId)
    : order.sellerOrders;

  if (targets.length === 0) throw notFound('That parcel is not part of this order.');

  // Only parcels still with the seller can be cancelled by the customer.
  const cancellable = targets.filter((s) => ['PENDING', 'ACCEPTED', 'PACKING'].includes(s.status));
  if (cancellable.length === 0) {
    throw conflict(
      'These items have already been dispatched. Please request a return once they arrive.',
    );
  }

  const results = [];
  for (const target of cancellable) {
    const r = await transitionSellerOrder({
      sellerOrderId: target.id,
      to: 'CANCELLED',
      actor: { userId: session.userId, role: 'CUSTOMER' },
      note: body.reason,
    });
    results.push({ sellerOrderNumber: target.sellerOrderNumber, ...r });
  }

  const skipped = targets.length - cancellable.length;

  return ok({
    cancelled: results,
    message:
      skipped > 0
        ? `${results.length} parcel(s) cancelled. ${skipped} had already shipped and can be returned after delivery.`
        : `${results.length} parcel(s) cancelled. Any payment will be refunded.`,
  });
});
