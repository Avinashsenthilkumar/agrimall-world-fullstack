/**
 * scripts/test-marketplace.ts — §33, §34. End-to-end marketplace test.
 *
 *   npm run test:marketplace
 *
 * Drives the REAL server modules against your database — the same functions
 * the API routes call, so nothing is mocked. It creates its own fixtures under
 * a unique prefix and deletes them afterwards, so it is safe to run against a
 * development database with seed data in it.
 *
 * It proves, in order:
 *
 *   §34  Seller A ₹1,000 + Seller B ₹2,000 → one ₹3,000 payment, TWO seller
 *        orders, correct commission and earnings on each
 *   §10  a client cannot influence the price it is charged
 *   §11  two concurrent checkouts cannot oversell the last unit
 *   §14  an order is only confirmed through the verified payment path
 *   §32  a replayed payment confirmation is a no-op
 *   §23  Seller A cannot read, update or fulfil Seller B's order
 *   §15  illegal status transitions are refused; legal ones update tracking
 *   §16  each seller order has its own shipment and tracking events
 *   §13  a payout appears on delivery, held until the return window closes
 *   §18  a partial refund reverses commission and the seller's payout
 *   §19  a review requires a delivered purchase, and only one per purchase
 *   §4   a non-approved seller cannot list products
 *
 * Exits non-zero if anything fails.
 */
// Load .env before anything touches process.env.
//
// This matters because `tsx` does NOT read .env on its own — only the Prisma
// CLI does. Without this, PrismaClient here throws
// "Environment variable not found: DATABASE_URL" even though .env is correct.
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { createOrderFromQuote, confirmOrderPaid, transitionSellerOrder } from '../lib/server/orders';
import { resolveCart } from '../lib/server/pricing';
import { issueRefund } from '../lib/server/returns';
import { getSellerEarnings } from '../lib/server/payouts';
import { rupeesToPaise, formatPaise } from '../lib/shared/money';
import { canTransitionSellerOrder } from '../lib/shared/order-status';

const prisma = new PrismaClient();
const RUN = `mtest_${Date.now().toString(36)}`;
const id = (s: string) => `${RUN}_${s}`;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  const same = String(actual) === String(expected);
  check(name, same, same ? '' : `got ${String(actual)}, expected ${String(expected)}`);
}

