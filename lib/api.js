// lib/api.js — tiny client for talking to our backend from React pages.
'use client';

async function j(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Products
  products: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return fetch('/api/products' + (q ? '?' + q : '')).then(j).then(d => d.products);
  },
  addProduct: (body) => fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j).then(d => d.product),
  updateProduct: (id, body) => fetch('/api/products/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j).then(d => d.product),

  // Orders
  orders: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return fetch('/api/orders' + (q ? '?' + q : '')).then(j).then(d => d.orders);
  },
  placeOrder: (body) => fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j).then(d => d.order),
  order: (id) => fetch('/api/orders/' + id).then(j),
  advance: (id, body = {}) => fetch(`/api/orders/${id}/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),

  // Sellers / auth
  sellers: () => fetch('/api/sellers').then(j).then(d => d.sellers),
  register: (body) => fetch('/api/sellers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j).then(d => d.seller),
  login: (email, pass) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, pass }) }).then(j),
};

export default api;
