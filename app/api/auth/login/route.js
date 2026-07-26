import db from '../../../../lib/db.js';
import { ok, fail } from '../../../../lib/server.js';

export const dynamic = 'force-dynamic';

// POST /api/auth/login  { email, pass }  -> seller session
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.email || !b.pass) return fail('email and password required');
  const s = db.prepare('SELECT * FROM sellers WHERE lower(email)=lower(?) AND pass=?').get(b.email, b.pass);
  if (!s) return fail('credentials not found', 401);

  const listings = db.prepare('SELECT * FROM products WHERE seller_id=?').all(s.id);
  const orders = db.prepare('SELECT * FROM orders WHERE seller_id=? ORDER BY created_at DESC').all(s.id).map(o => {
    o.itemsLabel = db.prepare('SELECT name,qty FROM order_items WHERE order_id=?').all(o.id)
      .map(i => `${i.name}${i.qty > 1 ? ' x' + i.qty : ''}`).join(', ');
    return o;
  });
  return ok({ seller: { ...s, pass: undefined }, listings, orders });
}
