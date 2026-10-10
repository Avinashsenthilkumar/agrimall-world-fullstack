# AgriMall World — Multi-Vendor Plant Marketplace

A production-architecture marketplace where independent nurseries register, get
verified, list plants, and fulfil their own orders — while a customer fills one
basket across several sellers, pays once, and tracks each parcel separately.

Built on the existing AgriMall World project: the UI, branding, components and
1,100-line stylesheet are preserved. What changed is everything underneath.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    Edit .env — at minimum DATABASE_URL and SESSION_SECRET.
#    Generate a secret with:
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Create the database
createdb agrimall

# 4. Apply the schema
npx prisma migrate deploy      # production / CI
# or, for a fresh dev database:
npx prisma migrate dev

# 5. Seed demo data (admin, customer, 4 sellers in different states, catalogue)
npm run db:seed

# 6. Run
npm run dev                    # http://localhost:3000
```

### Verify it works

```bash
npm run typecheck          # TypeScript, no errors
npx tsx scripts/test-pricing.ts    # 101 pure-logic tests (no DB needed)
npx tsx scripts/verify-schema.ts   # 68 database-level tests (needs psql)
npm run test:marketplace           # end-to-end §33/§34 suite (needs the DB)
npm run build                      # production build
```

`GET /api/health` reports row counts and which integrations are actually
configured.

### Seeded sign-ins

All use the password `AgriMall#2026`. **Change these before deploying.**

| Role | Email | Notes |
|---|---|---|
| Admin | `admin@agrimall.test` | approves sellers, moderates listings, releases payouts |
| Logistics | `logistics@agrimall.test` | records courier scans |
| Customer | `anjali@example.test` | has a saved address |
| Seller A | `green@roots.test` | **approved**, 8% negotiated commission |
| Seller B | `palms@kerala.test` | **approved**, default commission |
| Seller C | `coastal@chennai.test` | **PENDING_REVIEW** — try approving it |
| Seller D | `nilgiri@exotics.test` | **DRAFT** — KYC incomplete, cannot sell |

---

## The change that matters most

The v1 schema had `orders.seller_id`. That one column made a true marketplace
impossible: an order could only ever belong to one seller.

**There is now no `sellerId` column on `orders` at all.** An `Order` is a
payment envelope; the unit of fulfilment, commission and payout is
`SellerOrder`:

```
ORDER AGM-4821                          ₹3,000   ← ONE payment, ONE checkout
│
├── SELLER ORDER AGM-4821-A   Green Roots Nursery
│   ├── order_items  (name/SKU/price snapshotted at sale)
│   ├── commission   ₹1,000 gross → ₹100 fee → ₹900 to seller
│   ├── shipment     Delhivery · TRACK123 · its own tracking events
│   └── payout       ₹900, held until the return window closes
│
└── SELLER ORDER AGM-4821-B   Kerala Palm Growers
    ├── order_items
    ├── commission   ₹2,000 gross → ₹200 fee → ₹1,800 to seller
    ├── shipment     separate courier, separate scans
    └── payout       ₹1,800
```

The customer sees one order with two parcels. Seller A sees only `-A`. Seller B
sees only `-B`. The admin sees everything. The parent order's status is
**derived** from its children, which is what lets it honestly say
`PARTIALLY_SHIPPED` when A has dispatched and B is still packing.

---

## Full flow

### Customer

```
BROWSE  /customer            products from the DB; only APPROVED listings from
   │                         APPROVED sellers appear
   ▼
PRODUCT                      detail, real reviews, "sold by <nursery>"
   │
   ▼
ADD TO CART                  POST /api/cart — stored in the database, so the
   │                         cart survives a refresh and follows the account
   ▼
CART                         GET /api/cart → GROUPED BY SELLER, each group with
   │                         its own subtotal and shipping
   ▼
COUPON                       POST /api/cart/quote — validated server-side; a
   │                         platform coupon is split across sellers pro-rata
   ▼
CHECKOUT                     POST /api/checkout
   │                         client sends ONLY { productId, quantity, addressId }
   │                         server: re-reads prices → checks stock → verifies
   │                         sellers → computes tax, shipping, commission →
   │                         creates 1 Order + N SellerOrders + reserves stock
   │                         → creates the payment intent for ITS OWN figure
   ▼
PAY                          gateway widget opens with the server's amount
   │
   ▼
WEBHOOK                      POST /api/payments/webhook/razorpay
   │                         signature verified → event recorded (unique) →
   │                         payment captured → reservations committed →
   │                         sellers notified. THIS is what confirms an order.
   ▼
CONFIRMED                    /api/payments/verify reports the REAL state; if the
   │                         webhook hasn't landed it says "processing", never
   │                         "success"
   ▼
TRACK                        GET /api/orders/[id] → one ladder PER PARCEL, built
   │                         from the courier's actual recorded scans
   ▼
DELIVERED → REVIEW           reviewable only because the purchase exists
          → RETURN           per parcel, within the return window
```

