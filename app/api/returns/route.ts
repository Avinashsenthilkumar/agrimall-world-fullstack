// GET  /api/returns — the customer's returns.
// POST /api/returns — raise one against a specific seller parcel (§18).
import { handler, ok, created, parseBody } from '../../../lib/server/http';
import { requireCustomer } from '../../../lib/server/auth';
import { returnRequestSchema } from '../../../lib/server/schemas';
import { createReturnRequest, listReturns } from '../../../lib/server/returns';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireCustomer();
  const returns = await listReturns({ customerId: session.customerId });
  return ok({ returns });
});

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = await parseBody(req, returnRequestSchema);

  const result = await createReturnRequest({
    customerId: session.customerId,
    customerUserId: session.userId,
    sellerOrderId: body.sellerOrderId,
    reason: body.reason,
    description: body.description,
    items: body.items,
    imageUrls: body.imageUrls,
  });

  return created({
    returnRequest: {
      id: result.id,
      returnNumber: result.returnNumber,
      status: result.status,
      refundAmount: result.refundAmount,
      items: result.items.length,
    },
    message:
      'Your return request has been sent to the seller. We will confirm the pickup once it is approved.',
  });
});
