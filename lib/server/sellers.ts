// lib/server/sellers.ts — §4, §26. Seller onboarding and admin approval.
//
// THE CORRECTION v1 NEEDED MOST (besides the order split): registering does
// NOT make you a live seller.
//
//   register → DRAFT
//   submit   → PENDING_REVIEW      (seller can sign in, cannot sell)
//   admin opens → UNDER_REVIEW
//   admin decides → APPROVED | REJECTED
//   later → SUSPENDED | BLOCKED
//
// `requireApprovedSeller()` in auth.ts is the gate that makes this real: no
// product can be listed and no order can be fulfilled before APPROVED.
//
// KYC PRIVACY (§4 "Do NOT unnecessarily expose sensitive KYC information")
//   - Aadhaar: only the last 4 digits are stored, plus a salted hash. The full
//     number is never persisted.
//   - Bank account: same treatment — last 4 plus a hash.
//   - `publicSellerProfile()` / `sellerSelfView()` never select those columns.
//   - Documents live outside public/ and are served only to the owning seller
//     and admins, through an authorised route.

import { createHash } from 'node:crypto';
import { prisma, type Tx } from './prisma';
import { env } from './env';
import { conflict, notFound } from './http';
import { hashPassword } from './password';
import { notify, sendEmail, sellerApprovedTemplate } from './notifications';
import { audit } from './audit';
import { invalidateSettingsCache } from './settings';
import type { Role, SellerStatus } from '@prisma/client';

/** Salted one-way hash for an identifier we must be able to match but never
 *  display or recover. */
function identifierHash(value: string): string {
  return createHash('sha256').update(`${env.SESSION_SECRET}:${value}`).digest('hex');
}

export async function uniqueSellerSlug(base: string, client: Tx | typeof prisma = prisma): Promise<string> {
  const root =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'nursery';

  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const exists = await client.seller.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface SellerRegisterArgs {
  ownerName: string;
  email: string;
  password: string;
  businessName: string;
  legalName?: string;
  businessPhone: string;
  businessEmail?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  description?: string;
}

export async function registerSeller(args: SellerRegisterArgs) {
  const existing = await prisma.user.findUnique({ where: { email: args.email } });
  if (existing) {
    throw conflict('An account with that email already exists. Please sign in instead.');
  }

  const passwordHash = await hashPassword(args.password);
  const slug = await uniqueSellerSlug(args.businessName);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: args.email,
        passwordHash,
        role: 'SELLER',
        name: args.ownerName,
        phone: null, // the business phone lives on the seller record
      },
    });

    const seller = await tx.seller.create({
      data: {
        userId: user.id,
        businessName: args.businessName,
        slug,
        legalName: args.legalName ?? null,
        ownerName: args.ownerName,
        businessEmail: args.businessEmail ?? args.email,
        businessPhone: args.businessPhone,
        addressLine1: args.addressLine1,
        addressLine2: args.addressLine2 ?? null,
        city: args.city,
        state: args.state,
        pincode: args.pincode,
        description: args.description ?? null,
        // NOT active. The whole point.
        status: 'DRAFT',
      },
    });

    await tx.sellerKyc.create({
      data: { sellerId: seller.id, verificationStatus: 'DRAFT' },
    });

    await audit(tx, {
      actorId: user.id,
      actorRole: 'SELLER',
      action: 'SELLER_REGISTERED',
      entityType: 'Seller',
      entityId: seller.id,
      metadata: { businessName: args.businessName },
    });

    return { userId: user.id, sellerId: seller.id, slug, status: seller.status };
  });
}

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

