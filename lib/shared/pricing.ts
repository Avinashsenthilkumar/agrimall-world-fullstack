// lib/shared/pricing.ts
//
// §9, §10, §12 — THE pricing engine.
//
// This is the single place where an order's money is decided. The client sends
// only { productId, variantId, quantity }. Everything below — price, discount,
// tax, shipping, commission, totals — is derived here from database state.
//
// The engine is PURE: it takes a snapshot of catalog rows and returns a quote.
// It performs no I/O, so it is fully unit-testable and cannot be influenced by
// request data that wasn't explicitly resolved from the DB first.
//
//   cart lines (ids + qty)
//        │
//        ▼  resolve against DB  (caller does this, see lib/server/pricing.ts)
//   PricedInput
//        │
//        ▼  quote()
//   Quote { perSeller[], grandTotal }   ← the ONLY amount allowed to be charged

import {
  allocate,
  assertPaise,
  clampNonNegative,
  percentOf,
  type Paise,
} from './money';
import {
  computeSellerOrderCommission,
  settle,
  type CommissionableLine,
  type CommissionRateSources,
} from './commission';

// ---------------------------------------------------------------------------
// Shipping policy
// ---------------------------------------------------------------------------
// Shipping is charged PER SELLER, because each seller ships its own parcel
// from its own nursery (§16). A ₹1,500 order from two sellers is two parcels.

export interface ShippingPolicy {
  /** Flat fee per seller sub-order, in paise. */
  flatFeePerSeller: Paise;
  /** A sub-order at or above this goods value ships free. */
  freeAboveSubtotal: Paise;
}

export const DEFAULT_SHIPPING_POLICY: ShippingPolicy = {
  flatFeePerSeller: 14_900, // ₹149
  freeAboveSubtotal: 200_000, // ₹2,000
};

/** Shipping/tax-free policy — used by tests that assert exact spec figures. */
export const ZERO_SHIPPING_POLICY: ShippingPolicy = {
  flatFeePerSeller: 0,
  freeAboveSubtotal: 0,
};

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export type CouponScope = 'PLATFORM' | 'SELLER' | 'CATEGORY' | 'PRODUCT';
export type DiscountType = 'PERCENT' | 'FIXED';

export interface ResolvedCoupon {
  id: string;
  code: string;
  scope: CouponScope;
  discountType: DiscountType;
  /** percent (1-100) for PERCENT, paise for FIXED */
  discountValue: number;
  maxDiscount?: Paise | null;
  minOrderValue: Paise;
  sellerId?: string | null;
  categoryId?: string | null;
  productId?: string | null;
}

// ---------------------------------------------------------------------------
// Engine input — every field here must come from the database
// ---------------------------------------------------------------------------

export interface PricedLine {
  /** Caller's reference (cart item id) so results can be matched back. */
  ref: string;
  productId: string;
  variantId?: string | null;
  sellerId: string;
  categoryId: string;

  /** Authoritative unit price read from the DB, in paise. */
  unitPrice: Paise;
  quantity: number;

  /** Tax percentage for this line (product override, else category). */
  taxRate: number;

  /** Commission inputs for this line. */
  commissionRates: CommissionRateSources;

  /** Snapshot fields copied into order_items at checkout (§8). */
  snapshot: {
    productName: string;
    sku: string;
    imageUrl?: string | null;
    variantLabel?: string | null;
  };
}

export interface QuoteInput {
  lines: PricedLine[];
  coupon?: ResolvedCoupon | null;
  shippingPolicy?: ShippingPolicy;
}

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

export interface QuoteLine extends PricedLine {
  /** quantity * unitPrice */
  lineSubtotal: Paise;
  /** this line's share of the coupon discount */
  lineDiscount: Paise;
  /** tax on (lineSubtotal - lineDiscount) */
  lineTax: Paise;
  /** lineSubtotal - lineDiscount + lineTax */
  lineTotal: Paise;
}

export interface QuoteSellerGroup {
  sellerId: string;
  lines: QuoteLine[];

