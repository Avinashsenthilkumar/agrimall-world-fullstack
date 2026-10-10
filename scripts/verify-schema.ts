/**
 * scripts/verify-schema.ts — database-level verification of the marketplace.
 *
 *   npx tsx scripts/verify-schema.ts
 *
 * Runs the REAL pricing engine from lib/shared/pricing.ts, writes the result
 * into a REAL PostgreSQL database through psql, and then asserts the things
 * that must be true of the schema itself:
 *
 *   §34  one payment → two seller orders, with correct commission and earnings
 *   §8   order_items hang off seller orders and carry price/name snapshots
 *   §11  stock cannot go negative, and reserved stock cannot be oversold
 *   §12  commissionAmount + sellerEarning = grossAmount, enforced by CHECK
 *   §19  a review requires a purchase, and one purchase allows one review
 *   §23  seller-scoped queries never leak another seller's rows
 *   §32  a replayed payment webhook cannot be recorded twice
 *
 * It needs only `psql` on PATH — no Prisma client, no running Next.js server —
 * so it can validate the migration on a bare database before the app is built.
 *
 * Environment: DATABASE_URL, or PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { quote, ZERO_SHIPPING_POLICY, type PricedLine } from '../lib/shared/pricing';
import { rupeesToPaise, formatPaise } from '../lib/shared/money';
import { deriveOrderStatus } from '../lib/shared/order-status';
import { reverseCommission } from '../lib/shared/commission';

// ---------------------------------------------------------------------------
// psql plumbing
// ---------------------------------------------------------------------------

// Load .env if dotenv happens to be installed. This script is deliberately
// dependency-free — it needs only `psql` — so a missing dotenv must not stop
// it: CI and shells that already export DATABASE_URL/PG* work fine without it.
//
// Loaded synchronously via createRequire rather than `await import`, because a
// top-level await would make this module async and break the sync entry path.
try {
  createRequire(import.meta.url)('dotenv/config');
} catch {
  /* no dotenv installed: rely on the environment already being set */
}

const conn = (() => {
  const url = process.env.DATABASE_URL;
  if (url) return ['-d', url];
  return [
    '-h', process.env.PGHOST ?? '127.0.0.1',
    '-U', process.env.PGUSER ?? 'postgres',
    '-d', process.env.PGDATABASE ?? 'agrimall',
  ];
})();

