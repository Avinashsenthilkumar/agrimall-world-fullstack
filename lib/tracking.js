// lib/tracking.js — the order lifecycle state machine.
//
// HOW REAL TRACKING WORKS (and how it works here):
// A parcel doesn't "know" where it is. Its status is whatever the last
// person to handle it recorded. In real logistics, a courier SCANS the
// package at each hub and that scan writes a timestamped event. The customer
// app just reads that stream of events.
//
// We model exactly that: each order moves through ordered STAGES. Whenever
// a seller/admin/vendor advances an order (a "scan"), we append a
// tracking_event row with the time, location and note, and bump the order's
// status + ETA. The customer's tracking screen reads those events live.

export const STAGES = [
  { key: 'placed',          title: 'Order Placed',       note: 'Payment received via Agri Mall.',                    pct: 8,   icon: '📝', location: r => 'Agri Mall Platform' },
  { key: 'confirmed',       title: 'Confirmed by Seller', note: 'Nursery accepted your order and reserved stock.',    pct: 22,  icon: '✅', location: r => 'Nursery Partner' },
  { key: 'packed',          title: 'Packed for Transit', note: 'Plant boxed with moisture & phytosanitary care.',    pct: 40,  icon: '📦', location: r => 'Nursery Packing Bay' },
  { key: 'dispatched',      title: 'Dispatched',         note: 'Handed to the courier partner.',                     pct: 58,  icon: '🚚', location: r => 'Origin Hub' },
  { key: 'in_transit',      title: 'In Transit',         note: 'Moving toward your regional hub.',                   pct: 76,  icon: '✈️', location: r => `${regionHub(r)} inbound` },
  { key: 'out_for_delivery',title: 'Out for Delivery',   note: 'On the delivery vehicle — arriving today.',          pct: 92,  icon: '🛻', location: r => `${regionHub(r)} — last mile` },
  { key: 'delivered',       title: 'Delivered',          note: 'Your plant arrived healthy and ready to grow!',      pct: 100, icon: '🌿', location: r => 'Your Address' },
];

// A short-circuit terminal state.
export const CANCELLED = { key: 'cancelled', title: 'Cancelled', note: 'This order was cancelled.', pct: 0, icon: '✖️' };

export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

export function stageMeta(key) {
  if (key === 'cancelled') return CANCELLED;
  return STAGES[STAGE_INDEX[key]] || STAGES[0];
}

export function nextStageKey(currentKey) {
  const i = STAGE_INDEX[currentKey];
  if (i === undefined || i >= STAGES.length - 1) return null;
  return STAGES[i + 1].key;
}

// Guard: you can only move forward one step, or cancel (before dispatch).
export function canAdvance(currentKey, targetKey) {
  if (targetKey === 'cancelled') return STAGE_INDEX[currentKey] < STAGE_INDEX['dispatched'];
  const ci = STAGE_INDEX[currentKey];
  const ti = STAGE_INDEX[targetKey];
  if (ci === undefined || ti === undefined) return false;
  return ti === ci + 1; // strictly the next stage
}

function regionHub(region = '') {
  const r = region.toLowerCase();
  if (r.includes('kerala')) return 'Kochi Hub';
  if (r.includes('tamil')) return 'Chennai Hub';
  if (r.includes('andhra')) return 'Vijayawada Hub';
  if (r.includes('karnataka')) return 'Bengaluru Hub';
  if (r.includes('germany') || r.includes('united kingdom') || r.includes('uk')) return 'Frankfurt Gateway';
  if (r.includes('united states') || r.includes('usa')) return 'JFK Gateway';
  if (r.includes('uae') || r.includes('dubai')) return 'Dubai Gateway';
  if (r.includes('japan')) return 'Osaka Hub';
  return 'Regional Hub';
}

// Estimated arrival: domestic ~3 days from confirmation, international ~7.
export function computeEta(region = '', fromDate = new Date()) {
  const r = region.toLowerCase();
  const domestic = r.includes('india') || r.includes('kerala') || r.includes('tamil') ||
    r.includes('andhra') || r.includes('karnataka');
  const days = domestic ? 3 : 7;
  return new Date(fromDate.getTime() + days * 86400000).toISOString();
}

export function buildEvent(stageKey, region) {
  const s = stageMeta(stageKey);
  return {
    stage: s.key,
    title: s.title,
    note: s.note,
    location: s.location ? s.location(region) : '',
    pct: s.pct,
  };
}
