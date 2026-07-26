// lib/db.js — real SQLite database (file-based, persistent, zero-config).
// This is the single source of truth for ALL data: products, orders,
// order items, tracking events, sellers, customers.
//
// The DB file lives at ./data/agrimall.db and survives restarts.
//
// IMPORTANT: the connection is opened LAZILY (on first real use at request
// time), never at import/build time. This keeps `next build` from trying to
// create/seed the database while it analyzes the API routes.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  PRODUCTS, CATEGORIES, NURSERIES, ALL_ORDERS, VENDORS_LIST, DEMO_SELLERS,
} from './data.js';
import { STAGES } from './tracking.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'agrimall.db');

function connect() {
  if (globalThis.__agrimall_db) return globalThis.__agrimall_db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedIfEmpty(db);
  globalThis.__agrimall_db = db;
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      lat           TEXT,
      cat           TEXT,
      img           TEXT,
      price         INTEGER NOT NULL,
      mrp           INTEGER,
      orig          TEXT,
      rating        REAL DEFAULT 4.5,
      reviews       INTEGER DEFAULT 0,
      diff          TEXT,
      light         TEXT,
      water         TEXT,
      temp          TEXT,
      safety        TEXT,
      descr         TEXT,
      sku           TEXT,
      stock         INTEGER DEFAULT 25,
      seller_id     INTEGER,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sellers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      pass          TEXT NOT NULL,
      biz_name      TEXT,
      owner_name    TEXT,
      biz_phone     TEXT,
      biz_state     TEXT,
      status        TEXT DEFAULT 'Active',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT,
      phone         TEXT,
      email         TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id            TEXT PRIMARY KEY,
      customer_name TEXT,
      phone         TEXT,
      address       TEXT,
      pincode       TEXT,
      region        TEXT,
      city          TEXT,
      subtotal      INTEGER,
      shipping      INTEGER,
      total         INTEGER,
      payment       TEXT,
      status        TEXT DEFAULT 'placed',
      seller_id     INTEGER,
      eta           TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id      TEXT NOT NULL,
      product_id    INTEGER,
      name          TEXT,
      qty           INTEGER,
      price         INTEGER,
      img           TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tracking_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id      TEXT NOT NULL,
      stage         TEXT NOT NULL,
      title         TEXT,
      note          TEXT,
      location      TEXT,
      pct           INTEGER,
      at            TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_track_order ON tracking_events(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  `);
}

function seedIfEmpty(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (count > 0) return;

  const insProduct = db.prepare(`
    INSERT INTO products (name,lat,cat,img,price,mrp,orig,rating,reviews,diff,light,water,temp,safety,descr,sku,stock,seller_id)
    VALUES (@name,@lat,@cat,@img,@price,@mrp,@orig,@rating,@reviews,@diff,@light,@water,@temp,@safety,@descr,@sku,@stock,@seller_id)
  `);
  // OR IGNORE keeps the seed safe even if it somehow runs more than once.
  const insSeller = db.prepare(`
    INSERT OR IGNORE INTO sellers (email,pass,biz_name,owner_name,biz_phone,biz_state,status)
    VALUES (@email,@pass,@biz_name,@owner_name,@biz_phone,@biz_state,@status)
  `);

  const seed = db.transaction(() => {
    for (const v of VENDORS_LIST) {
      insSeller.run({
        email: v.name.toLowerCase().replace(/[^a-z]/g, '') + '@nursery.com',
        pass: 'demo123', biz_name: v.name, owner_name: v.name.split(' ')[0],
        biz_phone: '', biz_state: v.loc, status: v.status || 'Active',
      });
    }
    for (const s of DEMO_SELLERS) {
      insSeller.run({
        email: s.email, pass: s.pass, biz_name: s.bizName, owner_name: s.ownerName,
        biz_phone: s.bizPhone, biz_state: s.bizState, status: 'Active',
      });
    }
    for (const p of PRODUCTS) {
      insProduct.run({
        name: p.name, lat: p.lat, cat: p.cat, img: p.img, price: p.price, mrp: p.mrp,
        orig: p.orig, rating: p.rating, reviews: p.reviews, diff: p.diff, light: p.light,
        water: p.water, temp: p.temp, safety: p.safety, descr: p.desc, sku: p.sku,
        stock: 10 + (p.id * 7) % 40, seller_id: null,
      });
    }
    const greenRoots = db.prepare('SELECT id FROM sellers WHERE email=?').get('green@roots.com');
    if (greenRoots) {
      for (const l of DEMO_SELLERS[0].listings) {
        insProduct.run({
          name: l.name, lat: l.lat, cat: l.cat, img: l.img, price: l.price, mrp: Math.round(l.price * 1.3),
          orig: DEMO_SELLERS[0].bizName, rating: 4.4, reviews: 0, diff: 'Easy', light: '', water: '',
          temp: '', safety: 'Non-toxic', descr: '', sku: 'AM-SLR-' + Math.floor(Math.random() * 9000),
          stock: l.stock, seller_id: greenRoots.id,
        });
      }
    }
  });
  seed();

  seedHistoricalOrders(db);
}

function seedHistoricalOrders(db) {
  const statusMap = { delivered: 'delivered', transit: 'in_transit', pending: 'placed' };
  const insOrder = db.prepare(`
    INSERT OR IGNORE INTO orders (id,customer_name,region,city,subtotal,shipping,total,payment,status,eta,created_at,updated_at)
    VALUES (@id,@customer_name,@region,@city,@subtotal,@shipping,@total,@payment,@status,@eta,@created_at,@created_at)
  `);
  const insItem = db.prepare(`INSERT INTO order_items (order_id,name,qty,price) VALUES (?,?,?,?)`);
  const insEvent = db.prepare(`INSERT INTO tracking_events (order_id,stage,title,note,location,pct,at) VALUES (?,?,?,?,?,?,?)`);

  const tx = db.transaction(() => {
    for (const o of ALL_ORDERS) {
      const status = statusMap[o.status] || 'placed';
      const total = parseInt(String(o.total).replace(/[₹,]/g, '')) || 0;
      const created = new Date(Date.now() - Math.floor(Math.random() * 6 + 1) * 86400000).toISOString();
      const eta = new Date(Date.now() + (status === 'delivered' ? -86400000 : 3 * 86400000)).toISOString();
      insOrder.run({
        id: o.id, customer_name: o.customer, region: o.region, city: o.city,
        subtotal: total, shipping: 0, total, payment: 'card', status, eta, created_at: created,
      });
      insItem.run(o.id, o.items, 1, total);
      const idx = STAGES.findIndex(s => s.key === status);
      for (let i = 0; i <= idx; i++) {
        const st = STAGES[i];
        const at = new Date(new Date(created).getTime() + i * 8 * 3600000).toISOString();
        insEvent.run(o.id, st.key, st.title, st.note, st.location(o.region), st.pct, at);
      }
    }
  });
  tx();
}

// Lazy proxy: the real connection (and seeding) happens only when a route
// actually touches the database at request time — NOT when this module is
// imported during `next build`.
const db = new Proxy({}, {
  get(_target, prop) {
    const real = connect();
    const value = real[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export { db };
export default db;