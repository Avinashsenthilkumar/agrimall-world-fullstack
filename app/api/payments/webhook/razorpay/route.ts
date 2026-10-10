// POST /api/payments/webhook/razorpay — §14, §32.
//
// This is the ONLY way a Razorpay order becomes paid.
//
//   raw body → HMAC-SHA256 signature check → record event (unique) →
//   → confirm order → commit stock → notify sellers
//
// Properties:
//   - Unsigned or wrongly-signed requests are rejected with 401 and nothing
//     is written. A browser cannot forge this.
//   - The event id is unique in webhook_events, so a redelivery is a no-op.
//   - The amount is compared against the stored order total; a mismatch fails
//     the payment rather than confirming the order.
//   - Always returns 200 once the signature is valid, even on an internal
//     error, so the provider stops retrying a poison event; the failure is
//     recorded on the WebhookEvent row for an operator to inspect.
import { NextResponse } from 'next/server';
import {
  verifyRazorpayWebhook,
  recordWebhookEvent,
  markWebhookProcessed,
} from '../../../../../lib/server/payments';
import { confirmOrderPaid, failOrderPayment } from '../../../../../lib/server/orders';
import { prisma } from '../../../../../lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // MUST read the raw text: re-serialising parsed JSON breaks the HMAC.
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature');

  if (!verifyRazorpayWebhook(rawBody, signature)) {
    console.warn('[webhook:razorpay] signature verification failed');
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const eventType = payload.event ?? 'unknown';
  const entity = payload.payload?.payment?.entity;
  // Razorpay doesn't send a top-level event id; the payment id plus the event
  // name uniquely identifies a delivery.
  const eventId = `${entity?.id ?? 'noid'}:${eventType}`;

  const recorded = await recordWebhookEvent({
    provider: 'RAZORPAY',
    eventId,
    eventType,
    payload,
  });

  // Replay: acknowledge and do nothing.
  if (recorded.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    if (!entity) {
      await markWebhookProcessed(recorded.id, 'no payment entity in payload');
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Map the provider's order id back to ours.
    const payment = await prisma.payment.findFirst({
      where: { providerOrderId: entity.order_id },
      select: { orderId: true },
    });
    if (!payment) {
      await markWebhookProcessed(recorded.id, `no local payment for razorpay order ${entity.order_id}`);
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const result = await confirmOrderPaid({
        orderId: payment.orderId,
        providerPaymentId: entity.id,
        providerOrderId: entity.order_id,
        providerSignature: signature,
        method: entity.method ?? null,
        amountPaise: entity.amount, // verified against our total inside
        rawPayload: payload,
      });
      await markWebhookProcessed(recorded.id);
      return NextResponse.json({ ok: true, alreadyProcessed: result.alreadyProcessed });
    }

    if (eventType === 'payment.failed') {
      await failOrderPayment({
        orderId: payment.orderId,
        reason: entity.error_description ?? 'Payment failed at the gateway.',
        providerPaymentId: entity.id,
      });
      await markWebhookProcessed(recorded.id);
      return NextResponse.json({ ok: true });
    }

    await markWebhookProcessed(recorded.id, `unhandled event ${eventType}`);
    return NextResponse.json({ ok: true, ignored: true });
  } catch (err) {
    console.error('[webhook:razorpay] processing failed', err);
    await markWebhookProcessed(recorded.id, String((err as Error).message));
    // 200 so Razorpay stops retrying; the row records what went wrong.
    return NextResponse.json({ ok: false, recorded: true }, { status: 200 });
  }
}

interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id: string;
        amount: number;
        method?: string;
        error_description?: string;
      };
    };
  };
}
