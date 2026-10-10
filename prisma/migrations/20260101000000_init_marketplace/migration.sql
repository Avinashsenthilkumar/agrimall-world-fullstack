-- AgriMall World — initial multi-vendor marketplace migration (PostgreSQL).
-- Generated to match prisma/schema.prisma.

-- ===========================================================================
-- ENUMS
-- ===========================================================================
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'SELLER', 'ADMIN', 'LOGISTICS');
CREATE TYPE "SellerStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED');
CREATE TYPE "KycStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ACTIVE', 'INACTIVE', 'OUT_OF_STOCK');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_FAILED', 'CONFIRMED', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED', 'PARTIALLY_CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "SellerOrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED', 'REFUNDED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'STRIPE', 'COD');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'ON_HOLD');
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'EARNED', 'REVERSED');
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_DELIVERY', 'RETURNED');
CREATE TYPE "TrackingEventType" AS ENUM ('ORDER_CONFIRMED', 'PACKED', 'READY_FOR_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURN_PICKED_UP', 'RETURN_DELIVERED');
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED', 'INSPECTED', 'REFUND_INITIATED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');
CREATE TYPE "CouponScope" AS ENUM ('PLATFORM', 'SELLER', 'CATEGORY', 'PRODUCT');
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "InventoryReason" AS ENUM ('SEED', 'RESTOCK', 'MANUAL_ADJUST', 'RESERVE', 'RELEASE_RESERVATION', 'COMMIT_SALE', 'CANCEL_RESTOCK', 'RETURN_RESTOCK');
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'COMMITTED', 'RELEASED');
CREATE TYPE "NotificationType" AS ENUM ('SELLER_APPLICATION', 'SELLER_APPROVED', 'SELLER_REJECTED', 'PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'NEW_ORDER', 'ORDER_STATUS', 'PAYOUT', 'RETURN_REQUEST', 'REFUND');

-- ===========================================================================
-- IDENTITY
-- ===========================================================================
CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
  "name" TEXT,
  "emailVerifiedAt" TIMESTAMP(3),
  "phoneVerifiedAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userAgent" TEXT,
  "ip" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verification_tokens" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sellers" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "legalName" TEXT,
  "ownerName" TEXT NOT NULL,
  "businessEmail" TEXT NOT NULL,
  "businessPhone" TEXT NOT NULL,
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "state" TEXT,
  "pincode" TEXT,
  "country" TEXT NOT NULL DEFAULT 'India',
  "description" TEXT,
  "logoUrl" TEXT,
  "status" "SellerStatus" NOT NULL DEFAULT 'DRAFT',
  "commissionRate" DECIMAL(5,2),
  "rejectionReason" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "suspendedAt" TIMESTAMP(3),
  "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
  "ratingCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seller_kyc" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "panNumber" TEXT,
  "gstNumber" TEXT,
  "msmeNumber" TEXT,
  "aadhaarLast4" TEXT,
  "aadhaarHash" TEXT,
  "panDocUrl" TEXT,
  "gstDocUrl" TEXT,
  "addressDocUrl" TEXT,
  "bankDocUrl" TEXT,
  "verificationStatus" "KycStatus" NOT NULL DEFAULT 'DRAFT',
  "rejectionReason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_kyc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seller_bank_accounts" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "accountHolderName" TEXT NOT NULL,
  "accountLast4" TEXT NOT NULL,
  "accountHash" TEXT NOT NULL,
  "ifsc" TEXT NOT NULL,
  "bankName" TEXT,
  "branch" TEXT,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "addresses" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "label" TEXT DEFAULT 'Home',
  "fullName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "line1" TEXT NOT NULL,
  "line2" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "pincode" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'India',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- CATALOG
-- ===========================================================================
CREATE TABLE "categories" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "parentId" TEXT,
  "imageUrl" TEXT,
  "description" TEXT,
  "commissionRate" DECIMAL(5,2),
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brands" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "logoUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "brandId" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "latinName" TEXT,
  "description" TEXT,
  "sku" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "compareAtPrice" INTEGER,
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "weightGrams" INTEGER,
  "lengthMm" INTEGER,
  "widthMm" INTEGER,
  "heightMm" INTEGER,
  "careLight" TEXT,
  "careWater" TEXT,
  "careTemp" TEXT,
  "careDifficulty" TEXT,
  "careSafety" TEXT,
  "originLabel" TEXT,
  "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
  "ratingCount" INTEGER NOT NULL DEFAULT 0,
  "soldCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_price_nonneg" CHECK ("price" >= 0),
  CONSTRAINT "products_compare_nonneg" CHECK ("compareAtPrice" IS NULL OR "compareAtPrice" >= 0)
);

