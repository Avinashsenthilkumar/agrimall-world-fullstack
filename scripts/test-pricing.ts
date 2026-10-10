/**
 * Unit tests for the pure pricing / commission / status modules.
 *
 *   npx tsx scripts/test-pricing.ts
 *
 * These modules are deliberately dependency-free so this runs with no DB,
 * no server and no network.
 */
import { allocate, percentOf, rupeesToPaise, formatPaise, sumPaise } from '../lib/shared/money';
import {
  resolveCommissionRate,
  computeSellerOrderCommission,
  settle,
  reverseCommission,
} from '../lib/shared/commission';
import {
  quote,
  sellerOrderSuffix,
  ZERO_SHIPPING_POLICY,
  DEFAULT_SHIPPING_POLICY,
  type PricedLine,
  type ResolvedCoupon,
} from '../lib/shared/pricing';
import {
  canTransitionSellerOrder,
  deriveOrderStatus,
  nextSellerOrderStatus,
  type SellerOrderStatus,
} from '../lib/shared/order-status';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? '' : `got ${a}, expected ${e}`);
}

function throws(name: string, fn: () => unknown) {
  try {
    fn();
    check(name, false, 'expected a throw, got none');
  } catch {
    check(name, true);
  }
}

// ===========================================================================
console.log('\n── money ────────────────────────────────────────────────────');

eq('rupeesToPaise(1299)', rupeesToPaise(1299), 129_900);
eq('percentOf 10% of ₹9.99 rounds to whole paise', percentOf(999, 10), 100);
eq('percentOf 12.5% of ₹1000', percentOf(100_000, 12.5), 12_500);
eq('percentOf 0%', percentOf(100_000, 0), 0);
eq('formatPaise', formatPaise(129_900), '₹1,299');
eq('formatPaise uses Indian lakh grouping', formatPaise(1_00_00_000), '₹1,00,000');
eq('formatPaise with decimals', formatPaise(129_950, { decimals: true }), '₹1,299.50');

// Allocation must never lose or invent a paisa.
eq('allocate exact thirds', allocate(100, [1, 1, 1]), [34, 33, 33]);
eq('allocate sums to total', sumPaise(allocate(99_999, [7, 11, 13])), 99_999);
eq('allocate all-zero weights spreads evenly', allocate(10, [0, 0, 0]), [4, 3, 3]);
eq('allocate zero total', allocate(0, [5, 5]), [0, 0]);
{
  // Property check: 500 random splits must always re-sum exactly.
  let ok = true;
  for (let i = 0; i < 500; i++) {
    const total = Math.floor(Math.random() * 1_000_000);
    const w = Array.from({ length: 2 + Math.floor(Math.random() * 6) }, () =>
      Math.floor(Math.random() * 100_000),
    );
    const shares = allocate(total, w);
    if (shares.reduce((a, b) => a + b, 0) !== total) ok = false;
    if (shares.some((s) => s < 0)) ok = false;
  }
  check('allocate: 500 random cases all sum exactly and stay non-negative', ok);
}
throws('assertPaise rejects a float', () => percentOf(10.5, 10));

// ===========================================================================
console.log('\n── commission ───────────────────────────────────────────────');

eq(
  'rate precedence: seller wins',
  resolveCommissionRate({ sellerRate: 8, categoryRate: 12, platformRate: 10 }),
  8,
);
eq(
  'rate precedence: category when no seller rate',
  resolveCommissionRate({ sellerRate: null, categoryRate: 12, platformRate: 10 }),
  12,
);
eq(
  'rate precedence: platform fallback',
  resolveCommissionRate({ sellerRate: null, categoryRate: null, platformRate: 10 }),
  10,
);
eq(
  'rate precedence: 0% is a real rate, not "missing"',
  resolveCommissionRate({ sellerRate: 0, categoryRate: 12, platformRate: 10 }),
  0,
);

{
  // Spec §12 worked example: ₹10,000 at 10% → ₹1,000 platform / ₹9,000 seller.
  const c = computeSellerOrderCommission([
    { ref: 'a', commissionableBase: rupeesToPaise(10_000), rates: { platformRate: 10 } },
  ]);
  eq('§12 example: commission is ₹1,000', c.commissionAmount, rupeesToPaise(1_000));
  const s = settle(rupeesToPaise(10_000), c.commissionAmount);
  eq('§12 example: seller gets ₹9,000', s.sellerEarning, rupeesToPaise(9_000));
  check('§12 example: split re-adds to gross', s.commissionAmount + s.sellerEarning === s.grossAmount);
}

