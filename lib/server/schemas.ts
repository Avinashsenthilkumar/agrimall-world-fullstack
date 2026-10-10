// lib/server/schemas.ts — §24. Every request body and query is validated here.
//
// Note what the checkout schema does NOT accept: price, sellerId, commission,
// total, or paymentStatus. Those fields are not merely ignored — they are
// absent from the schema, so `.strict()` rejects the whole request if a client
// tries to send them. That turns price manipulation into a 422 instead of a
// silent trust decision.

import { z } from 'zod';

// --- Primitives ------------------------------------------------------------

export const cuid = z.string().min(1).max(64);

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Please enter a valid email address.');

/** Indian mobile: optional +91, then a 10-digit number starting 6-9. */
export const phone = z
  .string()
  .trim()
  .regex(/^(?:\+?91[\s-]?)?[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian mobile number.')
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+?91/, ''));

export const password = z.string().min(8, 'Use at least 8 characters.').max(72);

export const pincode = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Please enter a valid 6-digit PIN code.');

/** Money arriving from an admin form, in rupees → stored as paise. */
export const rupeeAmount = z
  .number()
  .nonnegative()
  .max(10_000_000)
  .transform((r) => Math.round(r * 100));

export const paiseAmount = z.number().int().nonnegative().max(1_000_000_000);

export const quantity = z.number().int().positive().max(100);

export const percentRate = z.number().min(0).max(100);

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only.');

// India-specific KYC identifiers (§4).
export const panNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN must look like ABCDE1234F.');

export const gstNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    'Please enter a valid 15-character GSTIN.',
  );

export const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Please enter a valid IFSC code.');

export const bankAccountNumber = z
  .string()
  .trim()
  .regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits.');

export const aadhaarNumber = z
  .string()
  .trim()
  .regex(/^\d{12}$/, 'Aadhaar must be 12 digits.');

// --- Auth ------------------------------------------------------------------

export const registerCustomerSchema = z
  .object({
    name: z.string().trim().min(2, 'Please enter your name.').max(120),
    email,
    phone: phone.optional(),
    password,
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1, 'Please enter your password.').max(72),
  })
  .strict();

export const requestPasswordResetSchema = z.object({ email }).strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    password,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: password,
  })
  .strict();

export const verifyEmailSchema = z.object({ token: z.string().min(10) }).strict();

// --- Seller onboarding (§4) ------------------------------------------------

export const sellerRegisterSchema = z
  .object({
    // Account
    ownerName: z.string().trim().min(2).max(120),
    email,
    password,
    // Business
    businessName: z.string().trim().min(2, 'Please enter your business name.').max(160),
    legalName: z.string().trim().max(160).optional(),
    businessPhone: phone,
    businessEmail: email.optional(),
    addressLine1: z.string().trim().min(3).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    pincode,
    description: z.string().trim().max(2000).optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the seller agreement.' }),
    }),
    acceptedPolicy: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the platform policy.' }),
    }),
  })
  .strict();

export const sellerKycSchema = z
  .object({
    panNumber,
    gstNumber: gstNumber.optional().or(z.literal('')),
    msmeNumber: z.string().trim().max(40).optional().or(z.literal('')),
    aadhaarNumber: aadhaarNumber.optional().or(z.literal('')),
  })
  .strict();

