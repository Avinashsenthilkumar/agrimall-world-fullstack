import { ok, fail, getFullOrder } from '../../../../lib/server.js';
import { STAGES, stageMeta } from '../../../../lib/tracking.js';

export const dynamic = 'force-dynamic';

// GET /api/orders/:id — the customer's live tracking view reads this.
// Returns the order, its items, the recorded tracking events, plus the
// full stage ladder with a done/current flag so the UI can render progress.
export async function GET(_req, { params }) {
  const order = getFullOrder(params.id);
  if (!order) return fail('order not found', 404);

  const meta = stageMeta(order.status);
  const currentIdx = STAGES.findIndex(s => s.key === order.status);
  const ladder = STAGES.map((s, i) => ({
    key: s.key, title: s.title, note: s.note, icon: s.icon, pct: s.pct,
    done: order.status !== 'cancelled' && i < currentIdx,
    current: s.key === order.status,
  }));

  return ok({
    order,
    progress: meta.pct,
    currentStage: order.status,
    currentTitle: meta.title,
    eta: order.eta,
    ladder,
  });
}