### Seller

```
REGISTER        POST /api/seller/register        → status DRAFT (signed in, cannot sell)
   ▼
KYC             POST /api/seller/kyc             PAN/GST stored; Aadhaar last-4 only
   ▼
BANK            POST /api/seller/kyc/bank        account hashed, last-4 kept
   ▼
DOCUMENTS       POST /api/uploads                written to real storage, outside public/
   ▼
SUBMIT          POST /api/seller/kyc/submit      → PENDING_REVIEW, admins notified
   ▼
ADMIN APPROVES                                   → APPROVED
   ▼
LIST A PLANT    POST /api/seller/products        → PENDING_APPROVAL (not live yet)
   ▼
ADMIN APPROVES                                   → ACTIVE, now purchasable
   ▼
ORDER ARRIVES   GET /api/seller/orders           their own sub-orders only
   ▼
ACCEPT → PACK → READY_FOR_PICKUP → SHIPPED (+ courier details)
   ▼
COURIER DELIVERS                                 logistics records it, not the seller
   ▼
PAYOUT          created on delivery, held for the return window, PAID only
                once a provider reference is recorded
```

### Admin

```
LOGIN → /admin
   ├── Overview        GMV, platform revenue, work waiting
   ├── Sellers & KYC   read the application → approve / reject / suspend
   │                   (every KYC view is written to the audit log)
   ├── Moderation      approve or reject each listing before it can be sold
   ├── Orders          every order with its full seller split
   ├── Payouts         submit batch → PROCESSING; mark PAID only with a
   │                   provider reference
   ├── Returns         progress pickup → received (restocks) → inspected →
   │                   issue refund (reverses commission + adjusts payout)
   ├── Coupons         platform / seller / category scopes
   └── Settings        commission rate, shipping policy, return window
```

---

## What was wrong in v1, and what replaced it

| v1 | Now |
|---|---|
| `orders.seller_id` — one seller per order | **No such column.** `Order` → N `SellerOrder`, each with its own items, commission, shipment and payout |
| `sellers.pass` plain text, compared in SQL | **bcrypt** (cost 12). No code path stores or compares a plain password |
| `window.__sellerSession` | **HTTP-only cookie**, SHA-256 hash stored server-side, role re-read from the DB on every request |
| No admin auth at all | `requireAdmin()` on every admin endpoint |
| Prices posted from the browser | Client may send **only** `{ productId, variantId, quantity }`. The schema is `.strict()`, so sending `price` is a 422 |
| `processPayment()` → instant success | Order confirmed **only** from a signature-verified webhook. Amount compared against the stored total |
| `stock = MAX(0, stock - qty)` | `onHand` / `reserved` / `available`, conditional updates, SERIALIZABLE transactions, and three CHECK constraints |
| Seller `Active` on registration | `DRAFT → PENDING_REVIEW → APPROVED`; `requireApprovedSeller()` blocks listing and fulfilment until then |
| KYC uploads never left the browser | Real storage; private documents outside `public/`, served only to the owner or an admin, every admin read audited |
| Hardcoded review list in the JSX | `Review.orderItemId` is unique and FK-constrained — you cannot review what you did not buy |
| Fake tracking on a timer | `TrackingEvent` rows written by the party handling the parcel |
| No commission, payouts, returns, coupons | All present, with the money identity enforced by the database |
| SQLite | PostgreSQL, 39 tables, 141 indexes, 60 foreign keys |
| "AI-powered plant doctor" (a lookup table) | Relabelled honestly as a **plant care guide**, with the same useful advice and no false claim |

---

## Architecture