export const sellerBankSchema = z
  .object({
    accountHolderName: z.string().trim().min(2).max(160),
    accountNumber: bankAccountNumber,
    confirmAccountNumber: bankAccountNumber,
    ifsc,
    bankName: z.string().trim().max(120).optional(),
    branch: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((d) => d.accountNumber === d.confirmAccountNumber, {
    message: 'Account numbers do not match.',
    path: ['confirmAccountNumber'],
  });

export const sellerProfileUpdateSchema = z
  .object({
    businessName: z.string().trim().min(2).max(160).optional(),
    businessPhone: phone.optional(),
    addressLine1: z.string().trim().min(3).max(200).optional(),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2).max(100).optional(),
    state: z.string().trim().min(2).max(100).optional(),
    pincode: pincode.optional(),
    description: z.string().trim().max(2000).optional(),
    logoUrl: z.string().url().max(500).optional(),
  })
  .strict();

// --- Products (§7) ---------------------------------------------------------

export const productCreateSchema = z
  .object({
    name: z.string().trim().min(2, 'Please enter a product name.').max(200),
    latinName: z.string().trim().max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    categoryId: cuid,
    brandId: cuid.optional().nullable(),
    sku: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9._-]+$/, 'SKU may use letters, numbers, dot, dash, underscore.'),
    /** Rupees from the form; transformed to paise. */
    price: rupeeAmount,
    compareAtPrice: rupeeAmount.optional(),
    taxRate: percentRate.default(0),
    stock: z.number().int().nonnegative().max(1_000_000),
    lowStockThreshold: z.number().int().nonnegative().max(10_000).default(10),
    weightGrams: z.number().int().positive().max(500_000).optional(),
    lengthMm: z.number().int().positive().max(10_000).optional(),
    widthMm: z.number().int().positive().max(10_000).optional(),
    heightMm: z.number().int().positive().max(10_000).optional(),
    careLight: z.string().trim().max(120).optional(),
    careWater: z.string().trim().max(120).optional(),
    careTemp: z.string().trim().max(120).optional(),
    careDifficulty: z.string().trim().max(60).optional(),
    careSafety: z.string().trim().max(120).optional(),
    imageUrls: z.array(z.string().max(1000)).max(8).default([]),
    /** Submit for approval now, or keep as a draft. */
    submitForApproval: z.boolean().default(true),
  })
  .strict()
  .refine((d) => d.compareAtPrice == null || d.compareAtPrice >= d.price, {
    message: 'The compare-at price must be at least the selling price.',
    path: ['compareAtPrice'],
  });

export const productUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    latinName: z.string().trim().max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    categoryId: cuid.optional(),
    brandId: cuid.nullable().optional(),
    price: rupeeAmount.optional(),
    compareAtPrice: rupeeAmount.nullable().optional(),
    taxRate: percentRate.optional(),
    weightGrams: z.number().int().positive().max(500_000).nullable().optional(),
    careLight: z.string().trim().max(120).optional(),
    careWater: z.string().trim().max(120).optional(),
    careTemp: z.string().trim().max(120).optional(),
    careDifficulty: z.string().trim().max(60).optional(),
    careSafety: z.string().trim().max(120).optional(),
    imageUrls: z.array(z.string().max(1000)).max(8).optional(),
    /** A seller may pause or resume their own listing. */
    status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).optional(),
  })
  .strict();

export const stockUpdateSchema = z
  .object({
    onHand: z.number().int().nonnegative().max(1_000_000),
    variantId: cuid.optional().nullable(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const productQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    category: z.string().trim().max(120).optional(),
    seller: cuid.optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    sort: z.enum(['popular', 'price_asc', 'price_desc', 'rating', 'newest']).default('popular'),
    page: z.coerce.number().int().positive().max(1000).default(1),
    perPage: z.coerce.number().int().positive().max(60).default(24),
    inStock: z.enum(['true', 'false']).optional(),
  })
  .strip();

// --- Cart & checkout (§9, §10) --------------------------------------------

export const cartAddSchema = z
  .object({
    productId: cuid,
    variantId: cuid.optional().nullable(),
    quantity: quantity.default(1),
  })
  .strict();

export const cartUpdateSchema = z
  .object({
    quantity: z.number().int().min(0).max(100),
  })
  .strict();

export const addressSchema = z
  .object({
    label: z.string().trim().max(40).optional(),
    fullName: z.string().trim().min(2).max(120),
    phone,
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    pincode,
    country: z.string().trim().max(60).default('India'),
    isDefault: z.boolean().default(false),
  })
  .strict();

/**
 * THE CHECKOUT CONTRACT.
 *
 * `.strict()` is load-bearing: a request containing `price`, `total`,
 * `sellerId`, `commission` or `paymentStatus` is rejected outright rather
 * than having those fields quietly dropped. Price manipulation fails loudly.
 */
export const checkoutSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: cuid,
            variantId: cuid.optional().nullable(),
            quantity,
          })
          .strict(),
      )
      .min(1, 'Your cart is empty.')
      .max(50),
    /** Either an existing saved address id… */
    addressId: cuid.optional(),
    /** …or a new address to use for this order. */
    shippingAddress: addressSchema.omit({ isDefault: true, label: true }).optional(),
    billingSameAsShipping: z.boolean().default(true),
    billingAddress: addressSchema.omit({ isDefault: true, label: true }).optional(),
    couponCode: z.string().trim().max(40).optional(),
    customerNote: z.string().trim().max(500).optional(),
    paymentMethod: z.enum(['RAZORPAY', 'STRIPE', 'COD']),
    /** Guards against a double-submitted checkout form. */
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .strict()
  .refine((d) => Boolean(d.addressId || d.shippingAddress), {
    message: 'Please choose or enter a delivery address.',
    path: ['addressId'],
  });

