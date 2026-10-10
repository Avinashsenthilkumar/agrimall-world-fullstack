// GET  /api/cart — the cart, grouped by seller, priced by the server (§9).
// POST /api/cart — add an item.
//
// The cart stores only product + quantity. Prices are re-derived on every
// read, so a price change is reflected the moment the customer reloads.
import { prisma } from '../../../lib/server/prisma';
import { handler, ok, created, parseBody, conflict } from '../../../lib/server/http';
import { requireCustomer } from '../../../lib/server/auth';
import { cartAddSchema } from '../../../lib/server/schemas';
import { resolveCart } from '../../../lib/server/pricing';
import { getAvailability } from '../../../lib/server/inventory';

export const dynamic = 'force-dynamic';

async function cartOf(customerId: string) {
  const existing = await prisma.cart.findUnique({ where: { customerId } });
  if (existing) return existing;
  return prisma.cart.create({ data: { customerId } });
}

export const GET = handler(async () => {
  const session = await requireCustomer();
  const cart = await cartOf(session.customerId);

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { addedAt: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          compareAtPrice: true,
          status: true,
          approvalStatus: true,
          images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
          seller: { select: { id: true, businessName: true, slug: true, status: true } },
          inventory: { select: { onHand: true, reserved: true } },
        },
      },
      variant: { select: { id: true, name: true, value: true, price: true } },
    },
  });

  if (items.length === 0) {
    return ok({ items: [], groups: [], totals: null, issues: [] });
  }

  // Separate the lines that can still be bought from those that can't, so the
  // cart page can show "no longer available" instead of failing to load.
  const issues: Array<{ cartItemId: string; productName: string; problem: string }> = [];
  const buyable: typeof items = [];

  for (const item of items) {
    const p = item.product;
    const available = p.inventory ? Math.max(0, p.inventory.onHand - p.inventory.reserved) : 0;

    if (p.approvalStatus !== 'APPROVED' || p.seller.status !== 'APPROVED') {
      issues.push({ cartItemId: item.id, productName: p.name, problem: 'No longer available' });
    } else if (p.status !== 'ACTIVE' || available === 0) {
      issues.push({ cartItemId: item.id, productName: p.name, problem: 'Out of stock' });
    } else if (available < item.quantity) {
      issues.push({
        cartItemId: item.id,
        productName: p.name,
        problem: `Only ${available} left — quantity reduced`,
      });
      buyable.push({ ...item, quantity: available });
    } else {
      buyable.push(item);
    }
  }

  if (buyable.length === 0) {
    return ok({ items: [], groups: [], totals: null, issues });
  }

  // Price the buyable lines with the real engine.
  const { quote } = await resolveCart(
    buyable.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
    { enforceStock: false, customerId: session.customerId },
  );

  const itemMeta = new Map(
    buyable.map((i) => [
      `${i.productId}::${i.variantId ?? ''}`,
      {
        cartItemId: i.id,
        imageUrl: i.product.images[0]?.url ?? null,
        slug: i.product.slug,
        compareAtPrice: i.product.compareAtPrice,
        variantLabel: i.variant ? `${i.variant.name}: ${i.variant.value}` : null,
      },
    ]),
  );

  const sellerNames = new Map(
    buyable.map((i) => [i.product.seller.id, i.product.seller]),
  );

  return ok({
    // Grouped by seller — this is what makes the multi-vendor basket legible.
    groups: quote.perSeller.map((g) => ({
      seller: sellerNames.get(g.sellerId) ?? { id: g.sellerId, businessName: 'Seller' },
      lines: g.lines.map((l) => {
        const meta = itemMeta.get(l.ref);
        return {
          cartItemId: meta?.cartItemId,
          productId: l.productId,
          variantId: l.variantId,
          name: l.snapshot.productName,
          slug: meta?.slug,
          imageUrl: meta?.imageUrl,
          variantLabel: meta?.variantLabel,
          unitPrice: l.unitPrice,
          compareAtPrice: meta?.compareAtPrice ?? null,
          quantity: l.quantity,
          lineSubtotal: l.lineSubtotal,
          lineDiscount: l.lineDiscount,
          lineTax: l.lineTax,
          lineTotal: l.lineTotal,
        };
      }),
      subtotal: g.subtotal,
      discount: g.discount,
      tax: g.tax,
      shippingFee: g.shippingFee,
      total: g.grossAmount,
    })),
    totals: {
      subtotal: quote.subtotal,
      discount: quote.discount,
      tax: quote.tax,
      shippingFee: quote.shippingFee,
      grandTotal: quote.grandTotal,
      itemCount: quote.perSeller.reduce((a, g) => a + g.lines.reduce((b, l) => b + l.quantity, 0), 0),
      sellerCount: quote.perSeller.length,
    },
    issues,
  });
});

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = await parseBody(req, cartAddSchema);

  const product = await prisma.product.findUnique({
    where: { id: body.productId },
    select: {
      id: true,
      name: true,
      status: true,
      approvalStatus: true,
      seller: { select: { status: true } },
    },
  });
  if (!product || product.approvalStatus !== 'APPROVED' || product.seller.status !== 'APPROVED') {
    throw conflict('That plant is not available.');
  }
  if (product.status !== 'ACTIVE') throw conflict(`${product.name} is out of stock.`);

  const availability = await getAvailability(body.productId, body.variantId);

  const cart = await cartOf(session.customerId);
  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, productId: body.productId, variantId: body.variantId ?? null },
  });

  const desired = (existing?.quantity ?? 0) + body.quantity;
  if (desired > availability.available) {
    throw conflict(
      availability.available === 0
        ? `${product.name} is out of stock.`
        : `Only ${availability.available} of ${product.name} available${
            existing ? ` (you already have ${existing.quantity} in your cart)` : ''
          }.`,
    );
  }

  const item = existing
    ? await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: desired } })
    : await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: body.productId,
          variantId: body.variantId ?? null,
          quantity: body.quantity,
        },
      });

  const itemCount = await prisma.cartItem.aggregate({
    where: { cartId: cart.id },
    _sum: { quantity: true },
  });

  return created({
    item: { id: item.id, quantity: item.quantity },
    cartItemCount: itemCount._sum.quantity ?? 0,
  });
});

// DELETE /api/cart — empty the cart.
export const DELETE = handler(async () => {
  const session = await requireCustomer();
  const cart = await cartOf(session.customerId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return ok({ cleared: true });
});
