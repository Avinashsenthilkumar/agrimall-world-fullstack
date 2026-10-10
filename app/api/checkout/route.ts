// POST /api/checkout — §9, §10, §32. The multi-seller checkout.
//
// WHAT THE CLIENT SENDS: product ids, quantities, an address choice, a method.
// WHAT THE CLIENT CANNOT SEND: any price, total, sellerId, commission or
// payment status. The schema is `.strict()`, so attempting to is a 422.
//
// WHAT HAPPENS:
//   1. resolve the cart against the DB (prices, stock, seller approval)
//   2. create ONE Order and N SellerOrders in a single serializable txn
//   3. reserve stock
//   4. create the payment intent for the SERVER-computed amount
//   5. return what the browser needs to open the payment sheet
//
// The order is PENDING_PAYMENT until a signed webhook says otherwise.
import { prisma } from '../../../lib/server/prisma';
import { handler, created, parseBody, conflict, notFound } from '../../../lib/server/http';
import { requireCustomer } from '../../../lib/server/auth';
import { checkoutSchema } from '../../../lib/server/schemas';
import { createOrderFromQuote, toAddressSnapshot } from '../../../lib/server/orders';
import { createProviderOrder } from '../../../lib/server/payments';
import { releaseExpiredReservations } from '../../../lib/server/inventory';
import { enforceRateLimit, LIMITS } from '../../../lib/server/ratelimit';
import { onlinePaymentConfigured, env } from '../../../lib/server/env';
import { auditNow, clientIp } from '../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  enforceRateLimit(`checkout:${session.userId}`, LIMITS.checkout.limit, LIMITS.checkout.windowMs);

  const body = await parseBody(req, checkoutSchema);

  // Opportunistic cleanup: free stock held by carts that never paid, so a
  // shopper isn't blocked by someone else's abandoned checkout.
  await releaseExpiredReservations(50).catch(() => undefined);

  // --- Online payment must actually be configured (§1399) -----------------
  if (body.paymentMethod !== 'COD' && !onlinePaymentConfigured()) {
    throw conflict(
      'Online payment is not configured on this deployment. Please choose Cash on Delivery.',
    );
  }
  if (body.paymentMethod !== 'COD' && body.paymentMethod !== env.PAYMENT_PROVIDER) {
    throw conflict(`This store is configured for ${env.PAYMENT_PROVIDER} payments.`);
  }

  // --- Resolve the delivery address --------------------------------------
  let shipping;
  if (body.addressId) {
    const saved = await prisma.address.findFirst({
      where: { id: body.addressId, customerId: session.customerId },
    });
    if (!saved) throw notFound('That delivery address was not found on your account.');
    shipping = toAddressSnapshot(saved);
  } else if (body.shippingAddress) {
    shipping = toAddressSnapshot({ ...body.shippingAddress, country: body.shippingAddress.country });
  } else {
    throw conflict('Please choose a delivery address.');
  }

  const billing =
    body.billingSameAsShipping || !body.billingAddress
      ? shipping
      : toAddressSnapshot({ ...body.billingAddress, country: body.billingAddress.country });

  // --- Idempotency: a double-clicked Pay button must not make two orders --
  if (body.idempotencyKey) {
    const recent = await prisma.order.findFirst({
      where: {
        customerId: session.customerId,
        customerNote: body.customerNote ?? null,
        createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
        paymentStatus: 'PENDING',
        grandTotal: { gt: 0 },
      },
      orderBy: { createdAt: 'desc' },
      include: { payments: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    // Only reuse if the cart is identical, checked by item fingerprint.
    if (recent) {
      const existingItems = await prisma.orderItem.findMany({
        where: { sellerOrder: { orderId: recent.id } },
        select: { productId: true, variantId: true, quantity: true },
      });
      if (sameCart(existingItems, body.items)) {
        return created({
          reused: true,
          orderId: recent.id,
          orderNumber: recent.orderNumber,
          grandTotal: recent.grandTotal,
          paymentId: recent.payments[0]?.id ?? null,
        });
      }
    }
  }

  // --- The fan-out --------------------------------------------------------
  const result = await createOrderFromQuote({
    customerId: session.customerId,
    lines: body.items,
    shippingAddress: shipping,
    billingAddress: billing,
    couponCode: body.couponCode,
    customerNote: body.customerNote,
    paymentProvider: body.paymentMethod,
  });

  await auditNow({
    actorId: session.userId,
    actorRole: 'CUSTOMER',
    action: 'ORDER_CREATED',
    entityType: 'Order',
    entityId: result.orderId,
    metadata: {
      orderNumber: result.orderNumber,
      grandTotal: result.grandTotal,
      sellerOrderCount: result.sellerOrders.length,
      method: body.paymentMethod,
    },
    ip: clientIp(req),
  });

  // --- Cash on delivery: no gateway, but the same confirmation path -------
  if (body.paymentMethod === 'COD') {
    const { confirmOrderPaid } = await import('../../../lib/server/orders');
    // COD is "payment obligation accepted", recorded through the same
    // verified path so sellers, commissions and tracking all behave
    // identically to a card order.
    await confirmOrderPaid({
      orderId: result.orderId,
      providerPaymentId: `cod_${result.orderId}`,
      method: 'COD',
      amountPaise: result.grandTotal,
    });

    await clearCart(session.customerId);

    return created({
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      grandTotal: result.grandTotal,
      paymentMethod: 'COD',
      requiresPayment: false,
      sellerOrders: result.sellerOrders.map((s) => ({
        sellerOrderNumber: s.sellerOrderNumber,
        sellerId: s.sellerId,
      })),
    });
  }

  // --- Online: create the provider order for OUR amount -------------------
  // Read the amount back from the database rather than reusing the in-memory
  // value, so there is exactly one source of truth for what gets charged.
  const payment = await prisma.payment.findUnique({
    where: { id: result.paymentId },
    select: { amount: true },
  });
  if (!payment) throw notFound('Payment record missing.');

  const providerOrder = await createProviderOrder({
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    amountPaise: payment.amount,
    customerEmail: session.email,
  });

  return created({
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    grandTotal: payment.amount,
    requiresPayment: true,
    payment: {
      provider: providerOrder.provider,
      providerOrderId: providerOrder.providerOrderId,
      publicKey: providerOrder.publicKey,
      amount: providerOrder.amount,
      currency: providerOrder.currency,
    },
    sellerOrders: result.sellerOrders.map((s) => ({
      sellerOrderNumber: s.sellerOrderNumber,
      sellerId: s.sellerId,
    })),
  });
});

function sameCart(
  existing: Array<{ productId: string; variantId: string | null; quantity: number }>,
  requested: Array<{ productId: string; variantId?: string | null; quantity: number }>,
): boolean {
  const key = (p: string, v: string | null | undefined, q: number) => `${p}:${v ?? ''}:${q}`;
  const a = existing.map((i) => key(i.productId, i.variantId, i.quantity)).sort();
  const b = requested.map((i) => key(i.productId, i.variantId, i.quantity)).sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function clearCart(customerId: string) {
  const cart = await prisma.cart.findUnique({ where: { customerId } });
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}
