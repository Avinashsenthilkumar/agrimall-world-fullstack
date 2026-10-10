// lib/client/api.ts — the browser's typed gateway to the API.
//
// Notes on design:
//  - `credentials: 'same-origin'` so the HttpOnly session cookie travels; the
//    browser never handles a token itself.
//  - Errors become an ApiClientError carrying the server's safe message plus
//    per-field errors, so forms can render messages next to inputs.
//  - NOTHING here ever sends a price, a total or a sellerId. Compare with v1,
//    where `placeOrder` posted the price from `PRODUCTS`.
'use client';

export interface FieldErrors {
  [field: string]: string[];
}

export class ApiClientError extends Error {
  status: number;
  code: string;
  fields?: FieldErrors;

  constructor(status: number, code: string, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** First error for a given field, for inline form display. */
  fieldError(name: string): string | undefined {
    return this.fields?.[name]?.[0];
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;

  let url = path;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      credentials: 'same-origin',
      headers: {
        ...(rest.body && !(rest.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...rest.headers,
      },
    });
  } catch {
    throw new ApiClientError(0, 'NETWORK', 'Could not reach the server. Check your connection.');
  }

  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string; code: string; fields?: FieldErrors }
    | null;

  if (!payload) {
    throw new ApiClientError(res.status, 'BAD_RESPONSE', 'The server returned an unreadable response.');
  }

  if (!res.ok || payload.ok === false) {
    const err = payload as { error?: string; code?: string; fields?: FieldErrors };
    throw new ApiClientError(
      res.status,
      err.code ?? 'ERROR',
      err.error ?? 'Something went wrong.',
      err.fields,
    );
  }

  return payload.data;
}

const get = <T>(path: string, query?: Record<string, string | number | boolean | undefined>) =>
  request<T>(path, { method: 'GET', query });
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type Role = 'CUSTOMER' | 'SELLER' | 'ADMIN' | 'LOGISTICS';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  sellerId: string | null;
  sellerStatus: string | null;
  customerId: string | null;
}

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  latinName: string | null;
  price: number;
  compareAtPrice: number | null;
  imageUrl: string | null;
  rating: number;
  reviewCount: number;
  category: { slug: string; name: string };
  seller: { id: string; businessName: string; slug: string; city: string | null; state: string | null };
  careDifficulty: string | null;
  careSafety: string | null;
  originLabel: string | null;
  inStock: boolean;
  lowStock: boolean;
}

export interface Pagination {
  page: number;
  perPage: number;
  total: number;
  pages: number;
}

