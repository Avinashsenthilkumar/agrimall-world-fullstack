// GET /api/seller/payouts — §13. Payout history, read-only for the seller.
//
// A seller can see their payouts but cannot change a payout status: that
// requires provider confirmation through an admin route.
import { handler, ok, parseQuery } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';
import { listSellerPayouts, getSellerEarnings } from '../../../../lib/server/payouts';
import { paginationSchema } from '../../../../lib/server/schemas';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const session = await requireSeller();
  const { page, perPage } = parseQuery(req, paginationSchema);

  const [payouts, summary] = await Promise.all([
    listSellerPayouts(session.sellerId, { take: perPage, skip: (page - 1) * perPage }),
    getSellerEarnings(session.sellerId),
  ]);

  return ok({
    summary,
    payouts: payouts.map((p) => ({
      id: p.id,
      sellerOrderNumber: p.sellerOrder.sellerOrderNumber,
      customerOrderNumber: p.sellerOrder.order.orderNumber,
      deliveredAt: p.sellerOrder.deliveredAt,
      gross: p.grossAmount,
      commission: p.commissionAmount,
      refundAdjustment: p.refundAdjustment,
      net: p.netAmount,
      status: p.status,
      reference: p.providerReference,
      failureReason: p.failureReason,
      eligibleAt: p.eligibleAt,
      processedAt: p.processedAt,
      createdAt: p.createdAt,
    })),
    note:
      'Payouts are released after the return window closes on each delivered parcel, and marked paid only once the payment provider confirms the transfer.',
  });
});