CREATE TABLE "product_images" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "alt" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_variants" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "price" INTEGER,
  "compareAtPrice" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- INVENTORY
-- ===========================================================================
CREATE TABLE "inventory" (
  "id" TEXT NOT NULL,
  "productId" TEXT,
  "variantId" TEXT,
  "onHand" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_pkey" PRIMARY KEY ("id"),
  -- THE anti-overselling guarantee (§11): these can never be violated, no
  -- matter how many concurrent checkouts race.
  CONSTRAINT "inventory_onhand_nonneg" CHECK ("onHand" >= 0),
  CONSTRAINT "inventory_reserved_nonneg" CHECK ("reserved" >= 0),
  CONSTRAINT "inventory_available_nonneg" CHECK ("onHand" - "reserved" >= 0)
);

CREATE TABLE "inventory_movements" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "sellerId" TEXT NOT NULL,
  "reason" "InventoryReason" NOT NULL,
  "delta" INTEGER NOT NULL,
  "reservedDelta" INTEGER NOT NULL DEFAULT 0,
  "onHandAfter" INTEGER NOT NULL,
  "reservedAfter" INTEGER NOT NULL,
  "refType" TEXT,
  "refId" TEXT,
  "note" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_reservations" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "quantity" INTEGER NOT NULL,
  "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_reservations_qty_pos" CHECK ("quantity" > 0)
);

-- ===========================================================================
-- CART & WISHLIST
-- ===========================================================================
CREATE TABLE "carts" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cart_items" (
  "id" TEXT NOT NULL,
  "cartId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "quantity" INTEGER NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cart_items_qty_pos" CHECK ("quantity" > 0)
);

CREATE TABLE "wishlists" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wishlists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wishlist_items" (
  "id" TEXT NOT NULL,
  "wishlistId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- ORDERS
-- ===========================================================================
CREATE TABLE "orders" (
  "id" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "subtotal" INTEGER NOT NULL,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "tax" INTEGER NOT NULL DEFAULT 0,
  "shippingFee" INTEGER NOT NULL DEFAULT 0,
  "grandTotal" INTEGER NOT NULL,
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "orderStatus" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "billingAddress" JSONB NOT NULL,
  "shippingAddress" JSONB NOT NULL,
  "couponCode" TEXT,
  "customerNote" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "reservationExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_totals_nonneg" CHECK ("subtotal" >= 0 AND "grandTotal" >= 0 AND "discount" >= 0)
);

CREATE TABLE "seller_orders" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "sellerOrderNumber" TEXT NOT NULL,
  "subtotal" INTEGER NOT NULL,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "tax" INTEGER NOT NULL DEFAULT 0,
  "shippingFee" INTEGER NOT NULL DEFAULT 0,
  "grossAmount" INTEGER NOT NULL,
  "commissionRate" DECIMAL(5,2) NOT NULL,
  "commissionAmount" INTEGER NOT NULL,
  "sellerEarning" INTEGER NOT NULL,
  "status" "SellerOrderStatus" NOT NULL DEFAULT 'PENDING',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "acceptedAt" TIMESTAMP(3),
  "packedAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_orders_pkey" PRIMARY KEY ("id"),
  -- The money identity that must always hold (§12).
  CONSTRAINT "seller_orders_money_split" CHECK ("commissionAmount" + "sellerEarning" = "grossAmount"),
  CONSTRAINT "seller_orders_money_nonneg" CHECK ("commissionAmount" >= 0 AND "sellerEarning" >= 0 AND "grossAmount" >= 0)
);

CREATE TABLE "seller_order_status_logs" (
  "id" TEXT NOT NULL,
  "sellerOrderId" TEXT NOT NULL,
  "fromStatus" "SellerOrderStatus",
  "toStatus" "SellerOrderStatus" NOT NULL,
  "actorId" TEXT,
  "actorRole" "Role",
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seller_order_status_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_items" (
  "id" TEXT NOT NULL,
  "sellerOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "sellerId" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "skuSnapshot" TEXT NOT NULL,
  "imageSnapshot" TEXT,
  "variantSnapshot" TEXT,
  "quantity" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "tax" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_qty_pos" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_price_nonneg" CHECK ("unitPrice" >= 0 AND "total" >= 0)
);