export interface CartGroup {
  seller: { id: string; businessName: string; slug?: string };
  lines: Array<{
    cartItemId?: string;
    productId: string;
    variantId: string | null;
    name: string;
    slug?: string;
    imageUrl?: string | null;
    variantLabel?: string | null;
    unitPrice: number;
    compareAtPrice: number | null;
    quantity: number;
    lineSubtotal: number;
    lineDiscount: number;
    lineTax: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discount: number;
  tax: number;
  shippingFee: number;
  total: number;
}

export interface CartTotals {
  subtotal: number;
  discount: number;
  tax: number;
  shippingFee: number;
  grandTotal: number;
  itemCount: number;
  sellerCount: number;
}

export interface Parcel {
  id: string;
  sellerOrderNumber: string;
  status: string;
  seller: { id: string; name: string; slug: string; location: string };
  items: Array<{
    id: string;
    name: string;
    sku: string;
    image: string | null;
    variant: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
    productId: string;
    reviewable: boolean;
    reviewed: boolean;
  }>;
  totals: { subtotal: number; discount: number; tax: number; shippingFee: number; total: number };
  shipment: {
    id: string;
    courier: string | null;
    trackingNumber: string | null;
    status: string;
    estimatedDelivery: string | null;
    deliveredAt: string | null;
  } | null;
  progress: number;
  ladder: Array<{
    status: string;
    title: string;
    note: string;
    icon: string;
    done: boolean;
    current: boolean;
    at: string | null;
    location: string | null;
    message: string | null;
  }>;
  events: Array<{ status: string; location: string | null; message: string | null; at: string }>;
  cancellable: boolean;
  returnable: boolean;
  returns: Array<{ id: string; returnNumber: string; status: string }>;
}

// ---------------------------------------------------------------------------
// The API surface
// ---------------------------------------------------------------------------

export const api = {
  // --- auth --------------------------------------------------------------
  auth: {
    me: () => get<{ user: SessionUser | null; unreadNotifications?: number }>('/api/auth/me'),
    login: (email: string, password: string) =>
      post<{ user: SessionUser; redirectTo: string }>('/api/auth/login', { email, password }),
    logout: () => post<{ signedOut: boolean }>('/api/auth/logout'),
    register: (body: { name: string; email: string; phone?: string; password: string }) =>
      post<{ user: SessionUser }>('/api/auth/register', body),
    forgotPassword: (email: string) => post<{ message: string }>('/api/auth/password/forgot', { email }),
    resetPassword: (token: string, password: string) =>
      post<{ message: string }>('/api/auth/password/reset', { token, password }),
    changePassword: (currentPassword: string, newPassword: string) =>
      post<{ message: string }>('/api/auth/password/change', { currentPassword, newPassword }),
    verifyEmail: (token: string) => post<{ verified: boolean }>('/api/auth/verify-email', { token }),
  },

  // --- catalogue ---------------------------------------------------------
  catalog: {
    products: (query?: {
      q?: string; category?: string; seller?: string; sort?: string;
      page?: number; perPage?: number; inStock?: string; minPrice?: number; maxPrice?: number;
    }) => get<{ products: ProductCard[]; pagination: Pagination }>('/api/products', query),
    product: (slug: string) =>
      get<{ product: Record<string, unknown>; reviews: unknown[]; ratingHistogram: unknown[] }>(
        `/api/products/${encodeURIComponent(slug)}`,
      ),
    reviews: (slug: string, page = 1) =>
      get<{ reviews: unknown[]; pagination: Pagination }>(
        `/api/products/${encodeURIComponent(slug)}/reviews`,
        { page },
      ),
    categories: () =>
      get<{ categories: Array<{ id: string; name: string; slug: string; imageUrl: string | null; productCount: number }> }>(
        '/api/categories',
      ),
    seller: (slug: string) =>
      get<{ seller: Record<string, unknown>; products: ProductCard[] }>(
        `/api/sellers/${encodeURIComponent(slug)}`,
      ),
  },

  // --- cart --------------------------------------------------------------
  cart: {
    get: () =>
      get<{
        groups: CartGroup[];
        totals: CartTotals | null;
        issues: Array<{ cartItemId: string; productName: string; problem: string }>;
      }>('/api/cart'),
    add: (productId: string, quantity = 1, variantId?: string | null) =>
      post<{ item: { id: string; quantity: number }; cartItemCount: number }>('/api/cart', {
        productId,
        quantity,
        ...(variantId ? { variantId } : {}),
      }),
    setQuantity: (cartItemId: string, quantity: number) =>
      patch<{ item?: { id: string; quantity: number }; removed?: boolean }>(
        `/api/cart/${cartItemId}`,
        { quantity },
      ),
    remove: (cartItemId: string) => del<{ removed: boolean }>(`/api/cart/${cartItemId}`),
    clear: () => del<{ cleared: boolean }>('/api/cart'),
    // Price preview — the server computes it, including coupon validation.
    quote: (items: Array<{ productId: string; variantId?: string | null; quantity: number }>, couponCode?: string) =>
      post<{
        totals: Omit<CartTotals, 'itemCount' | 'sellerCount'>;
        perSeller: Array<{ sellerId: string; total: number; itemCount: number }>;
        couponApplied: string | null;
        couponError: string | null;
        notices: string[];
      }>('/api/cart/quote', { items, ...(couponCode ? { couponCode } : {}) }),
  },

  // --- addresses ---------------------------------------------------------
  addresses: {
    list: () => get<{ addresses: Array<Record<string, unknown>> }>('/api/addresses'),
    create: (body: Record<string, unknown>) =>
      post<{ address: Record<string, unknown> }>('/api/addresses', body),
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ address: Record<string, unknown> }>(`/api/addresses/${id}`, body),
    remove: (id: string) => del<{ removed: boolean }>(`/api/addresses/${id}`),
  },