```
app/
├── api/                      75 route handlers
│   ├── auth/                 register, login, logout, me, password, verify
│   ├── products/ categories/ sellers/      public catalogue
│   ├── cart/ addresses/ checkout/          customer purchase path
│   ├── payments/             create · verify · webhook/razorpay · webhook/stripe
│   ├── orders/               list · detail (per-parcel tracking) · cancel · guest track
│   ├── reviews/ returns/ wishlist/ notifications/
│   ├── seller/               dashboard, products, inventory, orders, finance,
│   │                         payouts, analytics, profile, kyc, returns
│   ├── admin/                dashboard, sellers, products, orders, payouts,
│   │                         coupons, categories, returns, refunds, settings,
│   │                         customers, audit
│   ├── logistics/            shipments + courier scans
│   ├── cron/                 release-reservations, payouts
│   ├── files/[...key]/       authorised private-document serving
│   └── health/
│
├── customer/                 storefront + CartDrawer + CheckoutModal + TrackingModal
├── seller/                   onboard (KYC wizard) + dashboard
├── admin/                    platform console
├── logistics/                courier scan console
├── login/ register/ reset-password/ verify-email/
└── globals.css               PRESERVED from v1, unchanged

lib/
├── shared/                   DEPENDENCY-FREE, unit-tested pure logic
│   ├── money.ts              paise arithmetic + exact integer allocation
│   ├── pricing.ts            THE pricing engine (§9, §10)
│   ├── commission.ts         rate resolution + settlement + reversal (§12)
│   └── order-status.ts       both state machines (§15)
│
├── server/
│   ├── env.ts                validated configuration, fails fast
│   ├── prisma.ts             client + serializable transactions with retry
│   ├── http.ts               uniform responses, safe error mapping
│   ├── password.ts           bcrypt + policy
│   ├── session.ts            cookie sessions, hashed server-side
│   ├── auth.ts               requireUser / requireRole / ownership guards
│   ├── pricing.ts            resolve a cart against the DB (§10's checklist)
│   ├── inventory.ts          reserve / commit / release / restock (§11)
│   ├── orders.ts             THE FAN-OUT + transitions (§8, §15)
│   ├── payments.ts           Razorpay + Stripe, signatures, idempotency
│   ├── payouts.ts            settlement (§13)
│   ├── returns.ts            returns + refunds across five ledgers (§18)
│   ├── sellers.ts            onboarding, KYC privacy, approval (§4)
│   ├── storage.ts            uploads, magic-byte sniffing, S3 SigV4
│   ├── schemas.ts            every request body (§24)
│   ├── settings.ts           admin-configurable business rules
│   ├── notifications.ts      in-app + email templates
│   ├── audit.ts              privileged-action trail
│   └── ratelimit.ts
│
└── client/                   api.ts · AppContext.tsx · format.ts · plant-care.ts

prisma/
├── schema.prisma             39 models
├── migrations/               hand-verified SQL, applied against PostgreSQL 16
└── seed.ts

scripts/
├── test-pricing.ts           101 pure-logic tests
├── verify-schema.ts          68 database-level tests
└── test-marketplace.ts       end-to-end suite
```

### Money

**All amounts are integers in paise.** 1 rupee = 100 paise. Floating point
never touches a monetary value — not in the database, not in the API, not in
the pricing engine. Rupees exist only at the display edge
(`lib/client/format.ts`).

An order-level coupon is spread across sellers with the largest-remainder
method (`allocate()` in `lib/shared/money.ts`), so the per-seller discounts sum
to the order discount **exactly** — no lost or invented paise, and the
`commission + earning = gross` invariant survives.

### Commission (§12)

Resolved **per line item**, in this order:

```
seller.commissionRate  →  category.commissionRate  →  platform default
```

Per-item matters: one sub-order can hold a 6%-commission sapling and a
15%-commission exotic. The blended rate is stored on the sub-order as a
*result*, never an input. Commission is charged on the goods value
(`subtotal − discount`) — not on tax collected for the government, nor on the
shipping fee that reimburses the courier.

### Inventory (§11)

```
available = onHand − reserved
```

Three independent layers stop overselling:

1. The reservation UPDATE is **conditional** (`WHERE onHand - reserved >= qty`).
   If a competing checkout took the stock, zero rows match and we raise
   `OutOfStockError`. No read-then-write on a stale value.
2. Checkout runs at **SERIALIZABLE** isolation with retry-on-conflict, so two
   concurrent checkouts cannot both observe `available = 1`.
3. A **CHECK constraint** (`onHand - reserved >= 0`) is the final backstop.
   Even a hand-written SQL mistake cannot persist negative stock.

