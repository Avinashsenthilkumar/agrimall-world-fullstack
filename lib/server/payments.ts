// lib/server/payments.ts — §14. Server-verified payments.
//
// THE CONTRACT
//   - The amount charged is ALWAYS the amount this server computed and stored
//     on the Payment row. The client never supplies a figure.
//   - An order is only marked paid from a webhook whose SIGNATURE verified.
//     There is no endpoint anywhere that a browser can call to say
//     "payment succeeded".
//   - Webhooks are idempotent: the (provider, eventId) pair is unique, so a
//     replay is recorded and skipped.
//
// CREDENTIALS
//   The integration is complete. Only the keys are pending (§1399). With no
//   keys configured, `createProviderOrder` throws a clear 503 and the UI
//   offers Cash on Delivery instead of faking a success.

import { createHmac } from 'node:crypto';
import { env, onlinePaymentConfigured } from './env';
import { prisma } from './prisma';
import { serviceUnavailable, badRequest, forbidden } from './http';
import { safeEqual } from './session';
import type { PaymentProvider } from '@prisma/client';

export interface ProviderOrder {
  provider: PaymentProvider;
  /** The id the client-side checkout widget needs. */
  providerOrderId: string;
  /** Publishable key for the browser SDK. Safe to expose. */
  publicKey: string;
  amount: number; // paise
  currency: 'INR';
}

/**
 * Ask the provider to create a payment order for an amount WE decided.
 *
 * `amountPaise` must come from `Payment.amount`, which came from the server
 * quote. Passing a client figure here would defeat the whole design, so the
 * only caller reads it back from the database first.
 */
export async function createProviderOrder(args: {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  customerEmail: string;
}): Promise<ProviderOrder> {
  if (!onlinePaymentConfigured()) {
    throw serviceUnavailable(
      'Online payment is not configured on this deployment yet. Please choose Cash on Delivery, ' +
        'or set the payment provider keys in your environment.',
    );
  }

  if (!Number.isInteger(args.amountPaise) || args.amountPaise <= 0) {
    throw badRequest('Invalid payment amount.');
  }

  if (env.PAYMENT_PROVIDER === 'RAZORPAY') {
    return createRazorpayOrder(args);
  }
  if (env.PAYMENT_PROVIDER === 'STRIPE') {
    return createStripeIntent(args);
  }
  throw serviceUnavailable('No payment provider is configured.');
}

// ---------------------------------------------------------------------------
// Razorpay
// ---------------------------------------------------------------------------

async function createRazorpayOrder(args: {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
}): Promise<ProviderOrder> {
  const keyId = env.RAZORPAY_KEY_ID!;
  const keySecret = env.RAZORPAY_KEY_SECRET!;

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: args.amountPaise, // Razorpay works in paise natively
      currency: 'INR',
      receipt: args.orderNumber,
      notes: { orderId: args.orderId, orderNumber: args.orderNumber },
      payment_capture: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[razorpay] order creation failed', res.status, text);
    throw serviceUnavailable('We could not start the payment. Please try again.');
  }

  const body = (await res.json()) as { id: string; amount: number };

  // Record the provider's id so the webhook can be matched back to our order.
  await prisma.payment.updateMany({
    where: { orderId: args.orderId, status: 'PENDING' },
    data: { providerOrderId: body.id },
  });

  return {
    provider: 'RAZORPAY',
    providerOrderId: body.id,
    publicKey: keyId,
    amount: args.amountPaise,
    currency: 'INR',
  };
}

/**
 * Verify a Razorpay webhook signature.
 * `rawBody` MUST be the exact bytes received — re-serialising parsed JSON
 * changes key order/whitespace and the HMAC will not match.
 */
export function verifyRazorpayWebhook(rawBody: string, signatureHeader: string | null): boolean {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, signatureHeader);
}

/**
 * Verify the signature returned to the BROWSER by Razorpay Checkout.
 * This is a convenience confirmation for the redirect page only — the
 * authoritative state change still comes from the webhook.
 */