{
  // Mixed rates inside ONE seller order — per-line resolution.
  const c = computeSellerOrderCommission([
    { ref: 'cheap', commissionableBase: rupeesToPaise(1_000), rates: { categoryRate: 5, platformRate: 10 } },
    { ref: 'premium', commissionableBase: rupeesToPaise(1_000), rates: { categoryRate: 15, platformRate: 10 } },
  ]);
  eq('mixed rates: ₹50 + ₹150 commission', c.commissionAmount, rupeesToPaise(200));
  eq('mixed rates: blended effective rate is 10%', c.effectiveRate, 10);
}

throws('settle rejects commission > gross', () => settle(1000, 1001));

{
  // Refund half of a ₹1,000 sub-order that paid ₹100 commission.
  const r = reverseCommission({
    refundAmount: rupeesToPaise(500),
    originalGross: rupeesToPaise(1_000),
    originalCommission: rupeesToPaise(100),
  });
  eq('refund reverses ₹50 commission', r.commissionReversed, rupeesToPaise(50));
  eq('refund debits ₹450 from seller', r.sellerDebit, rupeesToPaise(450));
  check(
    'refund pieces re-add to the refund',
    r.commissionReversed + r.sellerDebit === rupeesToPaise(500),
  );
}
{
  const r = reverseCommission({ refundAmount: 999, originalGross: 999, originalCommission: 100 });
  check('full refund reverses everything exactly', r.commissionReversed + r.sellerDebit === 999);
}
throws('cannot refund more than the sub-order gross', () =>
  reverseCommission({ refundAmount: 2000, originalGross: 1000, originalCommission: 100 }),
);

// ===========================================================================
console.log('\n── pricing engine: THE §34 multi-vendor scenario ────────────');

function line(
  ref: string,
  sellerId: string,
  rupees: number,
  qty = 1,
  extra: Partial<PricedLine> = {},
): PricedLine {
  return {
    ref,
    productId: `prod-${ref}`,
    sellerId,
    categoryId: 'cat-indoor',
    unitPrice: rupeesToPaise(rupees),
    quantity: qty,
    taxRate: 0,
    commissionRates: { platformRate: 10 },
    snapshot: { productName: `Product ${ref}`, sku: `SKU-${ref}` },
    ...extra,
  };
}

{
  // Seller A: Product A = ₹1,000.  Seller B: Product B = ₹2,000.
  // Customer pays ₹3,000. Must become ONE order, TWO seller orders.
  const q = quote({
    lines: [line('A', 'seller-a', 1_000), line('B', 'seller-b', 2_000)],
    shippingPolicy: ZERO_SHIPPING_POLICY,
  });

  eq('grand total is exactly ₹3,000', q.grandTotal, rupeesToPaise(3_000));
  eq('two seller orders created', q.perSeller.length, 2);

  const a = q.perSeller.find((s) => s.sellerId === 'seller-a')!;
  const b = q.perSeller.find((s) => s.sellerId === 'seller-b')!;

  eq('seller A gross = ₹1,000', a.grossAmount, rupeesToPaise(1_000));
  eq('seller A commission @10% = ₹100', a.commissionAmount, rupeesToPaise(100));
  eq('seller A earning = ₹900', a.sellerEarning, rupeesToPaise(900));

  eq('seller B gross = ₹2,000', b.grossAmount, rupeesToPaise(2_000));
  eq('seller B commission @10% = ₹200', b.commissionAmount, rupeesToPaise(200));
  eq('seller B earning = ₹1,800', b.sellerEarning, rupeesToPaise(1_800));

  eq(
    'platform revenue = ₹300',
    a.commissionAmount + b.commissionAmount,
    rupeesToPaise(300),
  );
  check(
    'sub-order grosses sum to what the customer paid',
    a.grossAmount + b.grossAmount === q.grandTotal,
  );
  check(
    'every sub-order satisfies commission + earning = gross',
    q.perSeller.every((s) => s.commissionAmount + s.sellerEarning === s.grossAmount),
  );
}