  subtotal: Paise;
  discount: Paise;
  tax: Paise;
  shippingFee: Paise;
  /** What the customer pays toward this seller. */
  grossAmount: Paise;

  commissionRate: number;
  commissionAmount: Paise;
  sellerEarning: Paise;
}

export interface Quote {
  perSeller: QuoteSellerGroup[];

  subtotal: Paise;
  discount: Paise;
  tax: Paise;
  shippingFee: Paise;
  /** The one and only amount that may be sent to the payment provider. */
  grandTotal: Paise;

  couponCode: string | null;
  /** Non-fatal notes, e.g. "coupon not applied: order below minimum". */
  notices: string[];
}

// ---------------------------------------------------------------------------
// Coupon eligibility
// ---------------------------------------------------------------------------

/** Which lines a coupon is allowed to discount. */
function eligibleLines(lines: PricedLine[], coupon: ResolvedCoupon): PricedLine[] {
  switch (coupon.scope) {
    case 'PLATFORM':
      return lines;
    case 'SELLER':
      return lines.filter((l) => l.sellerId === coupon.sellerId);
    case 'CATEGORY':
      return lines.filter((l) => l.categoryId === coupon.categoryId);
    case 'PRODUCT':
      return lines.filter((l) => l.productId === coupon.productId);
    default:
      return [];
  }
}

function lineSubtotalOf(l: PricedLine): Paise {
  return assertPaise(l.unitPrice, 'unitPrice') * l.quantity;
}

/**
 * Compute the total coupon discount, capped and validated.
 * Returns 0 with a notice when the coupon cannot apply.
 */
export function computeCouponDiscount(
  lines: PricedLine[],
  coupon: ResolvedCoupon | null | undefined,
  notices: string[],
): { discount: Paise; eligibleRefs: Set<string> } {
  if (!coupon) return { discount: 0, eligibleRefs: new Set() };

  const scoped = eligibleLines(lines, coupon);
  if (scoped.length === 0) {
    notices.push(`Coupon ${coupon.code} does not apply to any item in this cart.`);
    return { discount: 0, eligibleRefs: new Set() };
  }

  const eligibleSubtotal = scoped.reduce((a, l) => a + lineSubtotalOf(l), 0);

  // minOrderValue is checked against the FULL cart goods value, which is how
  // shoppers expect "minimum order ₹999" to behave.
  const cartSubtotal = lines.reduce((a, l) => a + lineSubtotalOf(l), 0);
  if (cartSubtotal < coupon.minOrderValue) {
    notices.push(`Coupon ${coupon.code} needs a minimum order of ${coupon.minOrderValue} paise.`);
    return { discount: 0, eligibleRefs: new Set() };
  }

  let discount: Paise;
  if (coupon.discountType === 'PERCENT') {
    if (coupon.discountValue <= 0 || coupon.discountValue > 100) {
      notices.push(`Coupon ${coupon.code} is misconfigured and was ignored.`);
      return { discount: 0, eligibleRefs: new Set() };
    }
    discount = percentOf(eligibleSubtotal, coupon.discountValue);
  } else {
    discount = assertPaise(coupon.discountValue, 'discountValue');
  }

  if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  // Never discount more than the goods it applies to.
  discount = Math.min(discount, eligibleSubtotal);
  discount = clampNonNegative(discount);

  return { discount, eligibleRefs: new Set(scoped.map((l) => l.ref)) };
}

// ---------------------------------------------------------------------------
// The quote
// ---------------------------------------------------------------------------

