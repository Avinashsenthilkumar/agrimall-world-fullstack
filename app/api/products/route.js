import db from '../../../lib/db.js';
import { ok, fail } from '../../../lib/server.js';

export const dynamic = 'force-dynamic';

// GET /api/products?cat=indoor&q=snake&seller=3
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const cat = searchParams.get('cat');
  const q = searchParams.get('q');
  const seller = searchParams.get('seller');

  let sql = 'SELECT * FROM products WHERE 1=1';
  const args = [];
  if (cat && cat !== 'all') { sql += ' AND cat = ?'; args.push(cat); }
  if (seller) { sql += ' AND seller_id = ?'; args.push(seller); }
  if (q) { sql += ' AND (name LIKE ? OR lat LIKE ? OR orig LIKE ?)'; const like = `%${q}%`; args.push(like, like, like); }
  sql += ' ORDER BY id';

  const rows = db.prepare(sql).all(...args);
  return ok({ products: rows });
}

// POST /api/products  (seller adds a listing)
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.price) return fail('name and price are required');
  const info = db.prepare(`
    INSERT INTO products (name,lat,cat,img,price,mrp,orig,rating,reviews,diff,safety,descr,sku,stock,seller_id)
    VALUES (@name,@lat,@cat,@img,@price,@mrp,@orig,@rating,@reviews,@diff,@safety,@descr,@sku,@stock,@seller_id)
  `).run({
    name: b.name, lat: b.lat || '', cat: b.cat || 'indoor', img: b.img || 'https://loremflickr.com/600/600/plant',
    price: Number(b.price), mrp: Number(b.mrp) || Math.round(Number(b.price) * 1.3), orig: b.orig || '',
    rating: 4.4, reviews: 0, diff: b.diff || 'Easy', safety: b.safety || 'Non-toxic', descr: b.descr || '',
    sku: b.sku || 'AM-SLR-' + Math.floor(Math.random() * 9000), stock: Number(b.stock) || 25,
    seller_id: b.seller_id || null,
  });
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(info.lastInsertRowid);
  return ok({ product }, { status: 201 });
}