-- ===========================================================================
-- PAYMENTS
-- ===========================================================================
CREATE TABLE "payments" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerOrderId" TEXT,
  "providerPaymentId" TEXT,
  "providerSignature" TEXT,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "method" TEXT,
  "failureReason" TEXT,
  "capturedAt" TIMESTAMP(3),
  "refundedAmount" INTEGER NOT NULL DEFAULT 0,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_amount_nonneg" CHECK ("amount" >= 0)
);

CREATE TABLE "webhook_events" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- COMMISSION & PAYOUT
-- ===========================================================================
CREATE TABLE "commissions" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sellerOrderId" TEXT NOT NULL,
  "rate" DECIMAL(5,2) NOT NULL,
  "grossAmount" INTEGER NOT NULL,
  "commissionAmount" INTEGER NOT NULL,
  "sellerAmount" INTEGER NOT NULL,
  "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
  "reversedAmount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commissions_split" CHECK ("commissionAmount" + "sellerAmount" = "grossAmount")
);

CREATE TABLE "payouts" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "sellerOrderId" TEXT NOT NULL,
  "grossAmount" INTEGER NOT NULL,
  "commissionAmount" INTEGER NOT NULL,
  "refundAdjustment" INTEGER NOT NULL DEFAULT 0,
  "netAmount" INTEGER NOT NULL,
  "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "providerReference" TEXT,
  "failureReason" TEXT,
  "processedAt" TIMESTAMP(3),
  "eligibleAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- SHIPPING & TRACKING
-- ===========================================================================
CREATE TABLE "shipments" (
  "id" TEXT NOT NULL,
  "sellerOrderId" TEXT NOT NULL,
  "courier" TEXT,
  "trackingNumber" TEXT,
  "awbNumber" TEXT,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
  "estimatedDelivery" TIMESTAMP(3),
  "actualDelivery" TIMESTAMP(3),
  "pickupDate" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "shippingLabelUrl" TEXT,
  "weightGrams" INTEGER,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracking_events" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "status" "TrackingEventType" NOT NULL,
  "location" TEXT,
  "message" TEXT,
  "eventTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- RETURNS & REFUNDS
-- ===========================================================================
CREATE TABLE "returns" (
  "id" TEXT NOT NULL,
  "returnNumber" TEXT NOT NULL,
  "sellerOrderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "description" TEXT,
  "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
  "imageUrls" JSONB,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "pickupScheduledAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "inspectionNote" TEXT,
  "restock" BOOLEAN NOT NULL DEFAULT true,
  "refundAmount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "return_items" (
  "id" TEXT NOT NULL,
  "returnId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "refundAmount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_items_qty_pos" CHECK ("quantity" > 0)
);

CREATE TABLE "refunds" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sellerOrderId" TEXT,
  "paymentId" TEXT,
  "returnId" TEXT,
  "amount" INTEGER NOT NULL,
  "commissionReversed" INTEGER NOT NULL DEFAULT 0,
  "sellerDebit" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "providerRefundId" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refunds_amount_nonneg" CHECK ("amount" >= 0)
);

-- ===========================================================================
-- REVIEWS
-- ===========================================================================
CREATE TABLE "reviews" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "title" TEXT,
  "comment" TEXT,
  "imageUrls" JSONB,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
  "sellerReply" TEXT,
  "sellerRepliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5)
);

-- ===========================================================================
-- COUPONS
-- ===========================================================================
CREATE TABLE "coupons" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "scope" "CouponScope" NOT NULL DEFAULT 'PLATFORM',
  "description" TEXT,
  "discountType" "DiscountType" NOT NULL,
  "discountValue" INTEGER NOT NULL,
  "maxDiscount" INTEGER,
  "minOrderValue" INTEGER NOT NULL DEFAULT 0,
  "sellerId" TEXT,
  "categoryId" TEXT,
  "productId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usageLimit" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coupons_value_pos" CHECK ("discountValue" > 0),
  CONSTRAINT "coupons_window" CHECK ("expiresAt" > "startsAt"),
  CONSTRAINT "coupons_percent_range" CHECK ("discountType" <> 'PERCENT' OR ("discountValue" > 0 AND "discountValue" <= 100))
);

