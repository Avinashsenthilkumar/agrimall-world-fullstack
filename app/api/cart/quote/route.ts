// POST /api/cart/quote — a price preview, including coupon validation.
//
// Same engine as checkout, no order created. This is what the cart page calls
// when the customer types a coupon code, so the figure they see is the figure
// the server will charge.
import { handler, ok, parseBody } from '../../../../lib/server/http';
import { requireCustomer } from '../../../../lib/server/auth';
import { quoteSchema } from '../../../../lib/server/schemas';
import { resolveCart, explainCoupon } from '../../../../lib/server/pricing';
import { enforceRateLimit, LIMITS } from '../../../../lib/server/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = await parseBody(req, quoteSchema);

  if (body.couponCode) {
    enforceRateLimit(`coupon:${session.userId}`, LIMITS.coupon.limit, LIMITS.coupon.windowMs);
  }

  const { quote, coupon } = await resolveCart(body.items, {
    enforceStock: true,
    couponCode: body.couponCode,
    customerId: session.customerId,
  });

  // If a code was typed but didn't apply, say precisely why.
  let couponError: string | null = null;
  if (body.couponCode && !coupon) {
    const explained = await explainCoupon(body.couponCode, session.customerId);
    couponError = explained.reason ?? 'That coupon could not be applied.';
  } else if (body.couponCode && coupon && quote.discount === 0) {
    couponError = quote.notices[0] ?? 'That coupon does not apply to these items.';
  }

  return ok({
    totals: {
      subtotal: quote.subtotal,
      discount: quote.discount,
      tax: quote.tax,
      shippingFee: quote.shippingFee,
      grandTotal: quote.grandTotal,
    },
    perSeller: quote.perSeller.map((g) => ({
      sellerId: g.sellerId,
      subtotal: g.subtotal,
      discount: g.discount,
      tax: g.tax,
      shippingFee: g.shippingFee,
      total: g.grossAmount,
      itemCount: g.lines.reduce((a, l) => a + l.quantity, 0),
    })),
    couponApplied: quote.couponCode,
    couponError,
    notices: quote.notices,
  });
});