  // --- checkout & payment ------------------------------------------------
  checkout: {
    // Only ids and quantities. The server decides the money.
    submit: (body: {
      items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
      addressId?: string;
      shippingAddress?: Record<string, unknown>;
      billingSameAsShipping?: boolean;
      couponCode?: string;
      customerNote?: string;
      paymentMethod: 'RAZORPAY' | 'STRIPE' | 'COD';
      idempotencyKey?: string;
    }) =>
      post<{
        orderId: string;
        orderNumber: string;
        grandTotal: number;
        requiresPayment: boolean;
        reused?: boolean;
        payment?: {
          provider: string;
          providerOrderId: string;
          publicKey: string;
          amount: number;
          currency: string;
        };
        sellerOrders: Array<{ sellerOrderNumber: string; sellerId: string }>;
      }>('/api/checkout', body),

    retryPayment: (orderId: string) =>
      post<{ payment: { provider: string; providerOrderId: string; publicKey: string; amount: number; currency: string } }>(
        '/api/payments/create',
        { orderId },
      ),

    // Reports the order's REAL state from the webhook — it does not set it.
    verify: (body: {
      orderId: string;
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      signature?: string;
    }) =>
      post<{
        orderId: string;
        orderNumber: string;
        paymentStatus: string;
        orderStatus: string;
        sellerOrderCount: number;
        grandTotal: number;
        state: 'CONFIRMED' | 'PROCESSING' | 'FAILED' | 'PENDING';
        message: string;
      }>('/api/payments/verify', body),
  },

  // --- orders ------------------------------------------------------------
  orders: {
    list: (query?: { page?: number; status?: string; q?: string }) =>
      get<{ orders: Array<Record<string, unknown>>; pagination: Pagination }>('/api/orders', query),
    detail: (id: string) =>
      get<{ order: Record<string, unknown>; parcels: Parcel[] }>(`/api/orders/${id}`),
    cancel: (id: string, reason: string, sellerOrderId?: string) =>
      post<{ cancelled: unknown[]; message: string }>(`/api/orders/${id}/cancel`, {
        reason,
        ...(sellerOrderId ? { sellerOrderId } : {}),
      }),
    track: (orderNumber: string, phoneLast4?: string) =>
      get<{ orderNumber: string; status: string; placedAt: string; parcels: unknown[] }>(
        `/api/orders/track/${encodeURIComponent(orderNumber)}`,
        phoneLast4 ? { phone: phoneLast4 } : undefined,
      ),
  },

  // --- reviews & returns -------------------------------------------------
  reviews: {
    mine: () => get<{ reviews: unknown[]; awaitingReview: unknown[] }>('/api/reviews'),
    create: (body: { orderItemId: string; rating: number; title?: string; comment?: string }) =>
      post<{ review: { id: string; rating: number; status: string } }>('/api/reviews', body),
  },

  returns: {
    mine: () => get<{ returns: unknown[] }>('/api/returns'),
    create: (body: {
      sellerOrderId: string;
      reason: string;
      description?: string;
      items: Array<{ orderItemId: string; quantity: number }>;
    }) =>
      post<{ returnRequest: Record<string, unknown>; message: string }>('/api/returns', body),
    detail: (id: string) => get<{ returnRequest: Record<string, unknown> }>(`/api/returns/${id}`),
  },

  wishlist: {
    list: () => get<{ items: Array<Record<string, unknown>> }>('/api/wishlist'),
    add: (productId: string) => post<{ saved: boolean }>('/api/wishlist', { productId }),
    remove: (productId: string) => del<{ removed: boolean }>(`/api/wishlist/${productId}`),
  },

  notifications: {
    list: (unreadOnly = false) =>
      get<{ notifications: Array<Record<string, unknown>>; unreadCount: number }>(
        '/api/notifications',
        unreadOnly ? { unread: 'true' } : undefined,
      ),
    markRead: (ids?: string[]) => patch<{ markedRead: number }>('/api/notifications', { ids }),
  },

