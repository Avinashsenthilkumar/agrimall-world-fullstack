import db from '../../../../lib/db.js';
import { ok, fail } from '../../../../lib/server.js';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(params.id);
  if (!p) return fail('product not found', 404);
  return ok({ product: p });
}

// PATCH /api/products/:id  { stock?, price?, ... }
export async function PATCH(req, { params }) {
  const b = await req.json().catch(() => ({}));
  const allowed = ['name', 'price', 'mrp', 'stock', 'cat', 'img', 'descr'];
  const sets = [], args = [];
  for (const k of allowed) if (k in b) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (!sets.length) return fail('nothing to update');
  args.push(params.id);
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id=?`).run(...args);
  return ok({ product: db.prepare('SELECT * FROM products WHERE id=?').get(params.id) });
}

export async function DELETE(_req, { params }) {
  db.prepare('DELETE FROM products WHERE id=?').run(params.id);
  return ok({ deleted: params.id });
}