console.log('\n── pricing engine: grouping, tax, shipping, coupons ─────────');

{
  // Spec §9 example: 2 items from seller A, 1 from seller B.
  const q = quote({
    lines: [
      line('1', 'seller-a', 1_000),
      line('2', 'seller-a', 500),
      line('3', 'seller-b', 2_000),
    ],
    shippingPolicy: ZERO_SHIPPING_POLICY,
  });
  const a = q.perSeller.find((s) => s.sellerId === 'seller-a')!;
  const b = q.perSeller.find((s) => s.sellerId === 'seller-b')!;
  eq('§9: seller A subtotal ₹1,500', a.subtotal, rupeesToPaise(1_500));
  eq('§9: seller A has 2 lines', a.lines.length, 2);
  eq('§9: seller B subtotal ₹2,000', b.subtotal, rupeesToPaise(2_000));
  eq('§9: total ₹3,500', q.grandTotal, rupeesToPaise(3_500));
}

{
  // Quantity is honoured, and is the ONLY thing the client influences.
  const q = quote({ lines: [line('x', 's1', 250, 4)], shippingPolicy: ZERO_SHIPPING_POLICY });
  eq('quantity 4 × ₹250 = ₹1,000', q.grandTotal, rupeesToPaise(1_000));
}

{
  // Shipping is per seller, and the free threshold is per sub-order.
  const q = quote({
    lines: [line('a', 'seller-a', 500), line('b', 'seller-b', 2_500)],
    shippingPolicy: DEFAULT_SHIPPING_POLICY,
  });
  const a = q.perSeller.find((s) => s.sellerId === 'seller-a')!;
  const b = q.perSeller.find((s) => s.sellerId === 'seller-b')!;
  eq('₹500 sub-order pays ₹149 shipping', a.shippingFee, rupeesToPaise(149));
  eq('₹2,500 sub-order ships free', b.shippingFee, 0);
  eq('total = 500 + 149 + 2500', q.grandTotal, rupeesToPaise(3_149));
  eq(
    'commission is charged on goods only, not shipping',
    a.commissionAmount,
    rupeesToPaise(50),
  );
}

{
  // Tax is applied after discount, per line.
  const q = quote({
    lines: [line('t', 's1', 1_000, 1, { taxRate: 18 })],
    shippingPolicy: ZERO_SHIPPING_POLICY,
  });
  eq('18% tax on ₹1,000', q.tax, rupeesToPaise(180));
  eq('total = ₹1,180', q.grandTotal, rupeesToPaise(1_180));
  eq('commission still on ₹1,000 goods', q.perSeller[0].commissionAmount, rupeesToPaise(100));
}

{
  // A PLATFORM coupon must be split across sellers pro-rata, exactly.
  const coupon: ResolvedCoupon = {
    id: 'c1',
    code: 'GREEN10',
    scope: 'PLATFORM',
    discountType: 'PERCENT',
    discountValue: 10,
    minOrderValue: 0,
  };
  const q = quote({
    lines: [line('a', 'seller-a', 1_000), line('b', 'seller-b', 2_000)],
    coupon,
    shippingPolicy: ZERO_SHIPPING_POLICY,
  });
  eq('10% off ₹3,000 = ₹300', q.discount, rupeesToPaise(300));
  eq('total after coupon = ₹2,700', q.grandTotal, rupeesToPaise(2_700));
  const a = q.perSeller.find((s) => s.sellerId === 'seller-a')!;
  const b = q.perSeller.find((s) => s.sellerId === 'seller-b')!;
  eq('seller A absorbs ₹100 of the discount', a.discount, rupeesToPaise(100));
  eq('seller B absorbs ₹200 of the discount', b.discount, rupeesToPaise(200));
  check(
    'per-seller discounts sum to the order discount',
    a.discount + b.discount === q.discount,
  );
  eq('commission recomputed on discounted goods', a.commissionAmount, rupeesToPaise(90));
}