CREATE TABLE "coupon_usage" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "discount" INTEGER NOT NULL,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupon_usage_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- PLATFORM
-- ===========================================================================
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "linkUrl" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_settings" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorRole" "Role",
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- UNIQUE INDEXES
-- ===========================================================================
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");
CREATE UNIQUE INDEX "customers_userId_key" ON "customers"("userId");
CREATE UNIQUE INDEX "sellers_userId_key" ON "sellers"("userId");
CREATE UNIQUE INDEX "sellers_slug_key" ON "sellers"("slug");
CREATE UNIQUE INDEX "seller_kyc_sellerId_key" ON "seller_kyc"("sellerId");
CREATE UNIQUE INDEX "seller_bank_accounts_sellerId_key" ON "seller_bank_accounts"("sellerId");
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE UNIQUE INDEX "products_sellerId_sku_key" ON "products"("sellerId", "sku");
CREATE UNIQUE INDEX "product_variants_productId_sku_key" ON "product_variants"("productId", "sku");
CREATE UNIQUE INDEX "inventory_productId_key" ON "inventory"("productId");
CREATE UNIQUE INDEX "inventory_variantId_key" ON "inventory"("variantId");
CREATE UNIQUE INDEX "carts_customerId_key" ON "carts"("customerId");
CREATE UNIQUE INDEX "wishlists_customerId_key" ON "wishlists"("customerId");
CREATE UNIQUE INDEX "wishlist_items_wishlistId_productId_key" ON "wishlist_items"("wishlistId", "productId");
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");
CREATE UNIQUE INDEX "seller_orders_sellerOrderNumber_key" ON "seller_orders"("sellerOrderNumber");
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");
CREATE UNIQUE INDEX "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");
CREATE UNIQUE INDEX "commissions_sellerOrderId_key" ON "commissions"("sellerOrderId");
CREATE UNIQUE INDEX "payouts_sellerOrderId_key" ON "payouts"("sellerOrderId");
CREATE UNIQUE INDEX "returns_returnNumber_key" ON "returns"("returnNumber");
CREATE UNIQUE INDEX "return_items_returnId_orderItemId_key" ON "return_items"("returnId", "orderItemId");
CREATE UNIQUE INDEX "refunds_returnId_key" ON "refunds"("returnId");
CREATE UNIQUE INDEX "reviews_orderItemId_key" ON "reviews"("orderItemId");
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");
CREATE UNIQUE INDEX "coupon_usage_couponId_orderId_key" ON "coupon_usage"("couponId", "orderId");

-- cart_items unique treats NULL variantId as distinct in Postgres, which would
-- allow duplicate rows for the same product. Prisma's @@unique can't express
-- NULLS NOT DISTINCT, so we add both forms explicitly.
CREATE UNIQUE INDEX "cart_items_cartId_productId_variantId_key"
  ON "cart_items"("cartId", "productId", "variantId") NULLS NOT DISTINCT;

