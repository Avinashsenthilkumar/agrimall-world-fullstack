// lib/server/pricing.ts — §10. Resolving a cart against the database.
//
// This is the bridge between "what the client asked for" and the pure pricing
// engine. The client is permitted to send EXACTLY three things per line:
//
//     { productId, variantId?, quantity }
//
// Everything else is looked up here. The function implements §10's checklist
// in order:
//
//   1. fetch product from database          6. calculate discount
//   2. verify product is active             7. calculate tax
//   3. verify seller is approved            8. calculate shipping
//   4. fetch current price                  9. calculate seller subtotal
//   5. verify inventory                    10. calculate platform commission
//                                          11. calculate final total
//
// Steps 6-11 are the pure engine in lib/shared/pricing.ts; 1-5 are here.

import { prisma, type Tx } from './prisma';
import { badRequest, conflict, notFound } from './http';
import { getDefaultCommissionRate, getShippingPolicy } from './settings';
import {
  quote as pureQuote,
  type PricedLine,
  type Quote,
  type ResolvedCoupon,
} from '../shared/pricing';
import type { Paise } from '../shared/money';

/** What a client is allowed to send. Note the absence of any price field. */
export interface CartLineRequest {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface ResolveOptions {
  /** Check availability and fail if short. Always true for real checkout. */
  enforceStock?: boolean;
  /** Coupon code the customer typed. Validated server-side. */
  couponCode?: string | null;
  customerId?: string;
  /** Use an open transaction if we're already inside one. */
  client?: Tx;
}

export interface ResolvedCart {
  quote: Quote;
  /** productId → sellerId, for the inventory layer. */
  sellerByProduct: Map<string, string>;
  /** The coupon row that was actually applied, if any. */
  coupon: ResolvedCoupon | null;
}

/**
 * Turn client line requests into a trustworthy Quote.
 *
 * Throws if a product is missing, unpublished, owned by a non-approved seller,
 * or short on stock. There is no code path by which a client-supplied price,
 * sellerId, commission or total can reach the returned quote.
 */
export async function resolveCart(
  lines: CartLineRequest[],
  opts: ResolveOptions = {},
): Promise<ResolvedCart> {
  const db = opts.client ?? prisma;

  if (!Array.isArray(lines) || lines.length === 0) {
    throw badRequest('Your cart is empty.');
  }
  if (lines.length > 50) {
    throw badRequest('A single order can contain at most 50 different items.');
  }

  // Merge duplicate lines so the same product sent twice becomes one line with
  // the summed quantity (otherwise stock checks would be evaluated separately
  // and both could pass).
  const merged = new Map<string, CartLineRequest>();
  for (const l of lines) {
    if (typeof l.productId !== 'string' || !l.productId) throw badRequest('Invalid product reference.');
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw badRequest('Quantity must be a whole number greater than zero.');
    }
    if (l.quantity > 100) throw badRequest('Maximum 100 units of a single item per order.');

    const key = `${l.productId}::${l.variantId ?? ''}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += l.quantity;
    else merged.set(key, { ...l });
  }
  const requestLines = [...merged.values()];

  // ---- 1. Fetch products (one query, not N) -------------------------------
  const productIds = [...new Set(requestLines.map((l) => l.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: {
      seller: { select: { id: true, status: true, businessName: true, commissionRate: true } },
      category: { select: { id: true, commissionRate: true, taxRate: true } },
      images: { where: { isPrimary: true }, take: 1, select: { url: true } },
      variants: true,
      inventory: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const platformRate = await getDefaultCommissionRate();
  const shippingPolicy = await getShippingPolicy();

  const pricedLines: PricedLine[] = [];
  const sellerByProduct = new Map<string, string>();

  for (const line of requestLines) {
    const product = byId.get(line.productId);

    // ---- 1b. Must exist ---------------------------------------------------
    if (!product) throw notFound('One of the items in your cart no longer exists.');

    // ---- 2. Must be purchasable ------------------------------------------
    if (product.approvalStatus !== 'APPROVED') {
      throw conflict(`${product.name} is not available for sale right now.`);
    }
    if (product.status !== 'ACTIVE') {
      const why =
        product.status === 'OUT_OF_STOCK'
          ? `${product.name} is out of stock.`
          : `${product.name} is not available for sale right now.`;
      throw conflict(why);
    }

    // ---- 3. Seller must be approved --------------------------------------
    if (product.seller.status !== 'APPROVED') {
      throw conflict(`${product.name} is temporarily unavailable from this seller.`);
    }

    // ---- 4. Current price, from the DB -----------------------------------
    let unitPrice: Paise = product.price;
    let variantLabel: string | null = null;

    if (line.variantId) {
      const variant = product.variants.find((v) => v.id === line.variantId);
      if (!variant) throw notFound(`That option for ${product.name} is no longer offered.`);
      if (!variant.isActive) throw conflict(`That option for ${product.name} is unavailable.`);
      if (variant.price != null) unitPrice = variant.price;
      variantLabel = `${variant.name}: ${variant.value}`;
    }

    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      // A corrupt price must stop the sale, not silently become 0.
      throw conflict(`Pricing for ${product.name} is being updated — please try again shortly.`);
    }

    // ---- 5. Inventory -----------------------------------------------------
    if (opts.enforceStock !== false) {
      const inv = line.variantId
        ? await db.inventory.findFirst({ where: { variantId: line.variantId } })
        : product.inventory;

      const available = inv ? Math.max(0, inv.onHand - inv.reserved) : 0;
      if (available < line.quantity) {
        throw conflict(
          available === 0
            ? `${product.name} just went out of stock.`
            : `Only ${available} of ${product.name} ${available === 1 ? 'is' : 'are'} left.`,
        );
      }
    }

    sellerByProduct.set(product.id, product.seller.id);

    pricedLines.push({
      ref: `${product.id}::${line.variantId ?? ''}`,
      productId: product.id,
      variantId: line.variantId ?? null,
      sellerId: product.seller.id,
      categoryId: product.categoryId,
      unitPrice,
      quantity: line.quantity,
      // Product tax rate overrides the category's when set above zero.
      taxRate: Number(product.taxRate) > 0 ? Number(product.taxRate) : Number(product.category.taxRate),
      commissionRates: {
        sellerRate: product.seller.commissionRate != null ? Number(product.seller.commissionRate) : null,
        categoryRate: product.category.commissionRate != null ? Number(product.category.commissionRate) : null,
        platformRate,
      },
      snapshot: {
        productName: product.name,
        sku: product.sku,
        imageUrl: product.images[0]?.url ?? null,
        variantLabel,
      },
    });
  }

  // ---- 6. Coupon (validated server-side, §20) ----------------------------
  const coupon = opts.couponCode
    ? await resolveCoupon(opts.couponCode, { customerId: opts.customerId, client: db })
    : null;

  // ---- 7-11. The pure engine ---------------------------------------------
  const quote = pureQuote({ lines: pricedLines, coupon, shippingPolicy });

  return { quote, sellerByProduct, coupon };
}

/**
 * Validate a coupon code. Returns null (never throws) when the code simply
 * isn't usable, so checkout proceeds at full price with a notice — a bad
 * coupon shouldn't block a sale.
 */
export async function resolveCoupon(
  code: string,
  opts: { customerId?: string; client?: Tx } = {},
): Promise<ResolvedCoupon | null> {
  const db = opts.client ?? prisma;
  const normalised = code.trim().toUpperCase();
  if (!normalised) return null;

  const coupon = await db.coupon.findUnique({ where: { code: normalised } });
  if (!coupon) return null;

  const now = new Date();
  if (!coupon.isActive) return null;
  if (coupon.startsAt > now) return null;
  if (coupon.expiresAt < now) return null;
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) return null;

  // Per-customer limit.
  if (opts.customerId && coupon.perCustomerLimit > 0) {
    const used = await db.couponUsage.count({
      where: { couponId: coupon.id, customerId: opts.customerId },
    });
    if (used >= coupon.perCustomerLimit) return null;
  }

  return {
    id: coupon.id,
    code: coupon.code,
    scope: coupon.scope,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    maxDiscount: coupon.maxDiscount,
    minOrderValue: coupon.minOrderValue,
    sellerId: coupon.sellerId,
    categoryId: coupon.categoryId,
    productId: coupon.productId,
  };
}

/** Why a coupon was refused, for the cart UI. */
export async function explainCoupon(
  code: string,
  customerId?: string,
): Promise<{ valid: boolean; reason?: string }> {
  const normalised = code.trim().toUpperCase();
  const coupon = await prisma.coupon.findUnique({ where: { code: normalised } });
  if (!coupon) return { valid: false, reason: 'That coupon code was not recognised.' };

  const now = new Date();
  if (!coupon.isActive) return { valid: false, reason: 'That coupon is no longer active.' };
  if (coupon.startsAt > now) {
    return { valid: false, reason: `That coupon starts on ${coupon.startsAt.toDateString()}.` };
  }
  if (coupon.expiresAt < now) return { valid: false, reason: 'That coupon has expired.' };
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, reason: 'That coupon has been fully redeemed.' };
  }
  if (customerId && coupon.perCustomerLimit > 0) {
    const used = await prisma.couponUsage.count({
      where: { couponId: coupon.id, customerId },
    });
    if (used >= coupon.perCustomerLimit) {
      return { valid: false, reason: 'You have already used that coupon.' };
    }
  }
  return { valid: true };
}