/** A price preview for the cart page — same engine, no order created. */
export const quoteSchema = z
  .object({
    items: z
      .array(z.object({ productId: cuid, variantId: cuid.optional().nullable(), quantity }).strict())
      .min(1)
      .max(50),
    couponCode: z.string().trim().max(40).optional(),
  })
  .strict();

// --- Order lifecycle (§15) -------------------------------------------------

export const sellerOrderTransitionSchema = z
  .object({
    to: z.enum([
      'ACCEPTED',
      'PACKING',
      'READY_FOR_PICKUP',
      'SHIPPED',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'RETURN_REQUESTED',
      'RETURNED',
      'REFUNDED',
    ]),
    note: z.string().trim().max(500).optional(),
    location: z.string().trim().max(160).optional(),
    courier: z.string().trim().max(80).optional(),
    trackingNumber: z.string().trim().max(80).optional(),
    estimatedDelivery: z.coerce.date().optional(),
  })
  .strict();

export const cancelOrderSchema = z
  .object({
    sellerOrderId: cuid.optional(),
    reason: z.string().trim().min(3, 'Please tell us why.').max(300),
  })
  .strict();

// --- Returns & refunds (§18) ----------------------------------------------

export const returnRequestSchema = z
  .object({
    sellerOrderId: cuid,
    reason: z.enum([
      'DAMAGED_IN_TRANSIT',
      'WRONG_ITEM',
      'NOT_AS_DESCRIBED',
      'PLANT_UNHEALTHY',
      'MISSING_ITEMS',
      'CHANGED_MIND',
      'OTHER',
    ]),
    description: z.string().trim().max(1000).optional(),
    items: z
      .array(z.object({ orderItemId: cuid, quantity: quantity }).strict())
      .min(1, 'Select at least one item to return.')
      .max(50),
    imageUrls: z.array(z.string().max(1000)).max(6).default([]),
  })
  .strict();

export const returnDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    rejectionReason: z.string().trim().max(300).optional(),
    restock: z.boolean().default(true),
  })
  .strict()
  .refine((d) => d.decision !== 'REJECT' || Boolean(d.rejectionReason), {
    message: 'Please give a reason for rejecting the return.',
    path: ['rejectionReason'],
  });

export const returnProgressSchema = z
  .object({
    status: z.enum(['PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED', 'INSPECTED']),
    pickupScheduledAt: z.coerce.date().optional(),
    inspectionNote: z.string().trim().max(500).optional(),
    /** Set at INSPECTED: how much of the request is actually refundable. */
    approvedRefundRupees: z.number().nonnegative().max(1_000_000).optional(),
  })
  .strict();

export const refundSchema = z
  .object({
    sellerOrderId: cuid,
    /** Omit for a full refund of the sub-order. */
    amountRupees: z.number().positive().max(1_000_000).optional(),
    reason: z.string().trim().min(3).max(300),
    returnId: cuid.optional(),
  })
  .strict();

// --- Reviews (§19) ---------------------------------------------------------

export const reviewCreateSchema = z
  .object({
    orderItemId: cuid,
    rating: z.number().int().min(1, 'Please choose a rating.').max(5),
    title: z.string().trim().max(120).optional(),
    comment: z.string().trim().max(2000).optional(),
    imageUrls: z.array(z.string().max(1000)).max(5).default([]),
  })
  .strict();

export const reviewReplySchema = z
  .object({ reply: z.string().trim().min(2).max(1000) })
  .strict();

export const reviewModerationSchema = z
  .object({ status: z.enum(['PUBLISHED', 'REJECTED', 'PENDING']) })
  .strict();

// --- Admin (§21) -----------------------------------------------------------

export const sellerDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'BLOCK', 'REINSTATE', 'UNDER_REVIEW']),
    reason: z.string().trim().max(500).optional(),
    /** Optional negotiated commission applied on approval. */
    commissionRate: percentRate.optional(),
  })
  .strict()
  .refine(
    (d) => !['REJECT', 'SUSPEND', 'BLOCK'].includes(d.decision) || Boolean(d.reason),
    { message: 'Please give a reason for this decision.', path: ['reason'] },
  );

