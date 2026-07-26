// lib/server.js — helpers shared by API route handlers.
import db from './db.js';
import { NextResponse } from 'next/server';

export const ok = (data, init) => NextResponse.json({ ok: true, ...data }, init);
export const fail = (msg, status = 400) => NextResponse.json({ ok: false, error: msg }, { status });

export function newOrderId() {
  // AGM-#### that doesn't collide with existing rows.
  for (let i = 0; i < 50; i++) {
    const id = 'AGM-' + Math.floor(1000 + Math.random() * 9000);
    const hit = db.prepare('SELECT 1 FROM orders WHERE id=?').get(id);
    if (!hit) return id;
  }
  return 'AGM-' + Date.now();
}

// Full order payload with items + tracking timeline (what the UI consumes).
export function getFullOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id);
  order.tracking = db.prepare('SELECT * FROM tracking_events WHERE order_id=? ORDER BY at, id').all(id);
  return order;
}