{
  // Pro-rata split with an awkward amount — must still be exact.
  const coupon: ResolvedCoupon = {
    id: 'c2', code: 'ODD', scope: 'PLATFORM',
    discountType: 'FIXED', discountValue: 10_001, minOrderValue: 0,
  };
  const q = quote({
    lines: [line('a', 'seller-a', 333), line('b', 'seller-b', 777), line('c', 'seller-c', 111)],
    coupon,
    shippingPolicy: ZERO_SHIPPING_POLICY,
  });
  const summed = q.perSeller.reduce((acc, s) => acc + s.discount, 0);
  eq('awkward fixed discount splits with no lost paise', summed, 10_001);
  check(
    'all three sub-orders still satisfy the money identity',
    q.perSeller.every((s) => s.commissionAmount + s.sellerEarning === s.grossAmount),
  );
}

{
  // SELLER-scoped coupon must only touch that seller's lines.
  const coupon: ResolvedCoupon = {
    id: 'c3', code: 'ROOTS20', scope: 'SELLER', sellerId: 'seller-a',
    discountType: 'PERCENT', discountValue: 20, minOrderValue: 0,
  };
  const q = quote({
    lines: [line('a', 'seller-a', 1_000), line('b', 'seller-b', 2_000)],
    coupon,
    shippingPolicy: ZERO_SHIPPING_POLICY,
  });
  const a = q.perSeller.find((s) => s.sellerId === 'seller-a')!;
  const b = q.perSeller.find((s) => s.sellerId === 'seller-b')!;
  eq('seller coupon discounts only seller A', a.discount, rupeesToPaise(200));
  eq("seller B is untouched", b.discount, 0);
  eq('total = ₹2,800', q.grandTotal, rupeesToPaise(2_800));
}

{
  // Caps and minimums.
  const capped: ResolvedCoupon = {
    id: 'c4', code: 'CAP', scope: 'PLATFORM', discountType: 'PERCENT',
    discountValue: 50, maxDiscount: rupeesToPaise(100), minOrderValue: 0,
  };
  const q = quote({ lines: [line('a', 's1', 1_000)], coupon: capped, shippingPolicy: ZERO_SHIPPING_POLICY });
  eq('maxDiscount caps the discount at ₹100', q.discount, rupeesToPaise(100));

  const belowMin: ResolvedCoupon = {
    id: 'c5', code: 'MIN', scope: 'PLATFORM', discountType: 'FIXED',
    discountValue: rupeesToPaise(100), minOrderValue: rupeesToPaise(5_000),
  };
  const q2 = quote({ lines: [line('a', 's1', 1_000)], coupon: belowMin, shippingPolicy: ZERO_SHIPPING_POLICY });
  eq('coupon below minimum is not applied', q2.discount, 0);
  check('and the customer is told why', q2.notices.length > 0);

  const huge: ResolvedCoupon = {
    id: 'c6', code: 'HUGE', scope: 'PLATFORM', discountType: 'FIXED',
    discountValue: rupeesToPaise(999_999), minOrderValue: 0,
  };
  const q3 = quote({ lines: [line('a', 's1', 1_000)], coupon: huge, shippingPolicy: ZERO_SHIPPING_POLICY });
  eq('discount can never exceed the goods value', q3.discount, rupeesToPaise(1_000));
  check('and the total never goes negative', q3.grandTotal >= 0);
}

throws('empty cart cannot be quoted', () => quote({ lines: [] }));
throws('zero quantity is rejected', () =>
  quote({ lines: [line('a', 's1', 100, 0)] }),
);
throws('negative quantity is rejected', () =>
  quote({ lines: [line('a', 's1', 100, -2)] }),
);

eq('suffix 0 = A', sellerOrderSuffix(0), 'A');
eq('suffix 1 = B', sellerOrderSuffix(1), 'B');
eq('suffix 25 = Z', sellerOrderSuffix(25), 'Z');
eq('suffix 26 = AA', sellerOrderSuffix(26), 'AA');

// ===========================================================================
console.log('\n── status machine ───────────────────────────────────────────');