export function quote(input: QuoteInput): Quote {
  const policy = input.shippingPolicy ?? DEFAULT_SHIPPING_POLICY;
  const notices: string[] = [];

  if (input.lines.length === 0) throw new Error('cannot quote an empty cart');
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw new Error(`invalid quantity for ${l.productId}: ${l.quantity}`);
    }
    assertPaise(l.unitPrice, `unitPrice for ${l.productId}`);
  }

  // --- 1. Coupon discount, then spread across the lines it applies to -----
  const { discount: totalDiscount, eligibleRefs } = computeCouponDiscount(
    input.lines,
    input.coupon,
    notices,
  );

  const discountWeights = input.lines.map((l) => (eligibleRefs.has(l.ref) ? lineSubtotalOf(l) : 0));
  const lineDiscounts = allocate(totalDiscount, discountWeights);

  // --- 2. Per-line money -------------------------------------------------
  const quoteLines: QuoteLine[] = input.lines.map((l, i) => {
    const lineSubtotal = lineSubtotalOf(l);
    const lineDiscount = lineDiscounts[i];
    const taxableBase = clampNonNegative(lineSubtotal - lineDiscount);
    const lineTax = percentOf(taxableBase, l.taxRate);
    return {
      ...l,
      lineSubtotal,
      lineDiscount,
      lineTax,
      lineTotal: taxableBase + lineTax,
    };
  });

  // --- 3. Group by seller — this is the §8 fan-out ------------------------
  const bySeller = new Map<string, QuoteLine[]>();
  for (const l of quoteLines) {
    const bucket = bySeller.get(l.sellerId);
    if (bucket) bucket.push(l);
    else bySeller.set(l.sellerId, [l]);
  }

  const perSeller: QuoteSellerGroup[] = [];
  for (const [sellerId, lines] of bySeller) {
    const subtotal = lines.reduce((a, l) => a + l.lineSubtotal, 0);
    const discount = lines.reduce((a, l) => a + l.lineDiscount, 0);
    const tax = lines.reduce((a, l) => a + l.lineTax, 0);

    const goodsValue = clampNonNegative(subtotal - discount);
    const shippingFee = goodsValue >= policy.freeAboveSubtotal ? 0 : policy.flatFeePerSeller;

    const grossAmount = goodsValue + tax + shippingFee;

    // Commission on the goods value only, resolved per line.
    const commissionLines: CommissionableLine[] = lines.map((l) => ({
      ref: l.ref,
      commissionableBase: clampNonNegative(l.lineSubtotal - l.lineDiscount),
      rates: l.commissionRates,
    }));
    const commission = computeSellerOrderCommission(commissionLines);
    const split = settle(grossAmount, commission.commissionAmount);

    perSeller.push({
      sellerId,
      lines,
      subtotal,
      discount,
      tax,
      shippingFee,
      grossAmount: split.grossAmount,
      commissionRate: commission.effectiveRate,
      commissionAmount: split.commissionAmount,
      sellerEarning: split.sellerEarning,
    });
  }

  // Stable ordering so seller-order suffixes (A, B, C…) are deterministic.
  perSeller.sort((a, b) => (a.sellerId < b.sellerId ? -1 : a.sellerId > b.sellerId ? 1 : 0));

  // --- 4. Order totals = exact sum of the sub-orders ----------------------
  const subtotal = perSeller.reduce((a, s) => a + s.subtotal, 0);
  const discount = perSeller.reduce((a, s) => a + s.discount, 0);
  const tax = perSeller.reduce((a, s) => a + s.tax, 0);
  const shippingFee = perSeller.reduce((a, s) => a + s.shippingFee, 0);
  const grandTotal = perSeller.reduce((a, s) => a + s.grossAmount, 0);

  // Belt-and-braces: the invariant the DB also enforces.
  const recomputed = clampNonNegative(subtotal - discount) + tax + shippingFee;
  if (recomputed !== grandTotal) {
    throw new Error(`quote integrity check failed: ${recomputed} != ${grandTotal}`);
  }

  return {
    perSeller,
    subtotal,
    discount,
    tax,
    shippingFee,
    grandTotal,
    couponCode: totalDiscount > 0 && input.coupon ? input.coupon.code : null,
    notices,
  };
}

/**
 * Seller order numbers: AGM-1001-A, AGM-1001-B, … in the same deterministic
 * order the quote produced. Beyond 26 sellers it rolls into AA, AB, …
 */
export function sellerOrderSuffix(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
