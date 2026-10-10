// lib/shared/order-status.ts
//
// §15 — "Do not allow arbitrary status changes. Use a server-side status
// transition system."
//
// Two machines live here:
//
//  1. SellerOrder  — the real lifecycle, driven by the seller/logistics/admin.
//  2. Order        — DERIVED. The customer-facing status is never set by hand;
//                    it is recomputed from the set of its seller orders, which
//                    is what makes PARTIALLY_SHIPPED / PARTIALLY_DELIVERED
//                    correct for a multi-vendor basket.
//
// Zero dependencies — unit-testable in isolation.

export type Role = 'CUSTOMER' | 'SELLER' | 'ADMIN' | 'LOGISTICS';

export type SellerOrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PACKING'
  | 'READY_FOR_PICKUP'
  | 'SHIPPED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED'
  | 'REFUNDED';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'PARTIALLY_SHIPPED'
  | 'SHIPPED'
  | 'PARTIALLY_DELIVERED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'PARTIALLY_CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/**
 * The only legal moves. Anything not listed is rejected — including
 * "forward" jumps like PENDING → SHIPPED that skip fulfilment steps.
 */
const SELLER_ORDER_TRANSITIONS: Record<SellerOrderStatus, SellerOrderStatus[]> = {
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PACKING', 'CANCELLED'],
  PACKING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'IN_TRANSIT'], // failed attempt goes back to transit
  DELIVERED: ['RETURN_REQUESTED'],
  RETURN_REQUESTED: ['RETURNED', 'DELIVERED'], // rejected return reverts
  RETURNED: ['REFUNDED'],
  REFUNDED: [],
  CANCELLED: [],
};

/**
 * Who may perform each transition.
 *   - SELLER   runs its own fulfilment up to handover.
 *   - LOGISTICS owns the in-transit legs (courier scans).
 *   - ADMIN    can do anything (support overrides), and is audit-logged.
 *   - CUSTOMER may only cancel before handover and request a return.
 */
const TRANSITION_ROLES: Partial<Record<`${SellerOrderStatus}->${SellerOrderStatus}`, Role[]>> = {
  'PENDING->ACCEPTED': ['SELLER', 'ADMIN'],
  'PENDING->CANCELLED': ['SELLER', 'ADMIN', 'CUSTOMER'],
  'ACCEPTED->PACKING': ['SELLER', 'ADMIN'],
  'ACCEPTED->CANCELLED': ['SELLER', 'ADMIN', 'CUSTOMER'],
  'PACKING->READY_FOR_PICKUP': ['SELLER', 'ADMIN'],
  'PACKING->CANCELLED': ['SELLER', 'ADMIN'],
  'READY_FOR_PICKUP->SHIPPED': ['SELLER', 'ADMIN', 'LOGISTICS'],
  'READY_FOR_PICKUP->CANCELLED': ['SELLER', 'ADMIN'],
  'SHIPPED->IN_TRANSIT': ['LOGISTICS', 'ADMIN'],
  'SHIPPED->OUT_FOR_DELIVERY': ['LOGISTICS', 'ADMIN'],
  'SHIPPED->DELIVERED': ['LOGISTICS', 'ADMIN'],
  'IN_TRANSIT->OUT_FOR_DELIVERY': ['LOGISTICS', 'ADMIN'],
  'IN_TRANSIT->DELIVERED': ['LOGISTICS', 'ADMIN'],
  'OUT_FOR_DELIVERY->DELIVERED': ['LOGISTICS', 'ADMIN'],
  'OUT_FOR_DELIVERY->IN_TRANSIT': ['LOGISTICS', 'ADMIN'],
  'DELIVERED->RETURN_REQUESTED': ['CUSTOMER', 'ADMIN'],
  'RETURN_REQUESTED->RETURNED': ['SELLER', 'ADMIN', 'LOGISTICS'],
  'RETURN_REQUESTED->DELIVERED': ['SELLER', 'ADMIN'],
  'RETURNED->REFUNDED': ['ADMIN'],
};