export function verifyRazorpayPaymentSignature(args: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac('sha256', secret)
    .update(`${args.razorpayOrderId}|${args.razorpayPaymentId}`)
    .digest('hex');
  return safeEqual(expected, args.signature);
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

async function createStripeIntent(args: {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  customerEmail: string;
}): Promise<ProviderOrder> {
  const secret = env.STRIPE_SECRET_KEY!;

  const form = new URLSearchParams({
    amount: String(args.amountPaise),
    currency: 'inr',
    'automatic_payment_methods[enabled]': 'true',
    'metadata[orderId]': args.orderId,
    'metadata[orderNumber]': args.orderNumber,
    receipt_email: args.customerEmail,
  });

  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Stripe-side idempotency: a retried create won't double-charge.
      'Idempotency-Key': `order_${args.orderId}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[stripe] payment intent failed', res.status, text);
    throw serviceUnavailable('We could not start the payment. Please try again.');
  }

  const body = (await res.json()) as { id: string; client_secret: string };

  await prisma.payment.updateMany({
    where: { orderId: args.orderId, status: 'PENDING' },
    data: { providerOrderId: body.id },
  });

  return {
    provider: 'STRIPE',
    providerOrderId: body.id,
    // For Stripe the browser needs the client secret, not a publishable key.
    publicKey: body.client_secret,
    amount: args.amountPaise,
    currency: 'INR',
  };
}

export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
): { valid: boolean; reason?: string } {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { valid: false, reason: 'no webhook secret configured' };
  if (!signatureHeader) return { valid: false, reason: 'missing signature header' };

  // Header form: t=1234567890,v1=abc...
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return { valid: false, reason: 'malformed signature header' };

  // Reject replays older than 5 minutes.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return { valid: false, reason: 'signature timestamp too old' };

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return safeEqual(expected, v1) ? { valid: true } : { valid: false, reason: 'signature mismatch' };
}

// ---------------------------------------------------------------------------
// Idempotent webhook bookkeeping (§32)
// ---------------------------------------------------------------------------

/**
 * Record a webhook delivery. Returns `{ duplicate: true }` when this exact
 * event has been seen before, which is the caller's signal to return 200 and
 * do nothing — the unique (provider, eventId) index is what makes a replayed
 * webhook incapable of creating a second order or depleting stock twice.
 */
export async function recordWebhookEvent(args: {
  provider: PaymentProvider;
  eventId: string;
  eventType: string;
  payload: unknown;
}): Promise<{ duplicate: boolean; id: string }> {
  try {
    const row = await prisma.webhookEvent.create({
      data: {
        provider: args.provider,
        eventId: args.eventId,
        eventType: args.eventType,
        payload: args.payload as object,
      },
    });
    return { duplicate: false, id: row.id };
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      const existing = await prisma.webhookEvent.findUnique({
        where: { provider_eventId: { provider: args.provider, eventId: args.eventId } },
      });
      return { duplicate: true, id: existing?.id ?? '' };
    }
    throw err;
  }
}

export async function markWebhookProcessed(id: string, error?: string): Promise<void> {
  if (!id) return;
  await prisma.webhookEvent
    .update({
      where: { id },
      data: { processedAt: new Date(), error: error?.slice(0, 1000) ?? null },
    })
    .catch(() => undefined);
}

/** Issue a refund with the provider. */
export async function refundWithProvider(args: {
  providerPaymentId: string;
  amountPaise: number;
  reason?: string;
}): Promise<{ providerRefundId: string }> {
  if (!onlinePaymentConfigured()) {
    throw serviceUnavailable(
      'Refunds require payment provider credentials. Configure them to process refunds automatically.',
    );
  }

  if (env.PAYMENT_PROVIDER === 'RAZORPAY') {
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(args.providerPaymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
          ).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: args.amountPaise, notes: { reason: args.reason ?? '' } }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[razorpay] refund failed', res.status, text);
      throw serviceUnavailable('The refund could not be processed with the payment provider.');
    }
    const body = (await res.json()) as { id: string };
    return { providerRefundId: body.id };
  }

  if (env.PAYMENT_PROVIDER === 'STRIPE') {
    const form = new URLSearchParams({
      payment_intent: args.providerPaymentId,
      amount: String(args.amountPaise),
    });
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[stripe] refund failed', res.status, text);
      throw serviceUnavailable('The refund could not be processed with the payment provider.');
    }
    const body = (await res.json()) as { id: string };
    return { providerRefundId: body.id };
  }

  throw serviceUnavailable('No payment provider is configured.');
}

/** Guard for /api/cron/* endpoints. */
export function assertCronSecret(req: Request): void {
  const expected = env.CRON_SECRET;
  if (!expected) throw forbidden('CRON_SECRET is not configured.');
  const provided = req.headers.get('x-cron-secret') ?? '';
  if (!safeEqual(expected, provided)) throw forbidden('Invalid cron secret.');
}
