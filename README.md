# Agri Mall — Full-Stack Plant Marketplace

A working marketplace with a **real backend, a real database, and a real order + tracking
lifecycle**. Nothing on the order/tracking path is faked anymore: a customer places an
order, it lands in a database, a seller/admin/vendor confirms and moves it through the
shipping stages, and the customer watches the status update live.

---

## Run it

```bash
npm install        # installs Next.js, React, and better-sqlite3 (the database)
npm run dev        # http://localhost:3000
```

First run creates and seeds the database automatically at `data/agrimall.db`.
It persists across restarts. To reset, delete the `data/` folder.

```bash
npm run build && npm run start   # production
```

Demo seller login (role screen → "Returning Seller"): `green@roots.com` / `demo123`

---

## Architecture

```
Browser (React pages)  ──fetch──►  Next.js API routes  ──►  SQLite database
  lib/api.js                        app/api/**/route.js       lib/db.js  (data/agrimall.db)
                                     lib/tracking.js  ← order lifecycle state machine
```

- **Database** — `lib/db.js`. A real SQL database (SQLite via `better-sqlite3`). Tables:
  `products, sellers, customers, orders, order_items, tracking_events`. Self-creates and
  seeds from `lib/data.js` on first run.
- **Backend / REST API** — `app/api/**`:
  | Method & path | Purpose |
  |---|---|
  | `GET  /api/products` | list / filter (`?cat=`, `?q=`, `?seller=`) |
  | `POST /api/products` | seller adds a listing |
  | `PATCH /api/products/:id` | update stock / price |
  | `GET  /api/orders` | list (admin=all, `?region=` for vendor, `?seller=` for seller) |
  | `POST /api/orders` | **customer places an order** |
  | `GET  /api/orders/:id` | **live tracking** — order + timeline + stage ladder + ETA |
  | `POST /api/orders/:id/advance` | **the "scan"** — move parcel to next stage |
  | `POST /api/sellers` | register (from KYC onboarding) |
  | `POST /api/auth/login` | seller sign-in |
- **Client** — `lib/api.js` is the thin fetch wrapper every page uses.

---

## The order flow (what you asked for)

1. **Customer** adds to cart → checkout → pays (demo gateway) → `POST /api/orders`.
   A real row is written with status `placed`, an ETA, and the first tracking event.
   Stock is decremented.
2. The order now appears in the **Admin**, **Vendor** (if in their region), and **Seller**
   (if it's their product) dashboards.
3. They click the action button to **Confirm**, then advance it stage by stage. Each click
   is a `POST /api/orders/:id/advance` that appends a timestamped tracking event.
4. The **customer's tracking screen polls `GET /api/orders/:id` every 3s** and updates live —
   so as soon as someone confirms/ships in another tab, the customer sees it move.

Track any order from the customer top-nav → **Track Order** → enter the ID (e.g. `AGM-4821`).

---

## How product tracking works (shipping → out for delivery → arriving)

A parcel doesn't know where it is — **its status is whatever the last handler recorded**.
Real couriers scan a package at each hub and that scan writes an event; the app just reads
the stream of events. This project models exactly that.

`lib/tracking.js` defines the ordered lifecycle:

| Stage | % | Location shown | Meaning |
|---|---|---|---|
| `placed` | 8 | Agri Mall Platform | payment received |
| `confirmed` | 22 | Nursery Partner | seller accepted, stock reserved |
| `packed` | 40 | Nursery Packing Bay | boxed with phytosanitary care |
| `dispatched` | 58 | Origin Hub | handed to courier |
| `in_transit` | 76 | Regional Hub inbound | moving to your hub |
| `out_for_delivery` | 92 | last mile | on the delivery vehicle |
| `delivered` | 100 | Your Address | arrived |

- **Expected arrival (ETA)** is computed when the seller confirms: ~3 days domestic (India),
  ~7 international. Shown to the customer as "Expected arrival".
- The **hub name** adapts to the destination (Chennai Hub for Tamil Nadu, Kochi for Kerala,
  Frankfurt/JFK/Dubai gateways for international, etc.).
- **Stages can't be skipped** — the API only allows moving one step forward (or cancel before
  dispatch). This mirrors real logistics and prevents inconsistent tracking.

### Going further (real couriers)
To use a live carrier instead of manual advances, replace the `advance` calls with a webhook:
carriers like Delhivery, Shiprocket, DHL, or Shippo send a POST every time they scan a
parcel. Point that webhook at a route that maps the carrier's status to one of the stages
above and inserts a `tracking_events` row — the customer UI needs no changes.

---

## Notes
- The catalog images use loremflickr placeholders (as in the original).
- The payment gateway is a demo — no real charge. Swap `processPayment` for Razorpay/Stripe
  when you go live.
- The database file (`data/agrimall.db`) is git-ignored; delete it to reseed.
