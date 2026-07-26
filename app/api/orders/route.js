import db from '../../../lib/db.js';
import { ok, fail, newOrderId, getFullOrder } from '../../../lib/server.js';
import { buildEvent, computeEta } from '../../../lib/tracking.js';

export const dynamic = 'force-dynamic';

// GET /api/orders?status=placed&region=Tamil&seller=3
// Used by admin (all), vendor (region), seller (seller_id).
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const region = searchParams.get('region');
  const seller = searchParams.get('seller');

  let sql = 'SELECT * FROM orders WHERE 1=1';
  const args = [];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (region) { sql += ' AND region LIKE ?'; args.push(`%${region}%`); }
  if (seller) { sql += ' AND seller_id = ?'; args.push(seller); }
  sql += ' ORDER BY created_at DESC';

  const orders = db.prepare(sql).all(...args).map(o => {
    o.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
    o.itemsLabel = o.items.map(i => `${i.name}${i.qty > 1 ? ' x' + i.qty : ''}`).join(', ');
    return o;
  });
  return ok({ orders });
}

// POST /api/orders  — customer places an order. Creates the order, its items,
// and the FIRST tracking event ("placed"). Status starts at 'placed' and
// waits for a seller/admin to confirm before tracking advances.
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return fail('cart is empty');
  if (!b.customerName || !b.address) return fail('name and address are required');

  const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
  const shipping = subtotal > 2000 ? 0 : 149;
  const total = subtotal + shipping;
  const region = b.region || 'India';
  const id = newOrderId();

  // Route to a seller: prefer the seller who owns the first product.
  let sellerId = null;
  const first = items[0];
  if (first?.product_id) {
    const prod = db.prepare('SELECT seller_id FROM products WHERE id=?').get(first.product_id);
    sellerId = prod?.seller_id ?? null;
  }

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO orders (id,customer_name,phone,address,pincode,region,city,subtotal,shipping,total,payment,status,seller_id,eta)
      VALUES (@id,@customer_name,@phone,@address,@pincode,@region,@city,@subtotal,@shipping,@total,@payment,'placed',@seller_id,@eta)
    `).run({
      id, customer_name: b.customerName, phone: b.phone || '', address: b.address,
      pincode: b.pincode || '', region, city: b.city || '', subtotal, shipping, total,
      payment: b.payment || 'card', seller_id: sellerId, eta: computeEta(region),
    });

    const insItem = db.prepare('INSERT INTO order_items (order_id,product_id,name,qty,price,img) VALUES (?,?,?,?,?,?)');
    for (const i of items) insItem.run(id, i.product_id || null, i.name, i.qty, i.price, i.img || '');

    const ev = buildEvent('placed', region);
    db.prepare('INSERT INTO tracking_events (order_id,stage,title,note,location,pct) VALUES (?,?,?,?,?,?)')
      .run(id, ev.stage, ev.title, ev.note, ev.location, ev.pct);

    // Reduce stock.
    for (const i of items) if (i.product_id) db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id=?').run(i.qty, i.product_id);
  });
  tx();

  return ok({ order: getFullOrder(id) }, { status: 201 });
}