function psql(sql: string, opts: { expectError?: boolean } = {}): string {
  try {
    return execFileSync('psql', [...conn, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    if (opts.expectError) return `ERROR: ${e.stderr ?? ''}`;
    throw new Error(`psql failed:\n${e.stderr ?? e.stdout ?? String(err)}\n\nSQL: ${sql.slice(0, 400)}`);
  }
}

/** Run SQL expecting it to FAIL, and return the error text. */
function psqlExpectFailure(sql: string): string {
  const out = psql(sql, { expectError: true });
  if (!out.startsWith('ERROR:')) {
    throw new Error(`Expected this SQL to be rejected, but it succeeded:\n${sql.slice(0, 300)}`);
  }
  return out;
}

const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
const num = (v: number) => String(v);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

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

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

// ---------------------------------------------------------------------------

const RUN = `vtest_${Date.now().toString(36)}`;
const id = (label: string) => `${RUN}_${label}`;

function cleanup() {
  // Children cascade from users/orders, so removing the roots is enough.
  psql(`DELETE FROM "orders"  WHERE "id"   LIKE '${RUN}%';`);
  psql(`DELETE FROM "users"   WHERE "id"   LIKE '${RUN}%';`);
  psql(`DELETE FROM "categories" WHERE "id" LIKE '${RUN}%';`);
  psql(`DELETE FROM "webhook_events" WHERE "eventId" LIKE '${RUN}%';`);
  psql(`DELETE FROM "platform_settings" WHERE "key" LIKE '${RUN}%';`);
}

function main() {
  console.log(`\nAgriMall World — database verification`);
  console.log(`Target: ${process.env.DATABASE_URL ?? process.env.PGDATABASE ?? 'agrimall'}`);

  const version = psql('SELECT version();');
  console.log(`Server: ${version.split(',')[0]}\n`);

  // -------------------------------------------------------------------------
  section('schema shape');

  const tableCount = Number(
    psql(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public';`),
  );
  check(`all marketplace tables exist (${tableCount})`, tableCount >= 30, `found ${tableCount}`);

  // §22's required table list.
  const required = [
    'users', 'customers', 'sellers', 'seller_kyc', 'addresses', 'categories', 'brands',
    'products', 'product_variants', 'product_images', 'inventory', 'carts', 'cart_items',
    'wishlists', 'wishlist_items', 'orders', 'seller_orders', 'order_items', 'payments',
    'commissions', 'payouts', 'shipments', 'tracking_events', 'returns', 'refunds',
    'reviews', 'coupons', 'coupon_usage', 'notifications',
  ];
  const present = psql(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public';`,
  ).split('\n');
  const missing = required.filter((t) => !present.includes(t));
  check(`every table named in §22 is present`, missing.length === 0, missing.join(', '));

  // THE critical structural assertion: no seller column on orders.
  const ordersHasSellerId = psql(
    `SELECT count(*) FROM information_schema.columns
     WHERE table_name='orders' AND column_name='sellerId';`,
  );
  eq('§8: orders table has NO sellerId column', ordersHasSellerId, '0');

  const sellerOrdersExists = psql(
    `SELECT count(*) FROM information_schema.columns
     WHERE table_name='seller_orders' AND column_name='sellerId';`,
  );
  eq('§8: seller_orders carries the seller relationship', sellerOrdersExists, '1');

  const itemsParent = psql(
    `SELECT count(*) FROM information_schema.columns
     WHERE table_name='order_items' AND column_name='sellerOrderId';`,
  );
  eq('§8: order_items hang off seller_orders', itemsParent, '1');

  const snapshotCols = psql(
    `SELECT count(*) FROM information_schema.columns
     WHERE table_name='order_items'
       AND column_name IN ('productNameSnapshot','skuSnapshot','unitPrice');`,
  );
  eq('§8: order_items snapshot name, SKU and price', snapshotCols, '3');

  const indexCount = Number(psql(`SELECT count(*) FROM pg_indexes WHERE schemaname='public';`));
  check(`§22: indexes created (${indexCount})`, indexCount >= 100, `found ${indexCount}`);

  const fkCount = Number(
    psql(`SELECT count(*) FROM information_schema.table_constraints
          WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY';`),
  );
  check(`§22: foreign keys enforced (${fkCount})`, fkCount >= 50, `found ${fkCount}`);

  // -------------------------------------------------------------------------
  section('fixtures');

  // Two sellers, one customer, one product each.
  psql(`
    INSERT INTO "users" ("id","email","passwordHash","role","name","updatedAt") VALUES
      (${q(id('u_cust'))}, ${q(`cust.${RUN}@test.local`)}, '$2a$12$fakehashfortestingonly000000000000000000000000000000', 'CUSTOMER', 'Test Customer', now()),
      (${q(id('u_sa'))},   ${q(`sa.${RUN}@test.local`)},   '$2a$12$fakehashfortestingonly000000000000000000000000000000', 'SELLER',   'Seller A Owner', now()),
      (${q(id('u_sb'))},   ${q(`sb.${RUN}@test.local`)},   '$2a$12$fakehashfortestingonly000000000000000000000000000000', 'SELLER',   'Seller B Owner', now());

    INSERT INTO "customers" ("id","userId","fullName","updatedAt")
      VALUES (${q(id('cust'))}, ${q(id('u_cust'))}, 'Test Customer', now());

    INSERT INTO "sellers"
      ("id","userId","businessName","slug","ownerName","businessEmail","businessPhone","status","updatedAt") VALUES
      (${q(id('sa'))}, ${q(id('u_sa'))}, 'Seller A Nursery', ${q(id('seller-a'))}, 'A Owner', ${q(`sa.${RUN}@test.local`)}, '9840000001', 'APPROVED', now()),
      (${q(id('sb'))}, ${q(id('u_sb'))}, 'Seller B Nursery', ${q(id('seller-b'))}, 'B Owner', ${q(`sb.${RUN}@test.local`)}, '9840000002', 'APPROVED', now());

    INSERT INTO "categories" ("id","name","slug","commissionRate","taxRate","updatedAt")
      VALUES (${q(id('cat'))}, 'Test Indoor', ${q(id('test-indoor'))}, 10, 0, now());

    INSERT INTO "products"
      ("id","sellerId","categoryId","name","slug","sku","price","status","approvalStatus","updatedAt") VALUES
      (${q(id('pa'))}, ${q(id('sa'))}, ${q(id('cat'))}, 'Product A', ${q(id('product-a'))}, 'TEST-A', ${num(rupeesToPaise(1000))}, 'ACTIVE', 'APPROVED', now()),
      (${q(id('pb'))}, ${q(id('sb'))}, ${q(id('cat'))}, 'Product B', ${q(id('product-b'))}, 'TEST-B', ${num(rupeesToPaise(2000))}, 'ACTIVE', 'APPROVED', now());

    INSERT INTO "inventory" ("id","productId","onHand","reserved","lowStockThreshold","updatedAt") VALUES
      (${q(id('inv_a'))}, ${q(id('pa'))}, 10, 0, 5, now()),
      (${q(id('inv_b'))}, ${q(id('pb'))}, 10, 0, 5, now());
  `);
  check('two approved sellers with one ₹1,000 and one ₹2,000 product', true);

  // -------------------------------------------------------------------------
  section('§34 THE multi-vendor test');

  // Price the cart with the SAME engine the application uses.
  const lines: PricedLine[] = [
    {
      ref: 'A', productId: id('pa'), sellerId: id('sa'), categoryId: id('cat'),
      unitPrice: rupeesToPaise(1000), quantity: 1, taxRate: 0,
      commissionRates: { sellerRate: null, categoryRate: 10, platformRate: 10 },
      snapshot: { productName: 'Product A', sku: 'TEST-A' },
    },
    {
      ref: 'B', productId: id('pb'), sellerId: id('sb'), categoryId: id('cat'),
      unitPrice: rupeesToPaise(2000), quantity: 1, taxRate: 0,
      commissionRates: { sellerRate: null, categoryRate: 10, platformRate: 10 },
      snapshot: { productName: 'Product B', sku: 'TEST-B' },
    },
  ];

  const result = quote({ lines, shippingPolicy: ZERO_SHIPPING_POLICY });
  eq('customer pays exactly ₹3,000', result.grandTotal, rupeesToPaise(3000));
  eq('the engine produced TWO seller orders', result.perSeller.length, 2);

  // Write the order exactly as lib/server/orders.ts does.
  const orderNumber = `AGM-${RUN.slice(-4).toUpperCase()}`;
  const addr = JSON.stringify({
    fullName: 'Test Customer', phone: '9840011223', line1: '1 Test Road',
    city: 'Kochi', state: 'Kerala', pincode: '682031', country: 'India',
  });

  psql(`
    INSERT INTO "orders"
      ("id","orderNumber","customerId","subtotal","discount","tax","shippingFee","grandTotal",
       "paymentStatus","orderStatus","billingAddress","shippingAddress","updatedAt")
    VALUES (${q(id('order'))}, ${q(orderNumber)}, ${q(id('cust'))},
            ${num(result.subtotal)}, ${num(result.discount)}, ${num(result.tax)},
            ${num(result.shippingFee)}, ${num(result.grandTotal)},
            'PENDING', 'PENDING_PAYMENT', ${q(addr)}::jsonb, ${q(addr)}::jsonb, now());
  `);

  const suffixes = ['A', 'B'];
  result.perSeller.forEach((group, i) => {
    const soId = id(`so_${suffixes[i]}`);
    psql(`
      INSERT INTO "seller_orders"
        ("id","orderId","sellerId","sellerOrderNumber","subtotal","discount","tax","shippingFee",
         "grossAmount","commissionRate","commissionAmount","sellerEarning","status","paymentStatus","payoutStatus","updatedAt")
      VALUES (${q(soId)}, ${q(id('order'))}, ${q(group.sellerId)},
              ${q(`${orderNumber}-${suffixes[i]}`)},
              ${num(group.subtotal)}, ${num(group.discount)}, ${num(group.tax)}, ${num(group.shippingFee)},
              ${num(group.grossAmount)}, ${num(group.commissionRate)},
              ${num(group.commissionAmount)}, ${num(group.sellerEarning)},
              'PENDING', 'PENDING', 'PENDING', now());

      INSERT INTO "commissions"
        ("id","sellerId","orderId","sellerOrderId","rate","grossAmount","commissionAmount","sellerAmount","status","updatedAt")
      VALUES (${q(id(`comm_${suffixes[i]}`))}, ${q(group.sellerId)}, ${q(id('order'))}, ${q(soId)},
              ${num(group.commissionRate)}, ${num(group.grossAmount)},
              ${num(group.commissionAmount)}, ${num(group.sellerEarning)}, 'PENDING', now());

      INSERT INTO "shipments" ("id","sellerOrderId","status","updatedAt")
      VALUES (${q(id(`ship_${suffixes[i]}`))}, ${q(soId)}, 'PENDING', now());
    `);

    group.lines.forEach((line, j) => {
      psql(`
        INSERT INTO "order_items"
          ("id","sellerOrderId","productId","sellerId","productNameSnapshot","skuSnapshot",
           "quantity","unitPrice","discount","tax","total")
        VALUES (${q(id(`item_${suffixes[i]}_${j}`))}, ${q(soId)}, ${q(line.productId)}, ${q(group.sellerId)},
                ${q(line.snapshot.productName)}, ${q(line.snapshot.sku)},
                ${num(line.quantity)}, ${num(line.unitPrice)},
                ${num(line.lineDiscount)}, ${num(line.lineTax)}, ${num(line.lineTotal)});
      `);
    });
  });

  // --- The assertions the spec demands -----------------------------------
  eq(
    'ONE customer order was created',
    psql(`SELECT count(*) FROM "orders" WHERE "id" = ${q(id('order'))};`),
    '1',
  );
  eq(
    'TWO seller orders hang off it',
    psql(`SELECT count(*) FROM "seller_orders" WHERE "orderId" = ${q(id('order'))};`),
    '2',
  );
  eq(
    'order total is ₹3,000',
    psql(`SELECT "grandTotal" FROM "orders" WHERE "id" = ${q(id('order'))};`),
    String(rupeesToPaise(3000)),
  );

  const soA = psql(`
    SELECT "sellerOrderNumber" || '|' || "grossAmount" || '|' || "commissionAmount" || '|' || "sellerEarning"
    FROM "seller_orders" WHERE "orderId" = ${q(id('order'))} AND "sellerId" = ${q(id('sa'))};
  `).split('|');
  eq('Seller Order A number is AGM-xxxx-A', soA[0].endsWith('-A'), true);
  eq('Seller A gross = ₹1,000', soA[1], String(rupeesToPaise(1000)));
  eq('Seller A commission = ₹100', soA[2], String(rupeesToPaise(100)));
  eq('Seller A earning = ₹900', soA[3], String(rupeesToPaise(900)));

  const soB = psql(`
    SELECT "sellerOrderNumber" || '|' || "grossAmount" || '|' || "commissionAmount" || '|' || "sellerEarning"
    FROM "seller_orders" WHERE "orderId" = ${q(id('order'))} AND "sellerId" = ${q(id('sb'))};
  `).split('|');
  eq('Seller Order B number is AGM-xxxx-B', soB[0].endsWith('-B'), true);
  eq('Seller B gross = ₹2,000', soB[1], String(rupeesToPaise(2000)));
  eq('Seller B commission = ₹200', soB[2], String(rupeesToPaise(200)));
  eq('Seller B earning = ₹1,800', soB[3], String(rupeesToPaise(1800)));

  eq(
    'sub-order grosses sum to the order total',
    psql(`SELECT SUM("grossAmount") FROM "seller_orders" WHERE "orderId" = ${q(id('order'))};`),
    String(rupeesToPaise(3000)),
  );
  eq(
    'platform revenue on this order = ₹300',
    psql(`SELECT SUM("commissionAmount") FROM "commissions" WHERE "orderId" = ${q(id('order'))};`),
    String(rupeesToPaise(300)),
  );
  eq(
    'each seller has exactly one shipment (§16)',
    psql(`SELECT count(*) FROM "shipments" s
          JOIN "seller_orders" so ON so."id" = s."sellerOrderId"
          WHERE so."orderId" = ${q(id('order'))};`),
    '2',
  );

  // -------------------------------------------------------------------------
  section('§23 cross-tenant isolation');

  // The exact query the seller dashboard runs, with each seller's own scope.
  const aSees = psql(`
    SELECT count(*) FROM "seller_orders" WHERE "sellerId" = ${q(id('sa'))} AND "orderId" = ${q(id('order'))};
  `);
  const bSees = psql(`
    SELECT count(*) FROM "seller_orders" WHERE "sellerId" = ${q(id('sb'))} AND "orderId" = ${q(id('order'))};
  `);
  eq('Seller A sees exactly 1 sub-order (their own)', aSees, '1');
  eq('Seller B sees exactly 1 sub-order (their own)', bSees, '1');

  // Seller A asking for Seller B's sub-order id, scoped as the API scopes it.
  const crossTenant = psql(`
    SELECT count(*) FROM "seller_orders"
    WHERE "id" = ${q(id('so_B'))} AND "sellerId" = ${q(id('sa'))};
  `);
  eq('Seller A CANNOT read Seller B’s sub-order by id', crossTenant, '0');

  const crossProducts = psql(`
    SELECT count(*) FROM "products" WHERE "id" = ${q(id('pb'))} AND "sellerId" = ${q(id('sa'))};
  `);
  eq('Seller A CANNOT read Seller B’s product by id', crossProducts, '0');

  const crossItems = psql(`
    SELECT count(*) FROM "order_items" WHERE "sellerOrderId" = ${q(id('so_B'))} AND "sellerId" = ${q(id('sa'))};
  `);
  eq('Seller A CANNOT read Seller B’s order items', crossItems, '0');

  const adminSees = psql(`SELECT count(*) FROM "seller_orders" WHERE "orderId" = ${q(id('order'))};`);
  eq('Admin (unscoped) sees BOTH sub-orders', adminSees, '2');

  // -------------------------------------------------------------------------
  section('§12 money invariants (enforced by the database)');

  const badSplit = psqlExpectFailure(`
    UPDATE "seller_orders" SET "commissionAmount" = 1 WHERE "id" = ${q(id('so_A'))};
  `);
  check(
    'DB rejects commission + earning ≠ gross',
    badSplit.includes('seller_orders_money_split'),
    badSplit.slice(0, 120),
  );

  const negEarning = psqlExpectFailure(`
    UPDATE "seller_orders" SET "commissionAmount" = ${num(rupeesToPaise(1100))},
                               "sellerEarning"    = ${num(rupeesToPaise(-100))}
    WHERE "id" = ${q(id('so_A'))};
  `);
  check('DB rejects a negative seller earning', negEarning.includes('seller_orders_money'), negEarning.slice(0, 120));

  const badCommission = psqlExpectFailure(`
    UPDATE "commissions" SET "commissionAmount" = 5 WHERE "id" = ${q(id('comm_A'))};
  `);
  check('DB rejects an inconsistent commission row', badCommission.includes('commissions_split'));

  // -------------------------------------------------------------------------
  section('§11 inventory cannot oversell');

  // Negative onHand violates both `onhand_nonneg` and `available_nonneg`;
  // Postgres names whichever it evaluates first, so accept either.
  const negStock = psqlExpectFailure(`UPDATE "inventory" SET "onHand" = -1 WHERE "id" = ${q(id('inv_a'))};`);
  check(
    'DB rejects negative onHand',
    negStock.includes('inventory_onhand_nonneg') || negStock.includes('inventory_available_nonneg'),
    negStock.slice(0, 120),
  );

  const negReserved = psqlExpectFailure(`UPDATE "inventory" SET "reserved" = -1 WHERE "id" = ${q(id('inv_a'))};`);
  check('DB rejects negative reserved', negReserved.includes('inventory_reserved_nonneg'));

  const overReserve = psqlExpectFailure(`UPDATE "inventory" SET "reserved" = 11 WHERE "id" = ${q(id('inv_a'))};`);
  check(
    'DB rejects reserving more than is on hand (available < 0)',
    overReserve.includes('inventory_available_nonneg'),
    overReserve.slice(0, 120),
  );

  // The conditional UPDATE the reservation code actually uses.
  psql(`UPDATE "inventory" SET "onHand" = 1, "reserved" = 0 WHERE "id" = ${q(id('inv_a'))};`);
  const firstGrab = psql(`
    WITH upd AS (
      UPDATE "inventory" SET "reserved" = "reserved" + 1
      WHERE "id" = ${q(id('inv_a'))} AND "onHand" - "reserved" >= 1
      RETURNING 1
    ) SELECT count(*) FROM upd;
  `);
  const secondGrab = psql(`
    WITH upd AS (
      UPDATE "inventory" SET "reserved" = "reserved" + 1
      WHERE "id" = ${q(id('inv_a'))} AND "onHand" - "reserved" >= 1
      RETURNING 1
    ) SELECT count(*) FROM upd;
  `);
  eq('first shopper reserves the last unit', firstGrab, '1');
  eq('second shopper is refused (0 rows matched, no oversell)', secondGrab, '0');
  eq(
    'inventory is left consistent: 1 on hand, 1 reserved, 0 available',
    psql(`SELECT "onHand" || '/' || "reserved" FROM "inventory" WHERE "id" = ${q(id('inv_a'))};`),
    '1/1',
  );
  psql(`UPDATE "inventory" SET "onHand" = 10, "reserved" = 0 WHERE "id" = ${q(id('inv_a'))};`);

  // -------------------------------------------------------------------------
  section('§32 webhook idempotency');

  psql(`
    INSERT INTO "payments" ("id","orderId","provider","providerOrderId","amount","status","updatedAt")
    VALUES (${q(id('pay'))}, ${q(id('order'))}, 'RAZORPAY', ${q(id('rzp_order'))},
            ${num(result.grandTotal)}, 'PENDING', now());

    INSERT INTO "webhook_events" ("id","provider","eventId","eventType","payload")
    VALUES (${q(id('wh1'))}, 'RAZORPAY', ${q(id('evt_1'))}, 'payment.captured', '{}'::jsonb);
  `);

  const replay = psqlExpectFailure(`
    INSERT INTO "webhook_events" ("id","provider","eventId","eventType","payload")
    VALUES (${q(id('wh2'))}, 'RAZORPAY', ${q(id('evt_1'))}, 'payment.captured', '{}'::jsonb);
  `);
  check(
    'a replayed webhook event is rejected by the unique index',
    replay.includes('webhook_events_provider_eventId_key'),
    replay.slice(0, 140),
  );
  eq(
    'only one webhook row exists for that event',
    psql(`SELECT count(*) FROM "webhook_events" WHERE "eventId" = ${q(id('evt_1'))};`),
    '1',
  );

  const dupPayment = psqlExpectFailure(`
    INSERT INTO "payments" ("id","orderId","provider","providerPaymentId","amount","status","updatedAt")
    VALUES (${q(id('pay2'))}, ${q(id('order'))}, 'RAZORPAY', 'rzp_pay_dup', ${num(1)}, 'CAPTURED', now()),
           (${q(id('pay3'))}, ${q(id('order'))}, 'RAZORPAY', 'rzp_pay_dup', ${num(1)}, 'CAPTURED', now());
  `);
  check(
    'the same provider payment id cannot be recorded twice',
    dupPayment.includes('payments_providerPaymentId_key'),
  );

  // -------------------------------------------------------------------------
  section('payment capture, delivery and payout');

  psql(`
    UPDATE "payments" SET "status"='CAPTURED', "providerPaymentId"=${q(id('rzp_pay'))}, "capturedAt"=now()
      WHERE "id" = ${q(id('pay'))};
    UPDATE "orders" SET "paymentStatus"='CAPTURED', "orderStatus"='CONFIRMED', "confirmedAt"=now()
      WHERE "id" = ${q(id('order'))};
    UPDATE "seller_orders" SET "paymentStatus"='CAPTURED' WHERE "orderId" = ${q(id('order'))};
    UPDATE "commissions" SET "status"='EARNED' WHERE "orderId" = ${q(id('order'))};
    -- Commit the reservations: onHand falls, reserved returns to zero.
    UPDATE "inventory" SET "onHand" = "onHand" - 1 WHERE "productId" IN (${q(id('pa'))}, ${q(id('pb'))});
  `);
  eq(
    'stock dropped by one unit per seller on capture',
    psql(`SELECT SUM("onHand") FROM "inventory" WHERE "productId" IN (${q(id('pa'))}, ${q(id('pb'))});`),
    '18',
  );

  // Seller A fulfils; Seller B is still packing — the state the single-seller
  // model could not express.
  psql(`
    UPDATE "seller_orders" SET "status"='ACCEPTED', "acceptedAt"=now() WHERE "id" = ${q(id('so_A'))};
    UPDATE "seller_orders" SET "status"='PACKING',  "packedAt"=now()   WHERE "id" = ${q(id('so_A'))};
    UPDATE "seller_orders" SET "status"='READY_FOR_PICKUP'              WHERE "id" = ${q(id('so_A'))};
    UPDATE "seller_orders" SET "status"='SHIPPED', "shippedAt"=now()    WHERE "id" = ${q(id('so_A'))};
    UPDATE "seller_orders" SET "status"='ACCEPTED', "acceptedAt"=now() WHERE "id" = ${q(id('so_B'))};
    UPDATE "seller_orders" SET "status"='PACKING',  "packedAt"=now()   WHERE "id" = ${q(id('so_B'))};

    INSERT INTO "tracking_events" ("id","shipmentId","status","location","message") VALUES
      (${q(id('te1'))}, ${q(id('ship_A'))}, 'ORDER_CONFIRMED',  'Seller A Nursery', 'Accepted'),
      (${q(id('te2'))}, ${q(id('ship_A'))}, 'PACKED',           'Packing bay',      'Boxed'),
      (${q(id('te3'))}, ${q(id('ship_A'))}, 'PICKED_UP',        'Origin hub',       'Courier collected'),
      (${q(id('te4'))}, ${q(id('ship_B'))}, 'ORDER_CONFIRMED',  'Seller B Nursery', 'Accepted');
  `);

  // The derived parent status, computed by the shared module.
  const statuses = psql(
    `SELECT "status" FROM "seller_orders" WHERE "orderId" = ${q(id('order'))} ORDER BY "sellerOrderNumber";`,
  ).split('\n');
  const derived = deriveOrderStatus(
    statuses.map((s) => ({ status: s as never })),
    { captured: true },
  );
  eq('one shipped + one packing derives PARTIALLY_SHIPPED', derived, 'PARTIALLY_SHIPPED');
  psql(`UPDATE "orders" SET "orderStatus" = ${q(derived)} WHERE "id" = ${q(id('order'))};`);

  eq(
    '§17: each shipment has its own tracking events',
    psql(`SELECT count(DISTINCT "shipmentId") FROM "tracking_events"
          WHERE "shipmentId" IN (${q(id('ship_A'))}, ${q(id('ship_B'))});`),
    '2',
  );
  eq(
    'Seller A’s shipment has 3 events, B’s has 1',
    psql(`SELECT
            (SELECT count(*) FROM "tracking_events" WHERE "shipmentId"=${q(id('ship_A'))}) || '/' ||
            (SELECT count(*) FROM "tracking_events" WHERE "shipmentId"=${q(id('ship_B'))});`),
    '3/1',
  );

  // Deliver A and create its payout.
  psql(`
    UPDATE "seller_orders" SET "status"='DELIVERED', "deliveredAt"=now() WHERE "id" = ${q(id('so_A'))};
    INSERT INTO "payouts"
      ("id","sellerId","sellerOrderId","grossAmount","commissionAmount","netAmount","status","eligibleAt","updatedAt")
    VALUES (${q(id('payout_A'))}, ${q(id('sa'))}, ${q(id('so_A'))},
            ${num(rupeesToPaise(1000))}, ${num(rupeesToPaise(100))}, ${num(rupeesToPaise(900))},
            'PENDING', now() + interval '7 days', now());
  `);
  eq(
    '§13: payout created on delivery for the seller’s ₹900',
    psql(`SELECT "netAmount" FROM "payouts" WHERE "sellerOrderId" = ${q(id('so_A'))};`),
    String(rupeesToPaise(900)),
  );
  eq(
    '§13: payout is PENDING and held until the return window closes',
    psql(`SELECT "status" || '|' || ("eligibleAt" > now())::text
          FROM "payouts" WHERE "sellerOrderId" = ${q(id('so_A'))};`),
    'PENDING|true',
  );
  eq(
    '§13: not yet eligible for release',
    psql(`SELECT count(*) FROM "payouts"
          WHERE "sellerOrderId" = ${q(id('so_A'))} AND "status"='PENDING' AND "eligibleAt" <= now();`),
    '0',
  );

  // -------------------------------------------------------------------------
  section('§19 reviews require a real purchase');

  // Allowed: the customer reviews the item they actually received.
  psql(`
    INSERT INTO "reviews" ("id","customerId","productId","orderItemId","rating","comment","status","updatedAt")
    VALUES (${q(id('rev'))}, ${q(id('cust'))}, ${q(id('pa'))}, ${q(id('item_A_0'))}, 5, 'Arrived healthy', 'PUBLISHED', now());
  `);
  eq('a delivered purchase can be reviewed', psql(`SELECT count(*) FROM "reviews" WHERE "id"=${q(id('rev'))};`), '1');

  const secondReview = psqlExpectFailure(`
    INSERT INTO "reviews" ("id","customerId","productId","orderItemId","rating","status","updatedAt")
    VALUES (${q(id('rev2'))}, ${q(id('cust'))}, ${q(id('pa'))}, ${q(id('item_A_0'))}, 1, 'PUBLISHED', now());
  `);
  check(
    'the same purchase cannot be reviewed twice',
    secondReview.includes('reviews_orderItemId_key'),
    secondReview.slice(0, 120),
  );

  const fakeReview = psqlExpectFailure(`
    INSERT INTO "reviews" ("id","customerId","productId","orderItemId","rating","status","updatedAt")
    VALUES (${q(id('rev3'))}, ${q(id('cust'))}, ${q(id('pb'))}, 'no-such-order-item', 3, 'PUBLISHED', now());
  `);
  check(
    'a review with no purchase behind it is rejected',
    fakeReview.includes('reviews_orderItemId_fkey'),
    fakeReview.slice(0, 120),
  );

  const badRating = psqlExpectFailure(`
    UPDATE "reviews" SET "rating" = 9 WHERE "id" = ${q(id('rev'))};
  `);
  check('a rating outside 1-5 is rejected', badRating.includes('reviews_rating_range'));

  // -------------------------------------------------------------------------
  section('§18 refund splits correctly');

  // Refund half of Seller A's ₹1,000 sub-order (which paid ₹100 commission).
  const rev = reverseCommission({
    refundAmount: rupeesToPaise(500),
    originalGross: rupeesToPaise(1000),
    originalCommission: rupeesToPaise(100),
  });

  psql(`
    INSERT INTO "refunds"
      ("id","orderId","sellerOrderId","paymentId","amount","commissionReversed","sellerDebit","reason","status","updatedAt")
    VALUES (${q(id('refund'))}, ${q(id('order'))}, ${q(id('so_A'))}, ${q(id('pay'))},
            ${num(rupeesToPaise(500))}, ${num(rev.commissionReversed)}, ${num(rev.sellerDebit)},
            'Partial refund test', 'COMPLETED', now());

    UPDATE "commissions" SET "reversedAmount" = ${num(rev.commissionReversed)} WHERE "id" = ${q(id('comm_A'))};
    UPDATE "payouts" SET "refundAdjustment" = ${num(rev.sellerDebit)},
                         "netAmount" = "netAmount" - ${num(rev.sellerDebit)}
      WHERE "id" = ${q(id('payout_A'))};
  `);

  eq('₹50 of platform commission reversed', rev.commissionReversed, rupeesToPaise(50));
  eq('₹450 debited from the seller', rev.sellerDebit, rupeesToPaise(450));
  eq(
    'the two pieces re-add to the ₹500 refund',
    rev.commissionReversed + rev.sellerDebit,
    rupeesToPaise(500),
  );
  eq(
    'the payout dropped from ₹900 to ₹450',
    psql(`SELECT "netAmount" FROM "payouts" WHERE "id" = ${q(id('payout_A'))};`),
    String(rupeesToPaise(450)),
  );
  eq(
    'net platform revenue on Seller A is now ₹50',
    psql(`SELECT "commissionAmount" - "reversedAmount" FROM "commissions" WHERE "id" = ${q(id('comm_A'))};`),
    String(rupeesToPaise(50)),
  );

  // -------------------------------------------------------------------------
  section('§7 storefront never shows unapproved listings');

  psql(`
    INSERT INTO "products"
      ("id","sellerId","categoryId","name","slug","sku","price","status","approvalStatus","updatedAt")
    VALUES (${q(id('p_pending'))}, ${q(id('sa'))}, ${q(id('cat'))}, 'Pending Product',
            ${q(id('pending-product'))}, 'TEST-PEND', ${num(rupeesToPaise(500))},
            'PENDING_APPROVAL', 'PENDING', now());
  `);

  // The exact storefront predicate from app/api/products/route.ts.
  const storefront = psql(`
    SELECT count(*) FROM "products" p
    JOIN "sellers" s ON s."id" = p."sellerId"
    WHERE p."approvalStatus" = 'APPROVED'
      AND p."status" IN ('ACTIVE','OUT_OF_STOCK')
      AND s."status" = 'APPROVED'
      AND p."sellerId" IN (${q(id('sa'))}, ${q(id('sb'))});
  `);
  eq('only the 2 approved products are purchasable', storefront, '2');

  // Now suspend Seller A: their listings must vanish from the shop.
  psql(`UPDATE "sellers" SET "status" = 'SUSPENDED' WHERE "id" = ${q(id('sa'))};`);
  const afterSuspend = psql(`
    SELECT count(*) FROM "products" p
    JOIN "sellers" s ON s."id" = p."sellerId"
    WHERE p."approvalStatus" = 'APPROVED'
      AND p."status" IN ('ACTIVE','OUT_OF_STOCK')
      AND s."status" = 'APPROVED'
      AND p."sellerId" IN (${q(id('sa'))}, ${q(id('sb'))});
  `);
  eq('suspending a seller removes their listings from the shop', afterSuspend, '1');
  eq(
    'but their order history is untouched',
    psql(`SELECT count(*) FROM "seller_orders" WHERE "sellerId" = ${q(id('sa'))};`),
    '1',
  );
  psql(`UPDATE "sellers" SET "status" = 'APPROVED' WHERE "id" = ${q(id('sa'))};`);

  // -------------------------------------------------------------------------
  section('§8 snapshots survive catalogue changes');

  psql(`
    UPDATE "products" SET "name" = 'RENAMED LATER', "price" = ${num(rupeesToPaise(9999))}
    WHERE "id" = ${q(id('pa'))};
  `);
  eq(
    'the order item still records the name it was sold under',
    psql(`SELECT "productNameSnapshot" FROM "order_items" WHERE "id" = ${q(id('item_A_0'))};`),
    'Product A',
  );
  eq(
    'the order item still records the price it was sold at',
    psql(`SELECT "unitPrice" FROM "order_items" WHERE "id" = ${q(id('item_A_0'))};`),
    String(rupeesToPaise(1000)),
  );
  eq(
    'and the seller order total is unchanged by the price edit',
    psql(`SELECT "grossAmount" FROM "seller_orders" WHERE "id" = ${q(id('so_A'))};`),
    String(rupeesToPaise(1000)),
  );

  // -------------------------------------------------------------------------
  section('§20 coupon integrity');

  const badPercent = psqlExpectFailure(`
    INSERT INTO "coupons" ("id","code","scope","discountType","discountValue","minOrderValue","startsAt","expiresAt","updatedAt")
    VALUES (${q(id('coup_bad'))}, ${q(id('BAD'))}, 'PLATFORM', 'PERCENT', 150, 0, now(), now() + interval '1 day', now());
  `);
  check('a >100% coupon is rejected', badPercent.includes('coupons_percent_range'));

  const badWindow = psqlExpectFailure(`
    INSERT INTO "coupons" ("id","code","scope","discountType","discountValue","minOrderValue","startsAt","expiresAt","updatedAt")
    VALUES (${q(id('coup_w'))}, ${q(id('WINDOW'))}, 'PLATFORM', 'FIXED', 100, 0, now(), now() - interval '1 day', now());
  `);
  check('a coupon expiring before it starts is rejected', badWindow.includes('coupons_window'));

  const badScope = psqlExpectFailure(`
    INSERT INTO "coupons" ("id","code","scope","discountType","discountValue","minOrderValue","startsAt","expiresAt","updatedAt")
    VALUES (${q(id('coup_s'))}, ${q(id('SCOPE'))}, 'SELLER', 'FIXED', 100, 0, now(), now() + interval '1 day', now());
  `);
  check(
    'a SELLER-scoped coupon with no seller is rejected',
    badScope.includes('coupons_scope_target'),
    badScope.slice(0, 120),
  );

  // -------------------------------------------------------------------------
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  Order ${orderNumber}: ${formatPaise(result.grandTotal)} → 2 seller orders`);
  console.log(`${'═'.repeat(62)}\n`);

  if (fail > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  • ${f}`));
  }
}

try {
  cleanup();
  main();
} finally {
  cleanup();
  console.log('(test fixtures removed)\n');
}

process.exit(fail > 0 ? 1 : 0);