  // --- seller ------------------------------------------------------------
  seller: {
    register: (body: Record<string, unknown>) =>
      post<{ sellerId: string; slug: string; status: string; nextStep: string; message: string }>(
        '/api/seller/register',
        body,
      ),
    dashboard: () =>
      get<{
        seller: Record<string, unknown>;
        stats: Record<string, unknown> | null;
        earnings: Record<string, unknown> | null;
        recentOrders: Array<Record<string, unknown>>;
        lowStock: Array<Record<string, unknown>>;
      }>('/api/seller/dashboard'),
    products: (query?: { page?: number; status?: string }) =>
      get<{ products: Array<Record<string, unknown>>; pagination: Pagination }>(
        '/api/seller/products',
        query,
      ),
    createProduct: (body: Record<string, unknown>) =>
      post<{ product: Record<string, unknown>; message: string }>('/api/seller/products', body),
    product: (id: string) => get<{ product: Record<string, unknown> }>(`/api/seller/products/${id}`),
    updateProduct: (id: string, body: Record<string, unknown>) =>
      patch<{ product: Record<string, unknown>; message: string }>(`/api/seller/products/${id}`, body),
    deleteProduct: (id: string) =>
      del<{ deleted?: boolean; archived?: boolean; message: string }>(`/api/seller/products/${id}`),
    setStock: (id: string, onHand: number, note?: string) =>
      patch<{ stock: { onHand: number; reserved: number; available: number }; message: string }>(
        `/api/seller/products/${id}/stock`,
        { onHand, ...(note ? { note } : {}) },
      ),
    inventory: (query?: { page?: number; low?: string }) =>
      get<{ inventory: Array<Record<string, unknown>>; movements: Array<Record<string, unknown>> }>(
        '/api/seller/inventory',
        query,
      ),
    orders: (query?: { page?: number; status?: string; q?: string }) =>
      get<{
        orders: Array<Record<string, unknown>>;
        statusCounts: Array<{ status: string; count: number }>;
        pagination: Pagination;
      }>('/api/seller/orders', query),
    order: (id: string) => get<{ order: Record<string, unknown> }>(`/api/seller/orders/${id}`),
    transition: (
      id: string,
      body: { to: string; note?: string; courier?: string; trackingNumber?: string; location?: string },
    ) => post<{ from: string; to: string; message: string }>(`/api/seller/orders/${id}/transition`, body),
    finance: () =>
      get<{
        summary: Record<string, number>;
        commissions: Array<Record<string, unknown>>;
        refunds: Array<Record<string, unknown>>;
        monthly: Array<Record<string, number | string>>;
      }>('/api/seller/finance'),
    payouts: () =>
      get<{ summary: Record<string, number>; payouts: Array<Record<string, unknown>>; note: string }>(
        '/api/seller/payouts',
      ),
    analytics: (days = 30) =>
      get<{
        totals: Record<string, number>;
        daily: Array<{ day: string; revenue: number; orders: number }>;
        topProducts: Array<{ productId: string; name: string; units: number; revenue: number }>;
        statusMix: Array<{ status: string; count: number }>;
      }>('/api/seller/analytics', { days }),
    profile: () => get<{ seller: Record<string, unknown> }>('/api/seller/profile'),
    updateProfile: (body: Record<string, unknown>) =>
      patch<{ seller: Record<string, unknown>; message: string }>('/api/seller/profile', body),
    saveKyc: (body: Record<string, unknown>) =>
      post<{ kyc: Record<string, unknown>; message: string }>('/api/seller/kyc', body),
    saveBank: (body: Record<string, unknown>) =>
      post<{ bankAccount: Record<string, unknown>; message: string }>('/api/seller/kyc/bank', body),
    submitApplication: () =>
      post<{ status: string; message: string }>('/api/seller/kyc/submit'),
    returns: (status?: string) =>
      get<{ returns: Array<Record<string, unknown>> }>('/api/seller/returns', status ? { status } : undefined),
    decideReturn: (id: string, body: { decision: 'APPROVE' | 'REJECT'; rejectionReason?: string; restock?: boolean }) =>
      post<{ message: string }>(`/api/seller/returns/${id}/decision`, body),
  },

