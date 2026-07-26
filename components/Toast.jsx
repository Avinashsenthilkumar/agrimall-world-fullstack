'use client';
export function toast(msg) {
  if (typeof document === 'undefined') return;
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
export default function ToastHost() { return null; }
