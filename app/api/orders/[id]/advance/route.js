import db from '../../../../../lib/db.js';
import { ok, fail, getFullOrder } from '../../../../../lib/server.js';
import { nextStageKey, canAdvance, buildEvent, computeEta, stageMeta } from '../../../../../lib/tracking.js';

export const dynamic = 'force-dynamic';

// POST /api/orders/:id/advance
//   body: { to?: 'confirmed' }  -> jump to a specific next stage (or 'cancelled')
//   body: {}                    -> advance to the very next stage
//
// This is the "scan event". Sellers confirm; admin/vendor move the parcel
// through the hubs. Each call appends a tracking_event and updates the order.
export async function POST(req, { params }) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(params.id);
  if (!order) return fail('order not found', 404);
  if (order.status === 'delivered') return fail('order already delivered');
  if (order.status === 'cancelled') return fail('order was cancelled');

  const b = await req.json().catch(() => ({}));
  const target = b.to || nextStageKey(order.status);
  if (!target) return fail('no further stage — order is complete');
  if (!canAdvance(order.status, target)) return fail(`cannot move from ${order.status} to ${target}`);

  const ev = buildEvent(target, order.region);
  const note = b.note || ev.note;

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO tracking_events (order_id,stage,title,note,location,pct) VALUES (?,?,?,?,?,?)')
      .run(order.id, ev.stage, ev.title, note, ev.location, ev.pct);

    // When a seller confirms, (re)compute the ETA from that moment.
    const eta = target === 'confirmed' ? computeEta(order.region) : order.eta;
    db.prepare("UPDATE orders SET status=?, eta=?, updated_at=datetime('now') WHERE id=?")
      .run(target, eta, order.id);
  });
  tx();

  return ok({ order: getFullOrder(order.id), stage: stageMeta(target) });
}