  // --- admin -------------------------------------------------------------
  admin: {
    dashboard: () =>
      get<{
        finance: Record<string, unknown>;
        counts: Record<string, number>;
        recentOrders: Array<Record<string, unknown>>;
        trend: Array<{ day: string; gmv: number; revenue: number; orders: number }>;
        topSellers: Array<{ sellerId: string; name: string; revenue: number; orders: number }>;
      }>('/api/admin/dashboard'),
    sellers: (query?: { page?: number; status?: string; q?: string }) =>
      get<{ sellers: Array<Record<string, unknown>>; pagination: Pagination }>('/api/admin/sellers', query),
    seller: (id: string) => get<{ seller: Record<string, unknown> }>(`/api/admin/sellers/${id}`),
    decideSeller: (
      id: string,
      body: { decision: string; reason?: string; commissionRate?: number },
    ) => post<{ status: string; message: string }>(`/api/admin/sellers/${id}/decision`, body),
    products: (query?: { page?: number; approval?: string; q?: string }) =>
      get<{
        products: Array<Record<string, unknown>>;
        queueCounts: Array<{ approvalStatus: string; count: number }>;
        pagination: Pagination;
      }>('/api/admin/products', query),
    moderateProduct: (id: string, body: { decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
      post<{ message: string }>(`/api/admin/products/${id}/moderate`, body),
    orders: (query?: { page?: number; status?: string; q?: string; sellerId?: string }) =>
      get<{
        orders: Array<Record<string, unknown>>;
        statusCounts: Array<{ status: string; count: number }>;
        pagination: Pagination;
      }>('/api/admin/orders', query),
    order: (id: string) => get<{ order: Record<string, unknown> }>(`/api/admin/orders/${id}`),
    payouts: (query?: { status?: string; sellerId?: string }) =>
      get<{ payouts: Array<Record<string, unknown>>; summary: Record<string, unknown> }>(
        '/api/admin/payouts',
        query,
      ),
    payoutAction: (body: Record<string, unknown>) =>
      post<{ message: string; submitted?: number; totalPaise?: number }>('/api/admin/payouts', body),
    coupons: () => get<{ coupons: Array<Record<string, unknown>> }>('/api/admin/coupons'),
    createCoupon: (body: Record<string, unknown>) =>
      post<{ coupon: Record<string, unknown>; message: string }>('/api/admin/coupons', body),
    toggleCoupon: (id: string, isActive: boolean) =>
      patch<{ coupon: Record<string, unknown> }>(`/api/admin/coupons?id=${id}`, { isActive }),
    categories: () => get<{ categories: Array<Record<string, unknown>> }>('/api/admin/categories'),
    createCategory: (body: Record<string, unknown>) =>
      post<{ category: Record<string, unknown> }>('/api/admin/categories', body),
    updateCategory: (id: string, body: Record<string, unknown>) =>
      patch<{ category: Record<string, unknown> }>(`/api/admin/categories?id=${id}`, body),
    returns: (status?: string) =>
      get<{ returns: Array<Record<string, unknown>> }>('/api/admin/returns', status ? { status } : undefined),
    returnAction: (id: string, body: Record<string, unknown>) =>
      post<{ message: string }>(`/api/admin/returns/${id}/decision`, body),
    refunds: () =>
      get<{ refunds: Array<Record<string, unknown>>; totals: Array<Record<string, unknown>> }>(
        '/api/admin/refunds',
      ),
    issueRefund: (body: { sellerOrderId: string; amountRupees?: number; reason: string; returnId?: string }) =>
      post<{ refund: Record<string, unknown>; message: string }>('/api/admin/refunds', body),
    settings: () => get<{ settings: Record<string, unknown>; descriptions: Record<string, string> }>('/api/admin/settings'),
    updateSettings: (body: Record<string, unknown>) =>
      patch<{ settings: Record<string, unknown>; message: string }>('/api/admin/settings', body),
    customers: (query?: { page?: number; q?: string }) =>
      get<{ customers: Array<Record<string, unknown>>; pagination: Pagination }>(
        '/api/admin/customers',
        query,
      ),
    audit: (query?: { page?: number; entityType?: string; entityId?: string }) =>
      get<{ logs: Array<Record<string, unknown>> }>('/api/admin/audit', query),
  },

  // --- logistics ---------------------------------------------------------
  logistics: {
    shipments: (status?: string) =>
      get<{ shipments: Array<Record<string, unknown>> }>(
        '/api/logistics/shipments',
        status ? { status } : undefined,
      ),
    scan: (shipmentId: string, body: { event: string; location?: string; message?: string }) =>
      post<{ recorded: string; message?: string }>(`/api/logistics/shipments/${shipmentId}/event`, body),
  },

  // --- uploads -----------------------------------------------------------
  upload: async (file: File, kind: 'PRODUCT_IMAGE' | 'KYC_DOCUMENT' | 'REVIEW_IMAGE' | 'RETURN_IMAGE', field?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    if (field) form.append('field', field);
    return request<{ file: { url: string; key: string; bytes: number; mime: string } }>('/api/uploads', {
      method: 'POST',
      body: form,
    });
  },

  health: () => get<{ status: string; counts: Record<string, number>; config: Record<string, unknown> }>('/api/health'),
};

export default api;