export async function saveKyc(args: {
  sellerId: string;
  panNumber: string;
  gstNumber?: string;
  msmeNumber?: string;
  aadhaarNumber?: string;
}) {
  const seller = await prisma.seller.findUnique({
    where: { id: args.sellerId },
    select: { status: true },
  });
  if (!seller) throw notFound('Seller not found.');
  if (seller.status === 'APPROVED') {
    throw conflict('Your KYC is already approved. Contact support to change these details.');
  }
  if (seller.status === 'BLOCKED') throw conflict('This account is blocked.');

  const data = {
    panNumber: args.panNumber,
    gstNumber: args.gstNumber || null,
    msmeNumber: args.msmeNumber || null,
    // Full Aadhaar is deliberately NOT stored.
    aadhaarLast4: args.aadhaarNumber ? args.aadhaarNumber.slice(-4) : null,
    aadhaarHash: args.aadhaarNumber ? identifierHash(args.aadhaarNumber) : null,
    verificationStatus: 'DRAFT' as const,
    rejectionReason: null,
  };

  await prisma.sellerKyc.upsert({
    where: { sellerId: args.sellerId },
    create: { sellerId: args.sellerId, ...data },
    update: data,
  });

  return { saved: true };
}

export async function saveBankAccount(args: {
  sellerId: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  bankName?: string;
  branch?: string;
}) {
  const data = {
    accountHolderName: args.accountHolderName,
    // Same treatment as Aadhaar: last 4 in the clear, the rest hashed.
    accountLast4: args.accountNumber.slice(-4),
    accountHash: identifierHash(args.accountNumber),
    ifsc: args.ifsc,
    bankName: args.bankName ?? null,
    branch: args.branch ?? null,
    isVerified: false,
  };

  await prisma.sellerBankAccount.upsert({
    where: { sellerId: args.sellerId },
    create: { sellerId: args.sellerId, ...data },
    update: data,
  });

  return { saved: true };
}

export async function attachKycDocument(args: {
  sellerId: string;
  field: 'panDocUrl' | 'gstDocUrl' | 'addressDocUrl' | 'bankDocUrl';
  url: string;
}) {
  await prisma.sellerKyc.update({
    where: { sellerId: args.sellerId },
    data: { [args.field]: args.url },
  });
  return { saved: true };
}

/**
 * Seller submits the completed application.
 *
 * Refuses to submit an incomplete application, so admins never review empty
 * records — this is the §4 flow's "Submit Application → PENDING_REVIEW" step.
 */
export async function submitSellerApplication(args: { sellerId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const seller = await tx.seller.findUnique({
      where: { id: args.sellerId },
      include: { kyc: true, bankAccount: true },
    });
    if (!seller) throw notFound('Seller not found.');

    if (seller.status === 'PENDING_REVIEW' || seller.status === 'UNDER_REVIEW') {
      throw conflict('Your application is already submitted and under review.');
    }
    if (seller.status === 'APPROVED') throw conflict('Your account is already approved.');
    if (seller.status === 'BLOCKED' || seller.status === 'SUSPENDED') {
      throw conflict('This account cannot submit an application. Please contact support.');
    }

    const missing: string[] = [];
    if (!seller.kyc?.panNumber) missing.push('PAN number');
    if (!seller.bankAccount) missing.push('bank account details');
    if (!seller.kyc?.panDocUrl) missing.push('PAN document');
    if (!seller.addressLine1 || !seller.city || !seller.pincode) missing.push('business address');

    if (missing.length > 0) {
      throw conflict(`Please complete the following before submitting: ${missing.join(', ')}.`);
    }

    const now = new Date();
    await tx.seller.update({
      where: { id: seller.id },
      data: { status: 'PENDING_REVIEW' },
    });
    await tx.sellerKyc.update({
      where: { sellerId: seller.id },
      data: { verificationStatus: 'PENDING_REVIEW', submittedAt: now, rejectionReason: null },
    });

    // Tell every admin there's something in the queue.
    const admins = await tx.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    for (const admin of admins) {
      await notify(tx, {
        userId: admin.id,
        type: 'SELLER_APPLICATION',
        title: `New seller application: ${seller.businessName}`,
        body: 'KYC documents are ready for review.',
        linkUrl: `/admin/sellers/${seller.id}`,
      });
    }

    await audit(tx, {
      actorId: args.userId,
      actorRole: 'SELLER',
      action: 'SELLER_APPLICATION_SUBMITTED',
      entityType: 'Seller',
      entityId: seller.id,
    });

    return { status: 'PENDING_REVIEW' as SellerStatus };
  });
}