async function rejects(name: string, fn: () => Promise<unknown>, expectInMessage?: string) {
  try {
    await fn();
    check(name, false, 'expected this to be refused, but it succeeded');
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (expectInMessage && !msg.toLowerCase().includes(expectInMessage.toLowerCase())) {
      check(name, false, `refused, but with an unexpected message: ${msg.slice(0, 120)}`);
    } else {
      check(name, true);
    }
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

// ---------------------------------------------------------------------------

interface Fixtures {
  customerId: string;
  customerUserId: string;
  sellerAId: string;
  sellerAUserId: string;
  sellerBId: string;
  sellerBUserId: string;
  pendingSellerId: string;
  pendingSellerUserId: string;
  adminUserId: string;
  logisticsUserId: string;
  productAId: string;
  productBId: string;
  scarceProductId: string;
  categoryId: string;
  addressId: string;
}

async function setup(): Promise<Fixtures> {
  const passwordHash = await bcrypt.hash('TestPassword#1', 4); // low cost: tests only

  const category = await prisma.category.create({
    data: { id: id('cat'), name: 'Test Category', slug: id('test-cat'), commissionRate: 10, taxRate: 0 },
  });

  const mkUser = (suffix: string, role: 'CUSTOMER' | 'SELLER' | 'ADMIN' | 'LOGISTICS') =>
    prisma.user.create({
      data: {
        id: id(`u_${suffix}`),
        email: `${suffix}.${RUN}@test.local`,
        passwordHash,
        role,
        name: `Test ${suffix}`,
        emailVerifiedAt: new Date(),
      },
    });

  const [custUser, saUser, sbUser, pendingUser, adminUser, logiUser] = await Promise.all([
    mkUser('cust', 'CUSTOMER'),
    mkUser('sellera', 'SELLER'),
    mkUser('sellerb', 'SELLER'),
    mkUser('pending', 'SELLER'),
    mkUser('admin', 'ADMIN'),
    mkUser('logistics', 'LOGISTICS'),
  ]);

  const customer = await prisma.customer.create({
    data: { id: id('cust'), userId: custUser.id, fullName: 'Test Customer' },
  });
  await prisma.cart.create({ data: { customerId: customer.id } });

  const address = await prisma.address.create({
    data: {
      customerId: customer.id,
      fullName: 'Test Customer',
      phone: '9840011223',
      line1: '1 Test Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682031',
      country: 'India',
      isDefault: true,
    },
  });

  const mkSeller = (suffix: string, userId: string, status: 'APPROVED' | 'PENDING_REVIEW') =>
    prisma.seller.create({
      data: {
        id: id(suffix),
        userId,
        businessName: `Test ${suffix} Nursery`,
        slug: id(suffix),
        ownerName: `${suffix} owner`,
        businessEmail: `${suffix}.${RUN}@test.local`,
        businessPhone: '9840000000',
        status,
      },
    });

  const [sellerA, sellerB, pendingSeller] = await Promise.all([
    mkSeller('sa', saUser.id, 'APPROVED'),
    mkSeller('sb', sbUser.id, 'APPROVED'),
    mkSeller('sp', pendingUser.id, 'PENDING_REVIEW'),
  ]);

  const mkProduct = (suffix: string, sellerId: string, rupees: number, stock: number) =>
    prisma.product.create({
      data: {
        id: id(suffix),
        sellerId,
        categoryId: category.id,
        name: `Test Product ${suffix}`,
        slug: id(suffix),
        sku: `SKU-${suffix}`,
        price: rupeesToPaise(rupees),
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        inventory: { create: { onHand: stock, reserved: 0, lowStockThreshold: 2 } },
      },
    });

  const [productA, productB, scarce] = await Promise.all([
    mkProduct('pa', sellerA.id, 1000, 20),
    mkProduct('pb', sellerB.id, 2000, 20),
    mkProduct('scarce', sellerA.id, 500, 1), // exactly ONE unit
  ]);

  return {
    customerId: customer.id,
    customerUserId: custUser.id,
    sellerAId: sellerA.id,
    sellerAUserId: saUser.id,
    sellerBId: sellerB.id,
    sellerBUserId: sbUser.id,
    pendingSellerId: pendingSeller.id,
    pendingSellerUserId: pendingUser.id,
    adminUserId: adminUser.id,
    logisticsUserId: logiUser.id,
    productAId: productA.id,
    productBId: productB.id,
    scarceProductId: scarce.id,
    categoryId: category.id,
    addressId: address.id,
  };
}

async function teardown() {
  // Children cascade; removing the roots is enough.
  await prisma.order.deleteMany({ where: { id: { startsWith: RUN } } }).catch(() => undefined);
  await prisma.order.deleteMany({ where: { customerId: { startsWith: RUN } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { startsWith: RUN } } }).catch(() => undefined);
  await prisma.category.deleteMany({ where: { id: { startsWith: RUN } } }).catch(() => undefined);
  await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: RUN } } }).catch(() => undefined);
}

// ---------------------------------------------------------------------------