-- ===========================================================================
-- LOOKUP INDEXES (§22)
-- ===========================================================================
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE INDEX "verification_tokens_userId_purpose_idx" ON "verification_tokens"("userId", "purpose");
CREATE INDEX "sellers_status_idx" ON "sellers"("status");
CREATE INDEX "sellers_slug_idx" ON "sellers"("slug");
CREATE INDEX "sellers_createdAt_idx" ON "sellers"("createdAt");
CREATE INDEX "seller_kyc_verificationStatus_idx" ON "seller_kyc"("verificationStatus");
CREATE INDEX "addresses_customerId_idx" ON "addresses"("customerId");
CREATE INDEX "categories_slug_idx" ON "categories"("slug");
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");
CREATE INDEX "brands_slug_idx" ON "brands"("slug");
CREATE INDEX "products_sellerId_idx" ON "products"("sellerId");
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");
CREATE INDEX "products_status_approvalStatus_idx" ON "products"("status", "approvalStatus");
CREATE INDEX "products_slug_idx" ON "products"("slug");
CREATE INDEX "products_sku_idx" ON "products"("sku");
CREATE INDEX "products_createdAt_idx" ON "products"("createdAt");
CREATE INDEX "product_images_productId_idx" ON "product_images"("productId");
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");
CREATE INDEX "inventory_movements_productId_createdAt_idx" ON "inventory_movements"("productId", "createdAt");
CREATE INDEX "inventory_movements_sellerId_createdAt_idx" ON "inventory_movements"("sellerId", "createdAt");
CREATE INDEX "inventory_movements_refType_refId_idx" ON "inventory_movements"("refType", "refId");
CREATE INDEX "stock_reservations_orderId_idx" ON "stock_reservations"("orderId");
CREATE INDEX "stock_reservations_status_expiresAt_idx" ON "stock_reservations"("status", "expiresAt");
CREATE INDEX "cart_items_cartId_idx" ON "cart_items"("cartId");
CREATE INDEX "wishlist_items_wishlistId_idx" ON "wishlist_items"("wishlistId");
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt");
CREATE INDEX "orders_orderStatus_idx" ON "orders"("orderStatus");
CREATE INDEX "orders_paymentStatus_idx" ON "orders"("paymentStatus");
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");
CREATE INDEX "orders_orderNumber_idx" ON "orders"("orderNumber");
CREATE INDEX "seller_orders_orderId_idx" ON "seller_orders"("orderId");
CREATE INDEX "seller_orders_sellerId_createdAt_idx" ON "seller_orders"("sellerId", "createdAt");
CREATE INDEX "seller_orders_status_idx" ON "seller_orders"("status");
CREATE INDEX "seller_orders_payoutStatus_idx" ON "seller_orders"("payoutStatus");
CREATE INDEX "seller_orders_sellerOrderNumber_idx" ON "seller_orders"("sellerOrderNumber");
CREATE INDEX "seller_order_status_logs_sellerOrderId_createdAt_idx" ON "seller_order_status_logs"("sellerOrderId", "createdAt");
CREATE INDEX "order_items_sellerOrderId_idx" ON "order_items"("sellerOrderId");
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");
CREATE INDEX "order_items_sellerId_idx" ON "order_items"("sellerId");
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "payments_providerOrderId_idx" ON "payments"("providerOrderId");
CREATE INDEX "webhook_events_processedAt_idx" ON "webhook_events"("processedAt");
CREATE INDEX "commissions_sellerId_createdAt_idx" ON "commissions"("sellerId", "createdAt");
CREATE INDEX "commissions_orderId_idx" ON "commissions"("orderId");
CREATE INDEX "commissions_status_idx" ON "commissions"("status");
CREATE INDEX "payouts_sellerId_status_idx" ON "payouts"("sellerId", "status");
CREATE INDEX "payouts_status_eligibleAt_idx" ON "payouts"("status", "eligibleAt");
CREATE INDEX "shipments_sellerOrderId_idx" ON "shipments"("sellerOrderId");
CREATE INDEX "shipments_trackingNumber_idx" ON "shipments"("trackingNumber");
CREATE INDEX "shipments_status_idx" ON "shipments"("status");
CREATE INDEX "tracking_events_shipmentId_eventTime_idx" ON "tracking_events"("shipmentId", "eventTime");
CREATE INDEX "returns_sellerOrderId_idx" ON "returns"("sellerOrderId");
CREATE INDEX "returns_customerId_idx" ON "returns"("customerId");
CREATE INDEX "returns_status_idx" ON "returns"("status");
CREATE INDEX "return_items_returnId_idx" ON "return_items"("returnId");
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");
CREATE INDEX "refunds_sellerOrderId_idx" ON "refunds"("sellerOrderId");
CREATE INDEX "refunds_status_idx" ON "refunds"("status");
CREATE INDEX "reviews_productId_status_idx" ON "reviews"("productId", "status");
CREATE INDEX "reviews_customerId_idx" ON "reviews"("customerId");
CREATE INDEX "coupons_code_idx" ON "coupons"("code");
CREATE INDEX "coupons_isActive_startsAt_expiresAt_idx" ON "coupons"("isActive", "startsAt", "expiresAt");
CREATE INDEX "coupon_usage_couponId_customerId_idx" ON "coupon_usage"("couponId", "customerId");
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- ===========================================================================
-- FOREIGN KEYS
-- ===========================================================================
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_kyc" ADD CONSTRAINT "seller_kyc_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "carts" ADD CONSTRAINT "carts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlistId_fkey" FOREIGN KEY ("wishlistId") REFERENCES "wishlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_order_status_logs" ADD CONSTRAINT "seller_order_status_logs_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "returns" ADD CONSTRAINT "returns_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "returns" ADD CONSTRAINT "returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An inventory row must point at exactly one of product / variant.
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_one_target"
  CHECK (("productId" IS NOT NULL AND "variantId" IS NULL) OR ("productId" IS NULL AND "variantId" IS NOT NULL));

-- A coupon's scope must match the target column that is set.
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_scope_target" CHECK (
  ("scope" = 'PLATFORM' AND "sellerId" IS NULL AND "categoryId" IS NULL AND "productId" IS NULL) OR
  ("scope" = 'SELLER'   AND "sellerId" IS NOT NULL) OR
  ("scope" = 'CATEGORY' AND "categoryId" IS NOT NULL) OR
  ("scope" = 'PRODUCT'  AND "productId" IS NOT NULL)
);
