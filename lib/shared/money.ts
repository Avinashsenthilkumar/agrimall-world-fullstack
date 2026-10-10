// lib/shared/money.ts
//
// All money in AgriMall is an INTEGER NUMBER OF PAISE. 1 INR = 100 paise.
// Floating point never touches a monetary value — not in the DB, not in the
// API, not in the pricing engine. Rupees exist only at the display edge.
//
// This module has zero dependencies so it can be unit-tested in isolation.

/** The smallest unit of currency we track. */
export type Paise = number;

export const PAISE_PER_RUPEE = 100;

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: Paise): number {
  return paise / PAISE_PER_RUPEE;
}

/** "₹1,299.00" — for UI and emails. */
export function formatPaise(paise: Paise, opts: { withSymbol?: boolean; decimals?: boolean } = {}): string {
  const { withSymbol = true, decimals = false } = opts;
  const rupees = paise / PAISE_PER_RUPEE;
  const body = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
  return withSymbol ? `₹${body}` : body;
}

export function assertPaise(value: unknown, label = 'amount'): Paise {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of paise, got ${String(value)}`);
  }
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is out of safe integer range`);
  return value;
}

/**
 * Apply a percentage to a paise amount, rounding half-up to the nearest paise.
 *
 * `percent` is a plain number such as 10 or 12.5 (NOT 0.1). We go through a
 * scaled integer path so that e.g. 10% of 999 is exactly 100, never 99.9999.
 */
export function percentOf(amount: Paise, percent: number): Paise {
  assertPaise(amount, 'amount');
  if (!Number.isFinite(percent) || percent < 0) throw new Error(`invalid percent: ${percent}`);
  // Scale percent to an integer of basis points (1% = 100bp) to avoid FP drift.
  const basisPoints = Math.round(percent * 100);
  return Math.round((amount * basisPoints) / 10_000);
}

/**
 * Split an integer `total` across `weights` so that:
 *   - each share is proportional to its weight,
 *   - every share is a non-negative integer,
 *   - the shares sum EXACTLY to `total` (no lost or invented paise).
 *
 * Uses the largest-remainder (Hare–Niemeyer) method. This is how an
 * order-level coupon is fairly spread over per-seller sub-orders: without it
 * you get a ₹0.01 discrepancy that breaks the
 * `commissionAmount + sellerEarning = grossAmount` invariant.
 */
export function allocate(total: Paise, weights: number[]): Paise[] {
  assertPaise(total, 'total');
  if (weights.some((w) => w < 0)) throw new Error('weights must be non-negative');
  const n = weights.length;
  if (n === 0) {
    if (total !== 0) throw new Error('cannot allocate a non-zero total across zero weights');
    return [];
  }

  const weightSum = weights.reduce((a, b) => a + b, 0);

  // Degenerate case: nothing to weight by. Spread as evenly as possible.
  if (weightSum === 0) {
    const base = Math.floor(total / n);
    const shares = new Array<number>(n).fill(base);
    let remainder = total - base * n;
    for (let i = 0; i < n && remainder > 0; i++, remainder--) shares[i] += 1;
    return shares;
  }

  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  // Hand out the leftover paise to the largest fractional parts first.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const shares = [...floors];
  for (let k = 0; remainder > 0; k = (k + 1) % n, remainder--) {
    shares[order[k].i] += 1;
  }
  return shares;
}

/** Sum with an integer guarantee. */
export function sumPaise(values: Paise[]): Paise {
  return values.reduce((acc, v) => acc + assertPaise(v), 0);
}

/** Clamp to >= 0; a discount must never make a total negative. */
export function clampNonNegative(value: Paise): Paise {
  return value < 0 ? 0 : value;
}