// ---------------------------------------------------------------------------
// Admin decisions
// ---------------------------------------------------------------------------

const DECISION_TO_STATUS: Record<string, SellerStatus> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  SUSPEND: 'SUSPENDED',
  BLOCK: 'BLOCKED',
  REINSTATE: 'APPROVED',
  UNDER_REVIEW: 'UNDER_REVIEW',
};

export async function decideSellerApplication(args: {
  sellerId: string;
  decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'BLOCK' | 'REINSTATE' | 'UNDER_REVIEW';
  reason?: string;
  commissionRate?: number;
  actor: { userId: string; role: Role };
}) {
  const result = await prisma.$transaction(async (tx) => {
    const seller = await tx.seller.findUnique({
      where: { id: args.sellerId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!seller) throw notFound('Seller not found.');

    const nextStatus = DECISION_TO_STATUS[args.decision];
    if (!nextStatus) throw conflict('Unknown decision.');

    if (args.decision === 'APPROVE' && seller.status === 'APPROVED') {
      throw conflict('That seller is already approved.');
    }
    if (args.decision === 'APPROVE' && !['PENDING_REVIEW', 'UNDER_REVIEW', 'REJECTED', 'SUSPENDED'].includes(seller.status)) {
      throw conflict('That seller has not submitted an application yet.');
    }

    const now = new Date();
    await tx.seller.update({
      where: { id: seller.id },
      data: {
        status: nextStatus,
        rejectionReason: ['REJECT', 'SUSPEND', 'BLOCK'].includes(args.decision)
          ? (args.reason ?? null)
          : null,
        approvedAt: nextStatus === 'APPROVED' ? (seller.approvedAt ?? now) : seller.approvedAt,
        approvedById: nextStatus === 'APPROVED' ? args.actor.userId : seller.approvedById,
        suspendedAt: ['SUSPENDED', 'BLOCKED'].includes(nextStatus) ? now : null,
        ...(args.commissionRate != null ? { commissionRate: args.commissionRate } : {}),
      },
    });

    // KYC verification status follows the seller decision.
    if (args.decision === 'APPROVE') {
      await tx.sellerKyc.updateMany({
        where: { sellerId: seller.id },
        data: {
          verificationStatus: 'APPROVED',
          reviewedById: args.actor.userId,
          reviewedAt: now,
          rejectionReason: null,
        },
      });
      await tx.sellerBankAccount.updateMany({
        where: { sellerId: seller.id },
        data: { isVerified: true },
      });
    } else if (args.decision === 'REJECT') {
      await tx.sellerKyc.updateMany({
        where: { sellerId: seller.id },
        data: {
          verificationStatus: 'REJECTED',
          reviewedById: args.actor.userId,
          reviewedAt: now,
          rejectionReason: args.reason ?? null,
        },
      });
    } else if (args.decision === 'UNDER_REVIEW') {
      await tx.sellerKyc.updateMany({
        where: { sellerId: seller.id },
        data: { verificationStatus: 'UNDER_REVIEW', reviewedById: args.actor.userId },
      });
    }

    // Suspension/blocking pulls the seller's listings off the storefront.
    if (['SUSPENDED', 'BLOCKED', 'REJECTED'].includes(nextStatus)) {
      await tx.product.updateMany({
        where: { sellerId: seller.id, status: { in: ['ACTIVE', 'OUT_OF_STOCK'] } },
        data: { status: 'INACTIVE' },
      });
    }
    // Reinstatement puts the previously-approved ones back.
    if (args.decision === 'REINSTATE') {
      await tx.product.updateMany({
        where: { sellerId: seller.id, status: 'INACTIVE', approvalStatus: 'APPROVED' },
        data: { status: 'ACTIVE' },
      });
    }

    await notify(tx, {
      userId: seller.user.id,
      type: nextStatus === 'APPROVED' ? 'SELLER_APPROVED' : 'SELLER_REJECTED',
      title:
        nextStatus === 'APPROVED'
          ? 'Your seller account is approved 🎉'
          : `Your seller account is now ${nextStatus.toLowerCase().replace('_', ' ')}`,
      body: args.reason ?? undefined,
      linkUrl: '/seller/dashboard',
    });

    await audit(tx, {
      actorId: args.actor.userId,
      actorRole: args.actor.role,
      action: `SELLER_${args.decision}`,
      entityType: 'Seller',
      entityId: seller.id,
      metadata: { reason: args.reason ?? null, commissionRate: args.commissionRate ?? null },
    });

    return {
      sellerId: seller.id,
      status: nextStatus,
      email: seller.user.email,
      businessName: seller.businessName,
      approved: nextStatus === 'APPROVED',
    };
  });

  invalidateSettingsCache();

  if (result.approved) {
    const tpl = sellerApprovedTemplate({
      businessName: result.businessName,
      dashboardUrl: `${env.APP_URL}/seller/dashboard`,
    });
    await sendEmail({ ...tpl, to: result.email });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Read models — note what each one does and does not select
// ---------------------------------------------------------------------------

/** Public storefront view. No KYC, no bank data, no contact email. */
export async function publicSellerProfile(slug: string) {
  const seller = await prisma.seller.findFirst({
    where: { slug, status: 'APPROVED' },
    select: {
      id: true,
      businessName: true,
      slug: true,
      description: true,
      logoUrl: true,
      city: true,
      state: true,
      country: true,
      ratingAvg: true,
      ratingCount: true,
      createdAt: true,
      _count: { select: { products: { where: { status: 'ACTIVE', approvalStatus: 'APPROVED' } } } },
    },
  });
  if (!seller) throw notFound('Seller not found.');
  return seller;
}

/** The seller's own profile page: their KYC STATUS, never the numbers. */
export async function sellerSelfView(sellerId: string) {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      businessName: true,
      slug: true,
      legalName: true,
      ownerName: true,
      businessEmail: true,
      businessPhone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      pincode: true,
      country: true,
      description: true,
      logoUrl: true,
      status: true,
      commissionRate: true,
      rejectionReason: true,
      approvedAt: true,
      ratingAvg: true,
      ratingCount: true,
      createdAt: true,
      kyc: {
        select: {
          verificationStatus: true,
          rejectionReason: true,
          submittedAt: true,
          reviewedAt: true,
          // Masked identifiers only — enough to confirm what's on file.
          aadhaarLast4: true,
          gstNumber: true,
          msmeNumber: true,
          panNumber: true,
          // Document presence, not the documents themselves.
          panDocUrl: true,
          gstDocUrl: true,
          addressDocUrl: true,
          bankDocUrl: true,
        },
      },
      bankAccount: {
        select: {
          accountHolderName: true,
          accountLast4: true,
          ifsc: true,
          bankName: true,
          branch: true,
          isVerified: true,
        },
      },
    },
  });
  if (!seller) throw notFound('Seller not found.');

  // Mask PAN even for the owner's own view: ABCDE1234F → ABxxxxx34F
  const kyc = seller.kyc
    ? {
        ...seller.kyc,
        panNumber: seller.kyc.panNumber ? maskPan(seller.kyc.panNumber) : null,
        panDocUrl: undefined,
        gstDocUrl: undefined,
        addressDocUrl: undefined,
        bankDocUrl: undefined,
        documents: {
          pan: Boolean(seller.kyc.panDocUrl),
          gst: Boolean(seller.kyc.gstDocUrl),
          address: Boolean(seller.kyc.addressDocUrl),
          bank: Boolean(seller.kyc.bankDocUrl),
        },
      }
    : null;

  return { ...seller, kyc };
}

/** Admin review view: the identifiers an admin genuinely needs to verify,
 *  and document links. Every access is audited by the calling route. */
export async function adminSellerDetail(sellerId: string) {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      user: { select: { id: true, email: true, name: true, createdAt: true, lastLoginAt: true } },
      kyc: true,
      bankAccount: {
        select: {
          accountHolderName: true,
          accountLast4: true,
          ifsc: true,
          bankName: true,
          branch: true,
          isVerified: true,
          // accountHash is never returned to anyone.
        },
      },
      _count: { select: { products: true, sellerOrders: true } },
    },
  });
  if (!seller) throw notFound('Seller not found.');

  const kyc = seller.kyc
    ? { ...seller.kyc, aadhaarHash: undefined } // the hash has no review value
    : null;

  return { ...seller, kyc };
}