export const kycDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'UNDER_REVIEW']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((d) => d.decision !== 'REJECT' || Boolean(d.reason), {
    message: 'Please say what needs correcting.',
    path: ['reason'],
  });

export const productModerationSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((d) => d.decision !== 'REJECT' || Boolean(d.reason), {
    message: 'Please say why the listing was rejected.',
    path: ['reason'],
  });

export const categorySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slug.optional(),
    parentId: cuid.nullable().optional(),
    imageUrl: z.string().max(1000).optional(),
    description: z.string().trim().max(1000).optional(),
    commissionRate: percentRate.nullable().optional(),
    taxRate: percentRate.default(0),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .strict();

export const brandSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slug.optional(),
    logoUrl: z.string().max(1000).optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(40)
      .regex(/^[A-Z0-9_-]+$/, 'Use letters, numbers, dash and underscore only.'),
    scope: z.enum(['PLATFORM', 'SELLER', 'CATEGORY', 'PRODUCT']).default('PLATFORM'),
    description: z.string().trim().max(300).optional(),
    discountType: z.enum(['PERCENT', 'FIXED']),
    /** Percent as 1-100, or rupees for FIXED (converted below). */
    discountValue: z.number().positive(),
    maxDiscountRupees: z.number().positive().max(1_000_000).optional(),
    minOrderRupees: z.number().nonnegative().max(1_000_000).default(0),
    sellerId: cuid.optional().nullable(),
    categoryId: cuid.optional().nullable(),
    productId: cuid.optional().nullable(),
    startsAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
    usageLimit: z.number().int().positive().max(1_000_000).optional().nullable(),
    perCustomerLimit: z.number().int().min(0).max(100).default(1),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((d) => d.expiresAt > d.startsAt, {
    message: 'The expiry date must be after the start date.',
    path: ['expiresAt'],
  })
  .refine((d) => d.discountType !== 'PERCENT' || d.discountValue <= 100, {
    message: 'A percentage discount cannot exceed 100.',
    path: ['discountValue'],
  })
  .refine(
    (d) =>
      (d.scope === 'PLATFORM' && !d.sellerId && !d.categoryId && !d.productId) ||
      (d.scope === 'SELLER' && !!d.sellerId) ||
      (d.scope === 'CATEGORY' && !!d.categoryId) ||
      (d.scope === 'PRODUCT' && !!d.productId),
    { message: 'The coupon scope does not match the target you selected.', path: ['scope'] },
  );

export const payoutActionSchema = z
  .object({
    action: z.enum(['SUBMIT_BATCH', 'MARK_PAID', 'MARK_FAILED', 'HOLD']),
    payoutIds: z.array(cuid).max(500).optional(),
    payoutId: cuid.optional(),
    providerReference: z.string().trim().max(120).optional(),
    reason: z.string().trim().max(300).optional(),
    sellerId: cuid.optional(),
  })
  .strict()
  .refine((d) => d.action !== 'MARK_PAID' || (!!d.payoutId && !!d.providerReference), {
    message: 'Marking a payout paid requires the payout and the provider reference.',
    path: ['providerReference'],
  })
  .refine((d) => !['MARK_FAILED', 'HOLD'].includes(d.action) || (!!d.payoutId && !!d.reason), {
    message: 'Please give the payout and a reason.',
    path: ['reason'],
  });

export const settingsUpdateSchema = z
  .object({
    'commission.defaultRate': percentRate.optional(),
    'shipping.flatFeePerSeller': paiseAmount.optional(),
    'shipping.freeAboveSubtotal': paiseAmount.optional(),
    'returns.windowDays': z.number().int().min(0).max(90).optional(),
    'checkout.reservationTtlMinutes': z.number().int().min(5).max(1440).optional(),
  })
  .strip();

export const sellerCommissionSchema = z
  .object({ commissionRate: percentRate.nullable() })
  .strict();

// --- Pagination ------------------------------------------------------------

export const paginationSchema = z
  .object({
    page: z.coerce.number().int().positive().max(10_000).default(1),
    perPage: z.coerce.number().int().positive().max(100).default(20),
  })
  .strip();

export const orderListQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(40).optional(),
  q: z.string().trim().max(120).optional(),
});
