// Toast notifications, rendered into the #toast-wrap element in the layout.
'use client';

export type ToastKind = 'info' | 'success' | 'error';

export function toast(message: string, kind: ToastKind = 'info', ms = 3600) {
  if (typeof document === 'undefined') return;
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;

  const el = document.createElement('div');
  el.className = 'toast';
  if (kind === 'error') {
    el.style.borderLeft = '3px solid var(--red)';
  } else if (kind === 'success') {
    el.style.borderLeft = '3px solid var(--green)';
  }
  el.textContent = message;
  wrap.appendChild(el);

  // Errors deserve longer on screen than a confirmation.
  const life = kind === 'error' ? Math.max(ms, 5200) : ms;
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 320);
  }, life);
}

export const toastError = (msg: string) => toast(msg, 'error');
export const toastSuccess = (msg: string) => toast(msg, 'success');
