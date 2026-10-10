// lib/shared/commission.ts
//
// §12 — the marketplace's revenue model.
//
// Commission is resolved with a strict precedence, PER LINE ITEM:
//
//     seller.commissionRate        (negotiated per-seller override)
//   → category.commissionRate      (category-level rate)
//   → platform default             (PlatformSetting `commission.defaultRate`)
//
// Per-item resolution matters: a seller order can contain a 5%-commission
// fruit sapling and a 15%-commission premium exotic. Charging one blended
// rate on the whole sub-order would be wrong for both.
//
// The commissionable base is the GOODS value only: (subtotal - discount).
// Platform commission is NOT charged on tax collected for the government, nor
// on the shipping fee that reimburses the courier.
//
// Zero dependencies — unit-testable in isolation.

import { allocate, assertPaise, percentOf, type Paise } from './money';

export const DEFAULT_COMMISSION_RATE = 10; // percent, used if no setting row exists

export interface CommissionRateSources {
  /** Seller-specific negotiated rate, e.g. 8 for 8%. */
  sellerRate?: number | null;
  /** Rate attached to the item's category. */
  categoryRate?: number | null;
  /** Platform-wide fallback. */
  platformRate: number;
}

/** Resolve the effective rate for one line item. */
export function resolveCommissionRate(src: CommissionRateSources): number {
  const candidates = [src.sellerRate, src.categoryRate, src.platformRate];
  for (const c of candidates) {
    if (c !== null && c !== undefined && Number.isFinite(c) && c >= 0) return c;
  }
  return DEFAULT_COMMISSION_RATE;
}

export interface CommissionableLine {
  /** Opaque id so callers can match results back to their own rows. */
  ref: string;
  /** (quantity * unitPrice) - discount, in paise. Tax/shipping excluded. */
  commissionableBase: Paise;
  rates: CommissionRateSources;
}

export interface LineCommission {
  ref: string;
  rate: number;
  commissionableBase: Paise;
  commissionAmount: Paise;
}

export interface SellerOrderCommission {
  /** Sum of each line's commissionable base. */
  commissionableBase: Paise;
  /** Sum of each line's commission, computed per line then added. */
  commissionAmount: Paise;
  /**
   * The blended rate this sub-order actually paid, as a percentage rounded to
   * 2dp. Stored on SellerOrder.commissionRate for display and audit; it is a
   * RESULT, never an input.
   */
  effectiveRate: number;
  lines: LineCommission[];
}

/**
 * Compute commission for one seller sub-order.
 *
 * Note `grossAmount` is what the customer actually paid toward this seller
 * (goods - discount + tax + shipping). The seller's earning is
 * `grossAmount - commissionAmount`, which preserves the DB invariant
 * `commissionAmount + sellerEarning = grossAmount`.
 */
export function computeSellerOrderCommission(lines: CommissionableLine[]): SellerOrderCommission {
  const perLine: LineCommission[] = lines.map((line) => {
    const base = assertPaise(line.commissionableBase, 'commissionableBase');
    const rate = resolveCommissionRate(line.rates);
    return {
      ref: line.ref,
      rate,
      commissionableBase: base,
      commissionAmount: percentOf(base, rate),
    };
  });

  const commissionableBase = perLine.reduce((a, l) => a + l.commissionableBase, 0);
  const commissionAmount = perLine.reduce((a, l) => a + l.commissionAmount, 0);
  const effectiveRate =
    commissionableBase === 0 ? 0 : Math.round((commissionAmount / commissionableBase) * 10_000) / 100;

  return { commissionableBase, commissionAmount, effectiveRate, lines: perLine };
}

export interface SettlementSplit {
  grossAmount: Paise;
  commissionAmount: Paise;
  sellerEarning: Paise;
}

/** The final money split written to SellerOrder / Commission / Payout. */
export function settle(grossAmount: Paise, commissionAmount: Paise): SettlementSplit {
  assertPaise(grossAmount, 'grossAmount');
  assertPaise(commissionAmount, 'commissionAmount');
  if (commissionAmount > grossAmount) {
    // Can only happen with a misconfigured >100% rate. Fail loudly rather
    // than writing a negative seller earning the DB would reject anyway.
    throw new Error(
      `commission (${commissionAmount}) exceeds gross (${grossAmount}) — check commission rate configuration`,
    );
  }
  return { grossAmount, commissionAmount, sellerEarning: grossAmount - commissionAmount };
}

/**
 * §18 — reverse commission proportionally when part of a sub-order is refunded.
 *
 * Refunding ₹500 of a ₹1,000 sub-order that paid ₹100 commission must claw
 * back ₹50 of platform revenue and ₹450 of seller earning. Rounding is done so
 * the two pieces always re-add to the refunded amount exactly.
 */
export function reverseCommission(args: {
  refundAmount: Paise;
  originalGross: Paise;
  originalCommission: Paise;
}): { commissionReversed: Paise; sellerDebit: Paise } {
  const { refundAmount, originalGross, originalCommission } = args;
  assertPaise(refundAmount, 'refundAmount');
  assertPaise(originalGross, 'originalGross');
  assertPaise(originalCommission, 'originalCommission');

  if (refundAmount <= 0) return { commissionReversed: 0, sellerDebit: 0 };
  if (originalGross <= 0) return { commissionReversed: 0, sellerDebit: refundAmount };
  if (refundAmount > originalGross) {
    throw new Error(`refund (${refundAmount}) exceeds sub-order gross (${originalGross})`);
  }

  const originalSeller = originalGross - originalCommission;
  // Split the refund between the two parties in their original proportion,
  // using exact integer allocation so nothing is lost.
  const [commissionReversed, sellerDebit] = allocate(refundAmount, [originalCommission, originalSeller]);
  return { commissionReversed, sellerDebit };
}
