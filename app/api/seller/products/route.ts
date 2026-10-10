// GET  /api/seller/products — this seller's listings only.
// POST /api/seller/products — create a listing (goes to PENDING_APPROVAL, §7).
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, created, parseBody, parseQuery, conflict } from '../../../../lib/server/http';
import { requireSeller, requireApprovedSeller } from '../../../../lib/server/auth';
import { productCreateSchema, paginationSchema } from '../../../../lib/server/schemas';
import { uniqueSellerSlug } from '../../../../lib/server/sellers';
import { notify } from '../../../../lib/server/notifications';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request) => {
  const session = await requireSeller();
  const { page, perPage } = parseQuery(req, paginationSchema);
  const status = new URL(req.url).searchParams.get('status');

  // sellerId comes from the session — a seller cannot query another's catalogue.
  const where = {
    sellerId: session.sellerId,
    ...(status ? { status: status as never } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
        category: { select: { id: true, name: true, slug: true } },
        inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } },
        _count: { select: { orderItems: true, reviews: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return ok({
    products: rows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      status: p.status,
      approvalStatus: p.approvalStatus,
      rejectionReason: p.rejectionReason,
      imageUrl: p.images[0]?.url ?? null,
      category: p.category,
      stock: {
        onHand: p.inventory?.onHand ?? 0,
        reserved: p.inventory?.reserved ?? 0,
        available: p.inventory ? p.inventory.onHand - p.inventory.reserved : 0,
        lowStockThreshold: p.inventory?.lowStockThreshold ?? 10,
        isLow: p.inventory
          ? p.inventory.onHand - p.inventory.reserved <= p.inventory.lowStockThreshold
          : true,
      },
      soldCount: p.soldCount,
      rating: Number(p.ratingAvg),
      reviewCount: p._count.reviews,
      createdAt: p.createdAt,
    })),
    pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
  });
});

export const POST = handler(async (req: Request) => {
  // Listing requires APPROVAL — this is the §4 gate in action.
  const session = await requireApprovedSeller();
  const body = await parseBody(req, productCreateSchema);

  const category = await prisma.category.findUnique({
    where: { id: body.categoryId },
    select: { id: true, isActive: true, name: true },
  });
  if (!category || !category.isActive) throw conflict('Please choose a valid category.');

  const duplicate = await prisma.product.findFirst({
    where: { sellerId: session.sellerId, sku: body.sku },
    select: { id: true },
  });
  if (duplicate) throw conflict(`You already have a product with SKU ${body.sku}.`);

  const seller = await prisma.seller.findUnique({
    where: { id: session.sellerId },
    select: { businessName: true, city: true, state: true },
  });

  const slug = await uniqueProductSlug(body.name);

  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.product.create({
      data: {
        sellerId: session.sellerId,
        categoryId: body.categoryId,
        brandId: body.brandId ?? null,
        name: body.name,
        slug,
        latinName: body.latinName ?? null,
        description: body.description ?? null,
        sku: body.sku,
        price: body.price,
        compareAtPrice: body.compareAtPrice ?? null,
        taxRate: body.taxRate,
        weightGrams: body.weightGrams ?? null,
        lengthMm: body.lengthMm ?? null,
        widthMm: body.widthMm ?? null,
        heightMm: body.heightMm ?? null,
        careLight: body.careLight ?? null,
        careWater: body.careWater ?? null,
        careTemp: body.careTemp ?? null,
        careDifficulty: body.careDifficulty ?? null,
        careSafety: body.careSafety ?? null,
        originLabel: [seller?.businessName, seller?.state].filter(Boolean).join(', '),
        // A new listing is never live immediately (§7).
        status: body.submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT',
        approvalStatus: 'PENDING',
      },
    });

    if (body.imageUrls.length > 0) {
      await tx.productImage.createMany({
        data: body.imageUrls.map((url, i) => ({
          productId: p.id,
          url,
          alt: body.name,
          sortOrder: i,
          isPrimary: i === 0,
        })),
      });
    }

    await tx.inventory.create({
      data: {
        productId: p.id,
        onHand: body.stock,
        reserved: 0,
        lowStockThreshold: body.lowStockThreshold,
      },
    });

    await tx.inventoryMovement.create({
      data: {
        productId: p.id,
        sellerId: session.sellerId,
        reason: 'SEED',
        delta: body.stock,
        onHandAfter: body.stock,
        reservedAfter: 0,
        refType: 'MANUAL',
        actorId: session.userId,
        note: 'Initial stock on listing creation',
      },
    });

    if (body.submitForApproval) {
      const admins = await tx.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { id: true },
      });
      for (const admin of admins) {
        await notify(tx, {
          userId: admin.id,
          type: 'SELLER_APPLICATION',
          title: `New listing awaiting approval: ${body.name}`,
          body: `${seller?.businessName ?? 'A seller'} submitted a new product.`,
          linkUrl: `/admin/products?status=PENDING`,
        });
      }
    }

    return p;
  });

  return created({
    product: {
      id: product.id,
      name: product.name,
      slug: product.slug,
      status: product.status,
      approvalStatus: product.approvalStatus,
    },
    message: body.submitForApproval
      ? 'Your listing has been submitted for approval and will go live once reviewed.'
      : 'Saved as a draft. Submit it for approval when you are ready.',
  });
});

async function uniqueProductSlug(name: string): Promise<string> {
  const root =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'plant';
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const exists = await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}
