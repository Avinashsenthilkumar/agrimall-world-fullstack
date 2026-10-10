// POST /api/payments/create — re-open the payment sheet for an unpaid order.
//
// Used when the customer closed the gateway and wants to retry. It never
// accepts an amount: the figure comes from the stored Payment row.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, conflict, notFound, parseBody } from '../../../../lib/server/http';
import { requireCustomer } from '../../../../lib/server/auth';
import { createProviderOrder } from '../../../../lib/server/payments';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ orderId: z.string().min(1) }).strict();

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = await parseBody(req, schema);

  const order = await prisma.order.findFirst({
    where: { id: body.orderId, customerId: session.customerId },
    include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!order) throw notFound('Order not found.');
  if (order.paymentStatus === 'CAPTURED') throw conflict('That order is already paid.');
  if (order.orderStatus === 'CANCELLED') throw conflict('That order was cancelled.');

  // The reservation may have lapsed while they were away.
  if (order.reservationExpiresAt && order.reservationExpiresAt.getTime() < Date.now()) {
    throw conflict('This order expired because payment was not completed. Please checkout again.');
  }

  const payment = order.payments[0];
  if (!payment) throw notFound('No payment record for this order.');

  const providerOrder = await createProviderOrder({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountPaise: payment.amount, // from the DB, never from the request
    customerEmail: session.email,
  });

  return ok({
    payment: {
      provider: providerOrder.provider,
      providerOrderId: providerOrder.providerOrderId,
      publicKey: providerOrder.publicKey,
      amount: providerOrder.amount,
      currency: providerOrder.currency,
    },
  });
});