/** Statuses from which nothing further can happen. */
export const TERMINAL_SELLER_ORDER_STATUSES: SellerOrderStatus[] = ['CANCELLED', 'REFUNDED'];

/** After this point the parcel has left the nursery; the customer can't cancel. */
export const POST_HANDOVER_STATUSES: SellerOrderStatus[] = [
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURN_REQUESTED',
  'RETURNED',
  'REFUNDED',
];

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
}

export function canTransitionSellerOrder(
  from: SellerOrderStatus,
  to: SellerOrderStatus,
  role: Role,
): TransitionCheck {
  if (from === to) return { allowed: false, reason: `order is already ${to}` };

  const legal = SELLER_ORDER_TRANSITIONS[from];
  if (!legal) return { allowed: false, reason: `unknown status ${from}` };
  if (!legal.includes(to)) {
    return {
      allowed: false,
      reason: `cannot move from ${from} to ${to} (allowed: ${legal.join(', ') || 'none'})`,
    };
  }

  const roles = TRANSITION_ROLES[`${from}->${to}`];
  if (!roles) return { allowed: false, reason: `transition ${from}->${to} has no role policy` };
  if (!roles.includes(role)) {
    return { allowed: false, reason: `role ${role} may not move an order from ${from} to ${to}` };
  }

  return { allowed: true };
}