check('seller may accept a pending order', canTransitionSellerOrder('PENDING', 'ACCEPTED', 'SELLER').allowed);
check(
  'seller may NOT skip packing and jump to shipped',
  !canTransitionSellerOrder('PENDING', 'SHIPPED', 'SELLER').allowed,
);
check(
  'customer may NOT accept an order on the seller’s behalf',
  !canTransitionSellerOrder('PENDING', 'ACCEPTED', 'CUSTOMER').allowed,
);
check(
  'customer may cancel before handover',
  canTransitionSellerOrder('PENDING', 'CANCELLED', 'CUSTOMER').allowed,
);
check(
  'customer may NOT cancel after dispatch',
  !canTransitionSellerOrder('SHIPPED', 'CANCELLED', 'CUSTOMER').allowed,
);
check(
  'seller may NOT mark its own parcel delivered',
  !canTransitionSellerOrder('IN_TRANSIT', 'DELIVERED', 'SELLER').allowed,
);
check(
  'logistics may mark delivered',
  canTransitionSellerOrder('IN_TRANSIT', 'DELIVERED', 'LOGISTICS').allowed,
);
check('delivered is not re-deliverable', !canTransitionSellerOrder('DELIVERED', 'DELIVERED', 'ADMIN').allowed);
check('cancelled is terminal', !canTransitionSellerOrder('CANCELLED', 'ACCEPTED', 'ADMIN').allowed);
check('refunded is terminal', !canTransitionSellerOrder('REFUNDED', 'DELIVERED', 'ADMIN').allowed);
check(
  'only admin may finalise a refund',
  canTransitionSellerOrder('RETURNED', 'REFUNDED', 'ADMIN').allowed &&
    !canTransitionSellerOrder('RETURNED', 'REFUNDED', 'SELLER').allowed,
);
eq('next step after PACKING', nextSellerOrderStatus('PACKING'), 'READY_FOR_PICKUP');
eq('no next step after DELIVERED', nextSellerOrderStatus('DELIVERED'), null);

const captured = { captured: true };
function so(...s: SellerOrderStatus[]) {
  return s.map((status) => ({ status }));
}
eq('unpaid order is PENDING_PAYMENT', deriveOrderStatus(so('PENDING'), { captured: false }), 'PENDING_PAYMENT');
eq('failed payment', deriveOrderStatus(so('PENDING'), { captured: false, failed: true }), 'PAYMENT_FAILED');
eq('all pending = CONFIRMED', deriveOrderStatus(so('PENDING', 'PENDING'), captured), 'CONFIRMED');
eq('one accepted = PROCESSING', deriveOrderStatus(so('ACCEPTED', 'PENDING'), captured), 'PROCESSING');
eq(
  'one shipped, one packing = PARTIALLY_SHIPPED',
  deriveOrderStatus(so('SHIPPED', 'PACKING'), captured),
  'PARTIALLY_SHIPPED',
);
eq('both shipped = SHIPPED', deriveOrderStatus(so('SHIPPED', 'IN_TRANSIT'), captured), 'SHIPPED');
eq(
  'one delivered, one in transit = PARTIALLY_DELIVERED',
  deriveOrderStatus(so('DELIVERED', 'IN_TRANSIT'), captured),
  'PARTIALLY_DELIVERED',
);
eq('both delivered = DELIVERED', deriveOrderStatus(so('DELIVERED', 'DELIVERED'), captured), 'DELIVERED');
eq('all cancelled = CANCELLED', deriveOrderStatus(so('CANCELLED', 'CANCELLED'), captured), 'CANCELLED');
eq(
  'one cancelled, one live = PARTIALLY_CANCELLED',
  deriveOrderStatus(so('CANCELLED', 'ACCEPTED'), captured),
  'PARTIALLY_CANCELLED',
);
eq('all refunded = REFUNDED', deriveOrderStatus(so('REFUNDED', 'REFUNDED'), captured), 'REFUNDED');
eq(
  'one refunded = PARTIALLY_REFUNDED',
  deriveOrderStatus(so('REFUNDED', 'DELIVERED'), captured),
  'PARTIALLY_REFUNDED',
);
eq(
  'one cancelled + one delivered = PARTIALLY_CANCELLED',
  deriveOrderStatus(so('CANCELLED', 'DELIVERED'), captured),
  'PARTIALLY_CANCELLED',
);
eq(
  'a cancelled sub-order does not stop the others reaching DELIVERED together',
  deriveOrderStatus(so('CANCELLED', 'DELIVERED', 'DELIVERED'), captured),
  'PARTIALLY_CANCELLED',
);

// ===========================================================================
console.log(`\n${'─'.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  • ' + f));
  process.exit(1);
}
console.log('  All pure-logic tests passed.\n');