export async function listSellersForAdmin(opts: {
  status?: SellerStatus;
  q?: string;
  page?: number;
  perPage?: number;
}) {
  const page = opts.page ?? 1;
  const perPage = Math.min(opts.perPage ?? 20, 100);

  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.q
      ? {
          OR: [
            { businessName: { contains: opts.q, mode: 'insensitive' as const } },
            { ownerName: { contains: opts.q, mode: 'insensitive' as const } },
            { businessEmail: { contains: opts.q, mode: 'insensitive' as const } },
            { city: { contains: opts.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.seller.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        businessName: true,
        ownerName: true,
        businessEmail: true,
        businessPhone: true,
        city: true,
        state: true,
        status: true,
        commissionRate: true,
        createdAt: true,
        approvedAt: true,
        kyc: { select: { verificationStatus: true, submittedAt: true } },
        _count: { select: { products: true, sellerOrders: true } },
      },
    }),
    prisma.seller.count({ where }),
  ]);

  return { rows, total, page, perPage, pages: Math.ceil(total / perPage) };
}

function maskPan(pan: string): string {
  if (pan.length !== 10) return '••••••';
  return `${pan.slice(0, 2)}${'x'.repeat(5)}${pan.slice(7)}`;
}

/** Seller dashboard headline numbers (§5 "Dashboard"). */
export async function getSellerDashboardStats(sellerId: string) {
  const [orderGroups, captured, lowStock, productCounts, returnsCount] = await Promise.all([
    prisma.sellerOrder.groupBy({
      by: ['status'],
      where: { sellerId, paymentStatus: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      _count: true,
    }),
    prisma.sellerOrder.aggregate({
      where: { sellerId, paymentStatus: 'CAPTURED' },
      _sum: { grossAmount: true, commissionAmount: true, sellerEarning: true },
      _count: true,
    }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "inventory" i
      JOIN "products" p ON p."id" = i."productId"
      WHERE p."sellerId" = ${sellerId}
        AND (i."onHand" - i."reserved") <= i."lowStockThreshold"
    `,
    prisma.product.groupBy({ by: ['status'], where: { sellerId }, _count: true }),
    prisma.returnRequest.count({
      where: { sellerOrder: { sellerId }, status: { notIn: ['REJECTED', 'CANCELLED', 'COMPLETED'] } },
    }),
  ]);

  const countOf = (...statuses: string[]) =>
    orderGroups.filter((g) => statuses.includes(g.status)).reduce((a, g) => a + g._count, 0);

  return {
    totalSales: captured._sum.grossAmount ?? 0,
    totalOrders: captured._count,
    pendingOrders: countOf('PENDING', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'),
    inTransitOrders: countOf('SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'),
    deliveredOrders: countOf('DELIVERED'),
    cancelledOrders: countOf('CANCELLED'),
    returns: returnsCount,
    commission: captured._sum.commissionAmount ?? 0,
    earnings: captured._sum.sellerEarning ?? 0,
    lowStockCount: Number(lowStock[0]?.count ?? 0),
    products: productCounts.map((p) => ({ status: p.status, count: p._count })),
    liveProducts: productCounts.find((p) => p.status === 'ACTIVE')?._count ?? 0,
  };
}