/** The natural "next step" button a seller sees for a sub-order. */
export function nextSellerOrderStatus(from: SellerOrderStatus): SellerOrderStatus | null {
  const happyPath: SellerOrderStatus[] = [
    'PENDING',
    'ACCEPTED',
    'PACKING',
    'READY_FOR_PICKUP',
    'SHIPPED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ];
  const i = happyPath.indexOf(from);
  if (i === -1 || i === happyPath.length - 1) return null;
  return happyPath[i + 1];
}

/** Human labels for the dashboards (preserves v1's button wording). */
export const SELLER_ORDER_ACTION_LABEL: Record<string, string> = {
  ACCEPTED: 'Accept Order',
  PACKING: 'Mark Packed',
  READY_FOR_PICKUP: 'Ready for Pickup',
  SHIPPED: 'Dispatch',
  IN_TRANSIT: 'Mark In Transit',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Mark Delivered',
};

// ---------------------------------------------------------------------------
// Derived customer-facing order status
// ---------------------------------------------------------------------------

export interface SellerOrderSnapshot {
  status: SellerOrderStatus;
}

/**
 * Recompute the parent Order status from its seller orders.
 *
 * Called after every seller-order transition. This is what lets ONE customer
 * order honestly say "partially shipped" when seller A has dispatched and
 * seller B is still packing — the thing a single `orders.status` column with
 * one seller could never express.
 */
export function deriveOrderStatus(
  sellerOrders: SellerOrderSnapshot[],
  payment: { captured: boolean; failed?: boolean },
): OrderStatus {
  if (!payment.captured) return payment.failed ? 'PAYMENT_FAILED' : 'PENDING_PAYMENT';
  if (sellerOrders.length === 0) return 'CONFIRMED';

  const statuses = sellerOrders.map((s) => s.status);
  const count = (...wanted: SellerOrderStatus[]) =>
    statuses.filter((s) => wanted.includes(s)).length;

  const total = statuses.length;
  const cancelled = count('CANCELLED');
  const refunded = count('REFUNDED');
  const returned = count('RETURNED');
  const delivered = count('DELIVERED', 'RETURN_REQUESTED');
  const shipped = count('SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY');

  // Everything ended the same way.
  if (refunded === total) return 'REFUNDED';
  if (cancelled === total) return 'CANCELLED';
  if (delivered === total) return 'DELIVERED';

  // Partial end states — report the most significant one first.
  if (refunded > 0 || returned > 0) return 'PARTIALLY_REFUNDED';
  if (cancelled > 0) return 'PARTIALLY_CANCELLED';

  // Live states. "Active" excludes anything already finished.
  const active = statuses.filter((s) => s !== 'CANCELLED' && s !== 'REFUNDED');
  const activeDelivered = active.filter((s) => s === 'DELIVERED' || s === 'RETURN_REQUESTED').length;
  const activeShipped = active.filter((s) =>
    (['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] as SellerOrderStatus[]).includes(s),
  ).length;

  if (activeDelivered === active.length && active.length > 0) return 'DELIVERED';
  if (activeDelivered > 0) return 'PARTIALLY_DELIVERED';
  if (activeShipped === active.length && active.length > 0) return 'SHIPPED';
  if (activeShipped > 0 || shipped > 0) return 'PARTIALLY_SHIPPED';

  // Nothing has shipped yet. Has any seller started work?
  if (active.some((s) => s !== 'PENDING')) return 'PROCESSING';
  return 'CONFIRMED';
}

// ---------------------------------------------------------------------------
// Shipment + tracking mapping
// ---------------------------------------------------------------------------

export type ShipmentStatus =
  | 'PENDING'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'ARRIVED_AT_HUB'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED_DELIVERY'
  | 'RETURNED';

export type TrackingEventType =
  | 'ORDER_CONFIRMED'
  | 'PACKED'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'ARRIVED_AT_HUB'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURN_PICKED_UP'
  | 'RETURN_DELIVERED';

/**
 * Each seller-order transition writes a real tracking event against that
 * seller's shipment. This is the honest version of v1's fake timeline: a
 * parcel's status is whatever the last handler recorded.
 */
export const STATUS_TO_TRACKING_EVENT: Partial<Record<SellerOrderStatus, TrackingEventType>> = {
  ACCEPTED: 'ORDER_CONFIRMED',
  PACKING: 'PACKED',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  SHIPPED: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURN_DELIVERED',
};

export const STATUS_TO_SHIPMENT_STATUS: Partial<Record<SellerOrderStatus, ShipmentStatus>> = {
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  SHIPPED: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURNED',
};

/** Progress percentage for the customer's tracking bar. */
export const TRACKING_PROGRESS: Record<SellerOrderStatus, number> = {
  PENDING: 8,
  ACCEPTED: 22,
  PACKING: 40,
  READY_FOR_PICKUP: 52,
  SHIPPED: 64,
  IN_TRANSIT: 76,
  OUT_FOR_DELIVERY: 92,
  DELIVERED: 100,
  RETURN_REQUESTED: 100,
  RETURNED: 100,
  REFUNDED: 100,
  CANCELLED: 0,
};

/** The ladder the customer tracking UI renders, in order. */
export const CUSTOMER_TRACKING_LADDER: Array<{
  status: SellerOrderStatus;
  title: string;
  note: string;
  icon: string;
}> = [
  { status: 'PENDING', title: 'Order Placed', note: 'Payment confirmed by Agri Mall.', icon: '📝' },
  { status: 'ACCEPTED', title: 'Confirmed by Seller', note: 'Nursery accepted your order and reserved stock.', icon: '✅' },
  { status: 'PACKING', title: 'Packed for Transit', note: 'Plant boxed with moisture & phytosanitary care.', icon: '📦' },
  { status: 'READY_FOR_PICKUP', title: 'Ready for Pickup', note: 'Waiting for the courier to collect.', icon: '🏷️' },
  { status: 'SHIPPED', title: 'Dispatched', note: 'Handed to the courier partner.', icon: '🚚' },
  { status: 'IN_TRANSIT', title: 'In Transit', note: 'Moving toward your regional hub.', icon: '✈️' },
  { status: 'OUT_FOR_DELIVERY', title: 'Out for Delivery', note: 'On the delivery vehicle — arriving today.', icon: '🛻' },
  { status: 'DELIVERED', title: 'Delivered', note: 'Your plant arrived healthy and ready to grow!', icon: '🌿' },
];

export function ladderIndex(status: SellerOrderStatus): number {
  return CUSTOMER_TRACKING_LADDER.findIndex((s) => s.status === status);
}
