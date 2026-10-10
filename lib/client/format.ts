// lib/client/format.ts — display helpers.
//
// The server works entirely in paise (integers). The UI is the only place
// rupees exist, and this is the only place the conversion happens.

export function money(paise: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (paise == null || !Number.isFinite(paise)) return '—';
  const rupees = paise / 100;
  const hasPaise = paise % 100 !== 0;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: opts.decimals ?? hasPaise ? 2 : 0,
    maximumFractionDigits: opts.decimals ?? hasPaise ? 2 : 0,
  })}`;
}

export function discountPercent(price: number, compareAt?: number | null): number | null {
  if (!compareAt || compareAt <= price) return null;
  return Math.round((1 - price / compareAt) * 100);
}

export function stars(rating: number): string {
  const full = Math.floor(rating);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

export function dateShort(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return dateShort(d);
}

/** PENDING_REVIEW → "Pending review" */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .map((w, i) => (i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

/** Maps a status onto the existing CSS pill classes in globals.css. */
export function statusPillClass(status: string): string {
  const s = status.toUpperCase();
  if (['DELIVERED', 'APPROVED', 'ACTIVE', 'PAID', 'CAPTURED', 'COMPLETED', 'PUBLISHED'].includes(s)) {
    return 'sp-delivered';
  }
  if (['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'PROCESSING', 'PARTIALLY_SHIPPED', 'PICKED_UP'].includes(s)) {
    return 'sp-transit';
  }
  if (['PENDING', 'PENDING_PAYMENT', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP', 'DRAFT'].includes(s)) {
    return 'sp-pending';
  }
  if (['UNDER_REVIEW', 'RETURN_REQUESTED', 'ON_HOLD', 'PARTIALLY_REFUNDED', 'PARTIALLY_DELIVERED', 'PARTIALLY_CANCELLED'].includes(s)) {
    return 'sp-review';
  }
  return 'sp-active';
}