---

## Verification

### `scripts/test-pricing.ts` — 101 assertions, no database

Pure-logic tests of the pricing, commission and status modules, including a
500-case property check that integer allocation never loses a paisa.

### `scripts/verify-schema.ts` — 68 assertions against real PostgreSQL

Runs the real pricing engine, writes the result to the database through `psql`,
then asserts what the schema itself guarantees. Needs only `psql` — no Prisma
client, no server — so it can validate a migration on a bare database.

Confirmed against PostgreSQL 16:

- `orders` has **no `sellerId` column**; `seller_orders` carries the relationship
- Seller A querying Seller B's sub-order / product / items → **0 rows**; admin sees both
- Two shoppers, one unit left → first reserves, **second refused**, stock consistent
- Negative stock, over-reservation → **rejected by CHECK constraints**
- `commission + earning ≠ gross` → **rejected**
- A replayed webhook event → **rejected by the unique index**
- The same provider payment id twice → **rejected**
- Price edited after sale → the order item still records what was actually sold
- Suspending a seller hides their listings but **leaves order history intact**
- A review with no purchase → **rejected by FK**; the same purchase twice → **rejected**
- A partial ₹500 refund → ₹50 commission reversed, ₹450 seller debit, payout ₹900 → ₹450
- A >100% coupon, a backwards date window, a seller-scoped coupon with no seller → **all rejected**

### `scripts/test-marketplace.ts` — end-to-end (§33, §34)

Drives the **real server modules** — the same functions the API routes call —
against your database. Creates its own fixtures under a unique prefix and
removes them afterwards, so it is safe against a development database.

**The §34 scenario:**

```
Seller A: Product A = ₹1,000
Seller B: Product B = ₹2,000
Customer adds both and pays ₹3,000

→ Order AGM-xxxx                       ₹3,000
  ├── AGM-xxxx-A  Seller A   ₹1,000    commission ₹100  → earns ₹900
  └── AGM-xxxx-B  Seller B   ₹2,000    commission ₹200  → earns ₹1,800
                                       platform revenue: ₹300
```

It also proves: a client-supplied price is ignored; two concurrent checkouts for
one unit cannot both succeed; a replayed payment confirmation does not deplete
stock twice; Seller A cannot read or fulfil Seller B's order; illegal status
jumps are refused; each sub-order has its own shipment and events; a payout
appears on delivery and is held; a partial refund settles all five ledgers; and
a non-approved seller's products cannot be bought.

---

## Security

Every protected endpoint runs the §23 chain:

```
authentication → role → ownership → input validation → business rules → transaction
```

- **No endpoint reads a role, sellerId or customerId from the request.** Those
  come only from the server-side session. Grep `app/api` for `require` to audit
  it — a route that doesn't call a guard is unauthenticated by construction.
- **Cross-tenant access returns 404, not 403**, so ids cannot be probed.
- **Sessions**: random 32-byte id in an HttpOnly + SameSite cookie; only a
  SHA-256 hash is stored, so a database dump cannot be used to impersonate
  anyone. Revocation and role changes take effect on the next request.
- **Login**: per-IP and per-account rate limits, lockout after 8 failures,
  one generic error message (no user enumeration), constant-time comparison.
- **Password reset / email verification**: single-use tokens, stored hashed,
  claimed atomically. A reset signs out every device.
- **KYC privacy**: Aadhaar and bank account numbers are stored as last-4 plus a
  salted one-way hash — the full numbers are never persisted. Documents live
  outside `public/` and are served only to the owning seller or an admin,
  through `/api/files/[...key]`, with every admin read audited.
- **Uploads**: type determined by sniffed magic bytes, never the filename;
  random filenames; traversal-guarded paths.
- **Webhooks**: HMAC verified against the raw body; unsigned requests write
  nothing. `(provider, eventId)` is unique, so replays are no-ops.
- **Audit log**: every seller decision, KYC view, product moderation, payout
  release, refund and status override.

---

## Deploying

```bash
# 1. Managed PostgreSQL; put the connection string in DATABASE_URL
# 2. Secrets
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
CRON_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 3. Payments — register the webhook with your provider:
#    https://your-domain/api/payments/webhook/razorpay
#    events: payment.captured, payment.failed, order.paid

# 4. Storage — set STORAGE_DRIVER=S3 on any serverless host; the local
#    filesystem is not persistent there.

# 5. Migrate and build
npx prisma migrate deploy
npm run build && npm start
```

