// POST /api/payments/webhook/stripe — the Stripe equivalent. Same guarantees.
import { NextResponse } from 'next/server';
import {
  verifyStripeWebhook,
  recordWebhookEvent,
  markWebhookProcessed,
} from '../../../../../lib/server/payments';
import { confirmOrderPaid, failOrderPayment } from '../../../../../lib/server/orders';
import { prisma } from '../../../../../lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');

  const verified = verifyStripeWebhook(rawBody, signature);
  if (!verified.valid) {
    console.warn('[webhook:stripe] signature verification failed:', verified.reason);
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const recorded = await recordWebhookEvent({
    provider: 'STRIPE',
    eventId: event.id,
    eventType: event.type,
    payload: event,
  });
  if (recorded.duplicate) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const intent = event.data?.object;
    if (!intent?.id) {
      await markWebhookProcessed(recorded.id, 'no payment intent in payload');
      return NextResponse.json({ ok: true, ignored: true });
    }

    const payment = await prisma.payment.findFirst({
      where: { providerOrderId: intent.id },
      select: { orderId: true },
    });
    const orderId = payment?.orderId ?? intent.metadata?.orderId;
    if (!orderId) {
      await markWebhookProcessed(recorded.id, `no local order for intent ${intent.id}`);
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (event.type === 'payment_intent.succeeded') {
      const result = await confirmOrderPaid({
        orderId,
        providerPaymentId: intent.id,
        providerOrderId: intent.id,
        providerSignature: signature,
        method: intent.payment_method_types?.[0] ?? null,
        amountPaise: intent.amount_received ?? intent.amount ?? 0,
        rawPayload: event,
      });
      await markWebhookProcessed(recorded.id);
      return NextResponse.json({ ok: true, alreadyProcessed: result.alreadyProcessed });
    }

    if (event.type === 'payment_intent.payment_failed') {
      await failOrderPayment({
        orderId,
        reason: intent.last_payment_error?.message ?? 'Payment failed at the gateway.',
        providerPaymentId: intent.id,
      });
      await markWebhookProcessed(recorded.id);
      return NextResponse.json({ ok: true });
    }

    await markWebhookProcessed(recorded.id, `unhandled event ${event.type}`);
    return NextResponse.json({ ok: true, ignored: true });
  } catch (err) {
    console.error('[webhook:stripe] processing failed', err);
    await markWebhookProcessed(recorded.id, String((err as Error).message));
    return NextResponse.json({ ok: false, recorded: true }, { status: 200 });
  }
}

interface StripeEvent {
  id: string;
  type: string;
  data?: {
    object?: {
      id: string;
      amount?: number;
      amount_received?: number;
      payment_method_types?: string[];
      metadata?: { orderId?: string };
      last_payment_error?: { message?: string };
    };
  };
}
