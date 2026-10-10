// POST /api/payments/verify — the browser's return-from-gateway callback.
//
// IMPORTANT: this endpoint does NOT mark anything paid. It verifies the
// signature Razorpay handed the browser purely so the success page can show
// an accurate message, then reports the order's REAL state as recorded by the
// webhook. If the webhook hasn't landed yet, it honestly says "processing".
//
// This is the endpoint that in v1 would have been `paymentSuccess = true`.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseBody, notFound } from '../../../../lib/server/http';
import { requireCustomer } from '../../../../lib/server/auth';
import { verifyRazorpayPaymentSignature } from '../../../../lib/server/payments';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    orderId: z.string().min(1),
    razorpayOrderId: z.string().optional(),
    razorpayPaymentId: z.string().optional(),
    signature: z.string().optional(),
  })
  .strict();

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = await parseBody(req, schema);

  const order = await prisma.order.findFirst({
    where: { id: body.orderId, customerId: session.customerId },
    select: {
      id: true,
      orderNumber: true,
      paymentStatus: true,
      orderStatus: true,
      grandTotal: true,
      _count: { select: { sellerOrders: true } },
    },
  });
  if (!order) throw notFound('Order not found.');

  // Signature check is informational only — it tells us the browser's claim
  // is at least genuine, which lets us say "processing" rather than "failed".
  let clientSignatureValid: boolean | null = null;
  if (body.razorpayOrderId && body.razorpayPaymentId && body.signature) {
    clientSignatureValid = verifyRazorpayPaymentSignature({
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      signature: body.signature,
    });
  }

  const paid = order.paymentStatus === 'CAPTURED';

  return ok({
    orderId: order.id,
    orderNumber: order.orderNumber,
    // The authoritative state, from the webhook.
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    sellerOrderCount: order._count.sellerOrders,
    grandTotal: order.grandTotal,
    state: paid
      ? 'CONFIRMED'
      : clientSignatureValid
        ? 'PROCESSING'
        : order.paymentStatus === 'FAILED'
          ? 'FAILED'
          : 'PENDING',
    message: paid
      ? 'Your payment is confirmed and your order is on its way to the nurseries.'
      : clientSignatureValid
        ? 'Your payment went through and we are confirming it with the gateway. This page will update shortly.'
        : order.paymentStatus === 'FAILED'
          ? 'That payment did not go through. You can try again from your orders page.'
          : 'We have not received confirmation for this payment yet.',
  });
});