### `npm run build` typechecks before it compiles

The build is `prisma generate && tsc --noEmit && next build`, and the middle
step is there on purpose even though `next build` typechecks too.

`next build` **stops at the first type error**. One root cause spread over
sixteen files therefore looks like sixteen unrelated failures, each costing a
full remote build to discover. `tsc --noEmit` reports every error in one pass,
so a deploy either tells you everything that is wrong or nothing is.

Run `npm run typecheck` before pushing and the remote build has nothing left to
find.

### Everything `next build` needs lives in `dependencies`

There are no `devDependencies` in this project, on purpose. Managed hosts
(Render, Railway, Fly, most Docker images) install with `NODE_ENV=production`,
and npm then **skips `devDependencies` entirely**. That silently removes:

| package | needed by |
| --- | --- |
| `typescript`, `@types/*` | `next build`'s "Linting and checking validity of types" step |
| `prisma` | the `prisma generate` in `postinstall` and `prisma migrate deploy` |
| `tsx` | `npm run db:seed` |

All four are *build-time* tools, but on these hosts the build runs **inside the
production install** — so a build-time tool parked in `devDependencies` is
simply absent, and the build fails with:

```
It looks like you're trying to use TypeScript but do not have the
required package(s) installed.
```

Keeping them in `dependencies` makes the build work the same way locally, in
CI, and on any host, with no `NPM_CONFIG_PRODUCTION=false` escape hatch to
remember. The cost is a slightly larger `node_modules` on the server, which is
discarded after `next build` anyway.

Schedule the two cron endpoints (both need the `x-cron-secret` header):

```bash
*/5 * * * *  curl -XPOST -H "x-cron-secret: $CRON_SECRET" https://…/api/cron/release-reservations
0   2 * * *  curl -XPOST -H "x-cron-secret: $CRON_SECRET" https://…/api/cron/payouts
```

The first frees stock held by abandoned checkouts. The second promotes eligible
payouts to `PROCESSING` — it never marks anything `PAID`.

---

## Known limitations

These are deliberate boundaries, not oversights.

1. **Payment and refund credentials are pending.** The integrations are complete
   and signature-verified; only the keys are missing. With none set the app runs
   Cash-on-Delivery-only and *says so* in the checkout UI, rather than faking a
   card payment. Set `PAYMENT_PROVIDER` plus the keys to enable online payment.
2. **Email delivery is pending.** `EMAIL_DRIVER=LOG` prints messages to the
   server log; nothing is silently swallowed. SMTP needs one extra package
   (`npm install nodemailer`); Resend needs only an API key.
3. **Courier APIs are not integrated.** Tracking is driven by scans recorded
   through `/api/logistics/shipments/[id]/event` — honest, operator-entered
   events. Wiring a Delhivery/Shiprocket webhook to that endpoint is the
   natural next step.
4. **Private file serving on S3** needs a presigned-URL redirect adding to
   `app/api/files/[...key]/route.ts`; the local driver is complete.
5. **Rate limiting is per-instance** (in-process). Behind multiple servers,
   swap `lib/server/ratelimit.ts` for Redis — the interface is already the right
   shape. Account lockout is in the database and works across instances.
6. **Product variants** are modelled, migrated and priced end-to-end, but the
   seller UI does not yet have a variant editor — listings are single-SKU from
   the dashboard.
7. **`components/WorldMap.jsx`, `FlatMap.jsx`, `Globe3D.jsx`** are preserved
   from v1 but no longer rendered, since the pages that used them were rebuilt.
   Their CSS remains, so they can be dropped back in.
8. **No automated test runner.** The three scripts are plain `tsx` programs with
   exit codes, deliberately dependency-free. Wiring them into Vitest or Jest is
   straightforward if you want watch mode and coverage.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm run build` | `prisma generate` + production build |
| `npm start` | serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | create and apply a migration (dev) |
| `npm run db:deploy` | apply migrations (production) |
| `npm run db:push` | push the schema without a migration (prototyping) |
| `npm run db:seed` | seed demo data |
| `npm run db:reset` | **drops and recreates** the database, then seeds |
| `npm run test:marketplace` | end-to-end §33/§34 suite |
| `npx tsx scripts/test-pricing.ts` | pure-logic tests, no database |
| `npx tsx scripts/verify-schema.ts` | database-level tests, needs `psql` |