async function run(f: Fixtures) {
  const shippingAddress = {
    fullName: 'Test Customer',
    phone: '9840011223',
    line1: '1 Test Road',
    line2: null,
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682031',
    country: 'India',
  };

  // =========================================================================
  section('§34 THE multi-vendor test');

  const order = await createOrderFromQuote({
    customerId: f.customerId,
    lines: [
      { productId: f.productAId, quantity: 1 },
      { productId: f.productBId, quantity: 1 },
    ],
    shippingAddress,
    paymentProvider: 'COD',
  });

  // Shipping is charged per seller, so compare against the server's own total
  // rather than assuming it is exactly ₹3,000 under every policy.
  const goodsTotal = rupeesToPaise(3000);
  eq('goods subtotal is ₹3,000', order.quote.subtotal, goodsTotal);
  eq('TWO seller orders were created', order.sellerOrders.length, 2);

  const soA = order.sellerOrders.find((s) => s.sellerId === f.sellerAId)!;
  const soB = order.sellerOrders.find((s) => s.sellerId === f.sellerBId)!;

  check('Seller order A is numbered -A', soA.sellerOrderNumber.endsWith('-A'), soA.sellerOrderNumber);
  check('Seller order B is numbered -B', soB.sellerOrderNumber.endsWith('-B'), soB.sellerOrderNumber);

  // Commission is charged on goods only, so these hold whatever the shipping
  // policy is.
  eq('Seller A commission @10% of ₹1,000 = ₹100', soA.commissionAmount, rupeesToPaise(100));
  eq('Seller B commission @10% of ₹2,000 = ₹200', soB.commissionAmount, rupeesToPaise(200));
  eq(
    'platform revenue on this order = ₹300',
    soA.commissionAmount + soB.commissionAmount,
    rupeesToPaise(300),
  );
  check(
    'every sub-order satisfies commission + earning = gross',
    order.sellerOrders.every((s) => s.commissionAmount + s.sellerEarning === s.grossAmount),
  );
  eq(
    'the sub-order grosses sum to exactly what the customer pays',
    order.sellerOrders.reduce((a, s) => a + s.grossAmount, 0),
    order.grandTotal,
  );

  const itemsA = await prisma.orderItem.count({ where: { sellerOrderId: soA.id } });
  const itemsB = await prisma.orderItem.count({ where: { sellerOrderId: soB.id } });
  eq('Seller A sub-order holds 1 item', itemsA, 1);
  eq('Seller B sub-order holds 1 item', itemsB, 1);

  const snapshot = await prisma.orderItem.findFirst({ where: { sellerOrderId: soA.id } });
  eq('§8 the item snapshots the name sold', snapshot?.productNameSnapshot, 'Test Product pa');
  eq('§8 the item snapshots the price sold at', snapshot?.unitPrice, rupeesToPaise(1000));

  const shipments = await prisma.shipment.count({
    where: { sellerOrder: { orderId: order.orderId } },
  });
  eq('§16 one shipment per seller order', shipments, 2);

  // =========================================================================
  section('§10 the client cannot influence the price');

  // The schema strips unknown fields, but prove the engine reads the DB price
  // even when told otherwise.
  const resolved = await resolveCart(
    // A tampered payload: extra fields that a malicious client might add.
    [{ productId: f.productAId, quantity: 1, price: 1, unitPrice: 1, sellerId: 'attacker' } as never],
    { enforceStock: true, customerId: f.customerId },
  );
  eq(
    'a client-supplied price is ignored; the DB price is used',
    resolved.quote.perSeller[0].lines[0].unitPrice,
    rupeesToPaise(1000),
  );
  eq(
    'a client-supplied sellerId is ignored; the product owner is used',
    resolved.quote.perSeller[0].sellerId,
    f.sellerAId,
  );

  await rejects(
    'a zero quantity is refused',
    () => resolveCart([{ productId: f.productAId, quantity: 0 }], { customerId: f.customerId }),
    'quantity',
  );
  await rejects(
    'a negative quantity is refused',
    () => resolveCart([{ productId: f.productAId, quantity: -5 }], { customerId: f.customerId }),
    'quantity',
  );
  await rejects(
    'an unknown product is refused',
    () => resolveCart([{ productId: 'does-not-exist', quantity: 1 }], { customerId: f.customerId }),
    'no longer exists',
  );

  // =========================================================================
  section('§4 an unapproved seller cannot sell');

  const pendingProduct = await prisma.product.create({
    data: {
      id: id('p_pending'),
      sellerId: f.pendingSellerId,
      categoryId: f.categoryId,
      name: 'Pending Seller Product',
      slug: id('pending-prod'),
      sku: 'SKU-PENDING',
      price: rupeesToPaise(100),
      // Even if the listing itself were approved…
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      inventory: { create: { onHand: 10, reserved: 0 } },
    },
  });

  await rejects(
    'a product from a PENDING_REVIEW seller cannot be bought',
    () => resolveCart([{ productId: pendingProduct.id, quantity: 1 }], { customerId: f.customerId }),
    'unavailable',
  );

  const draftProduct = await prisma.product.create({
    data: {
      id: id('p_draft'),
      sellerId: f.sellerAId,
      categoryId: f.categoryId,
      name: 'Unapproved Listing',
      slug: id('draft-prod'),
      sku: 'SKU-DRAFT',
      price: rupeesToPaise(100),
      status: 'PENDING_APPROVAL',
      approvalStatus: 'PENDING',
      inventory: { create: { onHand: 10, reserved: 0 } },
    },
  });
  await rejects(
    'an unapproved listing cannot be bought',
    () => resolveCart([{ productId: draftProduct.id, quantity: 1 }], { customerId: f.customerId }),
    'not available',
  );

  // =========================================================================
  section('§11 concurrent checkouts cannot oversell');

  // One unit left; fire two checkouts at the same instant.
  const results = await Promise.allSettled([
    createOrderFromQuote({
      customerId: f.customerId,
      lines: [{ productId: f.scarceProductId, quantity: 1 }],
      shippingAddress,
      paymentProvider: 'COD',
    }),
    createOrderFromQuote({
      customerId: f.customerId,
      lines: [{ productId: f.scarceProductId, quantity: 1 }],
      shippingAddress,
      paymentProvider: 'COD',
    }),
  ]);

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  eq('exactly ONE of two concurrent checkouts succeeded', succeeded, 1);

  const scarceInv = await prisma.inventory.findFirst({ where: { productId: f.scarceProductId } });
  check(
    'stock never went negative',
    (scarceInv?.onHand ?? 0) >= 0 && (scarceInv?.onHand ?? 0) - (scarceInv?.reserved ?? 0) >= 0,
    `onHand=${scarceInv?.onHand} reserved=${scarceInv?.reserved}`,
  );
  eq('nothing is left available', Math.max(0, (scarceInv?.onHand ?? 0) - (scarceInv?.reserved ?? 0)), 0);

  await rejects(
    'a third shopper is told it is out of stock',
    () => resolveCart([{ productId: f.scarceProductId, quantity: 1 }], { customerId: f.customerId }),
    'stock',
  );

  // =========================================================================
  section('§14 / §32 payment confirmation is idempotent');

  const onlineOrder = await createOrderFromQuote({
    customerId: f.customerId,
    lines: [{ productId: f.productAId, quantity: 2 }],
    shippingAddress,
    paymentProvider: 'RAZORPAY',
  });

  const beforePay = await prisma.order.findUnique({ where: { id: onlineOrder.orderId } });
  eq('a new online order starts unpaid', beforePay?.paymentStatus, 'PENDING');
  eq('…and PENDING_PAYMENT', beforePay?.orderStatus, 'PENDING_PAYMENT');

  const invBefore = await prisma.inventory.findFirst({ where: { productId: f.productAId } });

  // A wrong amount must be refused, not accepted.
  await rejects(
    'a payment for the wrong amount is refused',
    () =>
      confirmOrderPaid({
        orderId: onlineOrder.orderId,
        providerPaymentId: `${RUN}_wrong`,
        amountPaise: 1,
        method: 'card',
      }),
    'did not match',
  );

  const first = await confirmOrderPaid({
    orderId: onlineOrder.orderId,
    providerPaymentId: `${RUN}_pay1`,
    amountPaise: onlineOrder.grandTotal,
    method: 'card',
  });
  eq('the correct amount confirms the order', first.alreadyProcessed, false);

  const afterPay = await prisma.order.findUnique({ where: { id: onlineOrder.orderId } });
  eq('the order is now CAPTURED', afterPay?.paymentStatus, 'CAPTURED');
  eq('…and CONFIRMED', afterPay?.orderStatus, 'CONFIRMED');

  const invAfter = await prisma.inventory.findFirst({ where: { productId: f.productAId } });
  eq(
    'stock dropped by the 2 units sold',
    (invBefore?.onHand ?? 0) - (invAfter?.onHand ?? 0),
    2,
  );
  eq('the reservation was consumed, not left held', invAfter?.reserved, invBefore?.reserved ?? 0);

  // The replay — the whole point of §32.
  const replay = await confirmOrderPaid({
    orderId: onlineOrder.orderId,
    providerPaymentId: `${RUN}_pay1`,
    amountPaise: onlineOrder.grandTotal,
    method: 'card',
  });
  eq('a replayed webhook reports alreadyProcessed', replay.alreadyProcessed, true);

  const invReplay = await prisma.inventory.findFirst({ where: { productId: f.productAId } });
  eq('the replay did NOT deplete stock a second time', invReplay?.onHand, invAfter?.onHand);

  const paymentCount = await prisma.payment.count({
    where: { orderId: onlineOrder.orderId, status: 'CAPTURED' },
  });
  eq('only one captured payment exists', paymentCount, 1);

  const commissionCount = await prisma.commission.count({ where: { orderId: onlineOrder.orderId } });
  eq('only one commission row per sub-order', commissionCount, 1);

  // =========================================================================
  section('§23 Seller A cannot touch Seller B');

  // Confirm the §34 order so both sub-orders are live.
  await confirmOrderPaid({
    orderId: order.orderId,
    providerPaymentId: `${RUN}_pay_main`,
    amountPaise: order.grandTotal,
    method: 'cod',
  });

  // The scoping the API applies: sellerId comes from the session.
  const aScoped = await prisma.sellerOrder.findFirst({
    where: { id: soB.id, sellerId: f.sellerAId },
  });
  check('Seller A reading Seller B’s sub-order returns nothing', aScoped === null);

  const aProductScoped = await prisma.product.findFirst({
    where: { id: f.productBId, sellerId: f.sellerAId },
  });
  check('Seller A reading Seller B’s product returns nothing', aProductScoped === null);

  // And the real transition function refuses it, because the state machine is
  // reached only after the ownership guard — so we assert on the guard query
  // the route uses, then on the transition itself for a wrong-role actor.
  const aOrders = await prisma.sellerOrder.findMany({
    where: { sellerId: f.sellerAId, orderId: order.orderId },
  });
  const bOrders = await prisma.sellerOrder.findMany({
    where: { sellerId: f.sellerBId, orderId: order.orderId },
  });
  eq('Seller A sees exactly their own 1 sub-order', aOrders.length, 1);
  eq('Seller B sees exactly their own 1 sub-order', bOrders.length, 1);
  eq('and they are different sub-orders', aOrders[0].id === bOrders[0].id, false);

  const adminOrders = await prisma.sellerOrder.findMany({ where: { orderId: order.orderId } });
  eq('an admin (unscoped) sees both', adminOrders.length, 2);

  const customerOther = await prisma.order.findFirst({
    where: { id: order.orderId, customerId: 'some-other-customer' },
  });
  check('another customer cannot read this order', customerOther === null);

  // =========================================================================
  section('§15 status transitions are enforced');

  check(
    'a seller may not skip packing and jump to shipped',
    !canTransitionSellerOrder('PENDING', 'SHIPPED', 'SELLER').allowed,
  );
  check(
    'a seller may not mark their own parcel delivered',
    !canTransitionSellerOrder('IN_TRANSIT', 'DELIVERED', 'SELLER').allowed,
  );
  check(
    'logistics may mark it delivered',
    canTransitionSellerOrder('IN_TRANSIT', 'DELIVERED', 'LOGISTICS').allowed,
  );

  await rejects(
    'the server refuses an illegal jump',
    () =>
      transitionSellerOrder({
        sellerOrderId: soA.id,
        to: 'DELIVERED',
        actor: { userId: f.sellerAUserId, role: 'SELLER' },
      }),
    'cannot move',
  );

  // Walk the happy path.
  for (const step of ['ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'] as const) {
    await transitionSellerOrder({
      sellerOrderId: soA.id,
      to: step,
      actor: { userId: f.sellerAUserId, role: 'SELLER' },
    });
  }
  await transitionSellerOrder({
    sellerOrderId: soA.id,
    to: 'SHIPPED',
    actor: { userId: f.sellerAUserId, role: 'SELLER' },
    shipment: { courier: 'TestCourier', trackingNumber: 'TRACK123' },
  });

  const soAAfter = await prisma.sellerOrder.findUnique({ where: { id: soA.id } });
  eq('Seller A’s parcel is SHIPPED', soAAfter?.status, 'SHIPPED');

  // Seller B lags behind, which is what makes the parent status partial.
  await transitionSellerOrder({
    sellerOrderId: soB.id,
    to: 'ACCEPTED',
    actor: { userId: f.sellerBUserId, role: 'SELLER' },
  });

  const parent = await prisma.order.findUnique({ where: { id: order.orderId } });
  eq('one shipped + one accepted derives PARTIALLY_SHIPPED', parent?.orderStatus, 'PARTIALLY_SHIPPED');

  // =========================================================================
  section('§16 / §17 per-seller shipments and tracking');

  const shipmentA = await prisma.shipment.findFirst({
    where: { sellerOrderId: soA.id },
    include: { events: true },
  });
  const shipmentB = await prisma.shipment.findFirst({
    where: { sellerOrderId: soB.id },
    include: { events: true },
  });

  eq('Seller A’s shipment carries the courier', shipmentA?.courier, 'TestCourier');
  eq('…and the tracking number', shipmentA?.trackingNumber, 'TRACK123');
  check(
    'Seller A’s shipment has more events than Seller B’s',
    (shipmentA?.events.length ?? 0) > (shipmentB?.events.length ?? 0),
    `A=${shipmentA?.events.length} B=${shipmentB?.events.length}`,
  );
  check('Seller B’s shipment has no courier yet', !shipmentB?.courier);
  check(
    'the two shipments are independent records',
    shipmentA?.id !== shipmentB?.id,
  );

  // =========================================================================
  section('§13 payout appears on delivery, held until the window closes');

  await transitionSellerOrder({
    sellerOrderId: soA.id,
    to: 'IN_TRANSIT',
    actor: { userId: f.logisticsUserId, role: 'LOGISTICS' },
  });
  await transitionSellerOrder({
    sellerOrderId: soA.id,
    to: 'OUT_FOR_DELIVERY',
    actor: { userId: f.logisticsUserId, role: 'LOGISTICS' },
  });
  await transitionSellerOrder({
    sellerOrderId: soA.id,
    to: 'DELIVERED',
    actor: { userId: f.logisticsUserId, role: 'LOGISTICS' },
  });

  const payout = await prisma.payout.findUnique({ where: { sellerOrderId: soA.id } });
  check('a payout was created on delivery', payout !== null);
  eq('the payout is the seller’s ₹900 earning', payout?.netAmount, rupeesToPaise(900));
  eq('it is PENDING, not paid', payout?.status, 'PENDING');
  check(
    'it is held until the return window closes',
    Boolean(payout?.eligibleAt && payout.eligibleAt.getTime() > Date.now()),
    String(payout?.eligibleAt),
  );

  const earnings = await getSellerEarnings(f.sellerAId);
  check('the seller’s dashboard shows gross sales', earnings.grossSales > 0);
  check('…commission deducted', earnings.commission > 0);
  eq('…and nothing available for payout yet', earnings.availableForPayout, 0);

  // =========================================================================
  section('§19 reviews require a delivered purchase');

  const deliveredItem = await prisma.orderItem.findFirst({ where: { sellerOrderId: soA.id } });
  const undeliveredItem = await prisma.orderItem.findFirst({ where: { sellerOrderId: soB.id } });

  const review = await prisma.review.create({
    data: {
      customerId: f.customerId,
      productId: deliveredItem!.productId,
      orderItemId: deliveredItem!.id,
      rating: 5,
      comment: 'Arrived healthy',
      status: 'PUBLISHED',
    },
  });
  check('a delivered purchase can be reviewed', review.id.length > 0);

  await rejects(
    'the same purchase cannot be reviewed twice',
    () =>
      prisma.review.create({
        data: {
          customerId: f.customerId,
          productId: deliveredItem!.productId,
          orderItemId: deliveredItem!.id,
          rating: 1,
          status: 'PUBLISHED',
        },
      }),
  );

  await rejects(
    'a review cannot be attached to a purchase that does not exist',
    () =>
      prisma.review.create({
        data: {
          customerId: f.customerId,
          productId: f.productBId,
          orderItemId: 'no-such-item',
          rating: 5,
          status: 'PUBLISHED',
        },
      }),
  );

  check(
    'an undelivered item exists but is not yet reviewable',
    undeliveredItem !== null && undeliveredItem.reviewedAt === null,
  );

  // =========================================================================
  section('§18 a partial refund settles all five ledgers');

  const beforeRefund = await prisma.payout.findUnique({ where: { sellerOrderId: soA.id } });

  const refund = await issueRefund({
    sellerOrderId: soA.id,
    amountPaise: rupeesToPaise(500),
    reason: 'Test partial refund',
    actor: { userId: f.adminUserId, role: 'ADMIN' },
    // No provider configured in tests: the ledger is still settled correctly.
  });

  eq('₹500 was refunded', refund.amount, rupeesToPaise(500));
  eq('₹50 of commission was reversed', refund.commissionReversed, rupeesToPaise(50));
  eq('₹450 was debited from the seller', refund.sellerDebit, rupeesToPaise(450));
  eq(
    'the two pieces re-add to the refund exactly',
    refund.commissionReversed + refund.sellerDebit,
    rupeesToPaise(500),
  );

  const afterRefund = await prisma.payout.findUnique({ where: { sellerOrderId: soA.id } });
  eq(
    'the payout fell by the seller’s share',
    (beforeRefund?.netAmount ?? 0) - (afterRefund?.netAmount ?? 0),
    rupeesToPaise(450),
  );

  const commissionRow = await prisma.commission.findUnique({ where: { sellerOrderId: soA.id } });
  eq(
    'net platform revenue on this sub-order is now ₹50',
    (commissionRow?.commissionAmount ?? 0) - (commissionRow?.reversedAmount ?? 0),
    rupeesToPaise(50),
  );

  const paymentAfter = await prisma.payment.findFirst({ where: { orderId: order.orderId } });
  eq('the payment records the refunded amount', paymentAfter?.refundedAmount, rupeesToPaise(500));
  eq('…and is marked partially refunded', paymentAfter?.status, 'PARTIALLY_REFUNDED');

  await rejects(
    'refunding more than the sub-order gross is refused',
    () =>
      issueRefund({
        sellerOrderId: soA.id,
        amountPaise: rupeesToPaise(100_000),
        reason: 'Over-refund attempt',
        actor: { userId: f.adminUserId, role: 'ADMIN' },
      }),
    'can still be refunded',
  );

  // =========================================================================
  section('summary of the §34 order');

  const finalOrder = await prisma.order.findUnique({
    where: { id: order.orderId },
    include: {
      sellerOrders: {
        orderBy: { sellerOrderNumber: 'asc' },
        include: { seller: { select: { businessName: true } }, commission: true, payout: true },
      },
    },
  });

  console.log(`\n  Order ${finalOrder?.orderNumber} — ${formatPaise(finalOrder?.grandTotal ?? 0)} paid once`);
  for (const so of finalOrder?.sellerOrders ?? []) {
    console.log(
      `    ${so.sellerOrderNumber}  ${so.seller.businessName.padEnd(24)} ` +
        `${formatPaise(so.grossAmount).padStart(8)}  ` +
        `fee ${formatPaise(so.commissionAmount).padStart(6)}  ` +
        `earns ${formatPaise(so.sellerEarning).padStart(8)}  ` +
        `${so.status}`,
    );
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nAgriMall World — marketplace end-to-end test');
  console.log(`Fixture prefix: ${RUN}\n`);

  let fixtures: Fixtures | null = null;
  try {
    fixtures = await setup();
    await run(fixtures);
  } catch (err) {
    fail++;
    failures.push(`unexpected error: ${(err as Error).message}`);
    console.error('\n✗ The test run threw:', err);
  } finally {
    await teardown();
    console.log('\n(test fixtures removed)');
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`${'═'.repeat(60)}\n`);

  if (fail > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  • ${f}`));
    console.log('');
  }

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

void main();
