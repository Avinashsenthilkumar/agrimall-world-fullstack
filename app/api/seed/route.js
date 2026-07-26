import db from '../../../lib/db.js';
import { ok } from '../../../lib/server.js';

export const dynamic = 'force-dynamic';

// GET /api/seed — reports current row counts (proves the DB is live).
export async function GET() {
  const counts = {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    sellers: db.prepare('SELECT COUNT(*) c FROM sellers').get().c,
    tracking_events: db.prepare('SELECT COUNT(*) c FROM tracking_events').get().c,
  };
  return ok({ counts });
}
