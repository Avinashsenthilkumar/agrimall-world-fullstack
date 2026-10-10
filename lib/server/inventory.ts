// lib/server/inventory.ts — §11, §32. Inventory that cannot oversell.
//
// THE MODEL
//   onHand    — physical units at the nursery
//   reserved  — units promised to carts currently paying
//   available = onHand - reserved   ← what a new shopper may buy
//
// THE LIFECYCLE
//   checkout starts  → reserve()   : reserved += qty           (HELD)
//   payment captured → commit()    : onHand -= qty, reserved -= qty (COMMITTED)
//   payment fails    → release()   : reserved -= qty           (RELEASED)
//   reservation TTL  → releaseExpired()
//   order cancelled  → restock()   : onHand += qty
//   return received  → restock()
//
// WHY THIS CANNOT OVERSELL (three independent layers)
//   1. The UPDATE is conditional: `WHERE onHand - reserved >= qty`. If a
//      competing transaction already took the stock, zero rows match and we
//      raise OutOfStockError. We never read-then-write on a stale value.
//   2. Checkout runs at SERIALIZABLE isolation with retry, so two concurrent
//      checkouts for the last unit cannot both observe available = 1.
//   3. A CHECK constraint (`onHand - reserved >= 0`) is the final backstop.
//      Even a hand-written SQL mistake cannot persist negative stock.

import { prisma, type Tx } from './prisma';
import { env } from './env';
import { ApiError, conflict } from './http';
import type { InventoryReason } from '@prisma/client';

export class OutOfStockError extends ApiError {
  productId: string;
  requested: number;
  available: number;

  constructor(args: { productId: string; productName?: string; requested: number; available: number }) {
    super(
      409,
      'OUT_OF_STOCK',
      args.available <= 0
        ? `${args.productName ?? 'That item'} just went out of stock.`
        : `Only ${args.available} of ${args.productName ?? 'that item'} ${
            args.available === 1 ? 'is' : 'are'
          } left — please reduce the quantity.`,
    );
    this.productId = args.productId;
    this.requested = args.requested;
    this.available = args.available;
  }
}

export interface StockLine {
  productId: string;
  variantId?: string | null;
  quantity: number;
  /** For error messages only. */
  productName?: string;
}

interface MovementMeta {
  reason: InventoryReason;
  refType?: 'ORDER' | 'SELLER_ORDER' | 'RETURN' | 'MANUAL';
  refId?: string;
  actorId?: string;
  note?: string;
}

/** Locate the inventory row for a product or one of its variants. */
function inventoryWhere(line: StockLine) {
  return line.variantId ? { variantId: line.variantId } : { productId: line.productId };
}

async function loadInventory(tx: Tx, line: StockLine) {
  const inv = await tx.inventory.findFirst({ where: inventoryWhere(line) });
  if (!inv) {
    throw conflict(`${line.productName ?? 'That item'} is not stocked right now.`);
  }
  return inv;
}

async function logMovement(
  tx: Tx,
  line: StockLine,
  sellerId: string,
  after: { onHand: number; reserved: number },
  delta: { onHand: number; reserved: number },
  meta: MovementMeta,
) {
  await tx.inventoryMovement.create({
    data: {
      productId: line.productId,
      variantId: line.variantId ?? null,
      sellerId,
      reason: meta.reason,
      delta: delta.onHand,
      reservedDelta: delta.reserved,
      onHandAfter: after.onHand,
      reservedAfter: after.reserved,
      refType: meta.refType ?? null,
      refId: meta.refId ?? null,
      actorId: meta.actorId ?? null,
      note: meta.note ?? null,
    },
  });
}

/**
 * Hold stock for an order that is about to be paid for.
 *
 * MUST be called inside a transaction (checkout's serializable one).
 * Throws OutOfStockError if any line cannot be satisfied — and because it runs
 * in a transaction, a partial reservation is rolled back in full.
 */
export async function reserveStock(
  tx: Tx,
  orderId: string,
  lines: StockLine[],
  sellerByProduct: Map<string, string>,
): Promise<void> {
  const expiresAt = new Date(Date.now() + env.RESERVATION_TTL_MINUTES * 60_000);

  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw conflict(`Invalid quantity for ${line.productName ?? line.productId}.`);
    }

    const inv = await loadInventory(tx, line);

    // The conditional update. `updateMany` returns a count, so zero rows
    // changed tells us the stock was taken between our read and our write.
    const result = await tx.inventory.updateMany({
      where: {
        id: inv.id,
        // available >= quantity, expressed without a raw query:
        onHand: { gte: inv.reserved + line.quantity },
        reserved: inv.reserved,
      },
      data: { reserved: { increment: line.quantity } },
    });

    if (result.count !== 1) {
      // Re-read to give the shopper an accurate "only N left".
      const fresh = await tx.inventory.findFirst({ where: inventoryWhere(line) });
      const available = fresh ? Math.max(0, fresh.onHand - fresh.reserved) : 0;
      throw new OutOfStockError({
        productId: line.productId,
        productName: line.productName,
        requested: line.quantity,
        available,
      });
    }

    await tx.stockReservation.create({
      data: {
        orderId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
        status: 'HELD',
        expiresAt,
      },
    });

    const sellerId = sellerByProduct.get(line.productId);
    if (sellerId) {
      await logMovement(
        tx,
        line,
        sellerId,
        { onHand: inv.onHand, reserved: inv.reserved + line.quantity },
        { onHand: 0, reserved: line.quantity },
        { reason: 'RESERVE', refType: 'ORDER', refId: orderId },
      );
    }
  }
}

/**
 * Payment captured: turn holds into real stock depletion.
 * Idempotent — only reservations still HELD are acted on, so a replayed
 * webhook cannot deplete stock twice (§32).
 */
export async function commitReservations(tx: Tx, orderId: string): Promise<number> {
  const held = await tx.stockReservation.findMany({
    where: { orderId, status: 'HELD' },
  });
  if (held.length === 0) return 0;

  for (const r of held) {
    const line: StockLine = {
      productId: r.productId,
      variantId: r.variantId,
      quantity: r.quantity,
    };
    const inv = await loadInventory(tx, line);

    const result = await tx.inventory.updateMany({
      where: { id: inv.id, reserved: { gte: r.quantity }, onHand: { gte: r.quantity } },
      data: {
        reserved: { decrement: r.quantity },
        onHand: { decrement: r.quantity },
      },
    });
    if (result.count !== 1) {
      throw conflict('Inventory state changed while confirming your order.');
    }

    const claimed = await tx.stockReservation.updateMany({
      where: { id: r.id, status: 'HELD' },
      data: { status: 'COMMITTED' },
    });
    if (claimed.count !== 1) continue; // someone else committed it; skip

    const product = await tx.product.findUnique({
      where: { id: r.productId },
      select: { sellerId: true },
    });
    if (product) {
      await logMovement(
        tx,
        line,
        product.sellerId,
        { onHand: inv.onHand - r.quantity, reserved: inv.reserved - r.quantity },
        { onHand: -r.quantity, reserved: -r.quantity },
        { reason: 'COMMIT_SALE', refType: 'ORDER', refId: orderId },
      );
      await tx.product.update({
        where: { id: r.productId },
        data: { soldCount: { increment: r.quantity } },
      });
    }
  }

  await refreshStockStatuses(
    tx,
    held.map((r) => r.productId),
  );
  return held.length;
}

/** Payment failed or abandoned: give the stock back to the shop. */
export async function releaseReservations(tx: Tx, orderId: string): Promise<number> {
  const held = await tx.stockReservation.findMany({ where: { orderId, status: 'HELD' } });

  for (const r of held) {
    const line: StockLine = { productId: r.productId, variantId: r.variantId, quantity: r.quantity };
    const inv = await tx.inventory.findFirst({ where: inventoryWhere(line) });
    if (!inv) continue;

    const claimed = await tx.stockReservation.updateMany({
      where: { id: r.id, status: 'HELD' },
      data: { status: 'RELEASED' },
    });
    if (claimed.count !== 1) continue;

    await tx.inventory.update({
      where: { id: inv.id },
      // max(0, …) guard: never drive `reserved` negative even if state drifted.
      data: { reserved: Math.max(0, inv.reserved - r.quantity) },
    });

    const product = await tx.product.findUnique({
      where: { id: r.productId },
      select: { sellerId: true },
    });
    if (product) {
      await logMovement(
        tx,
        line,
        product.sellerId,
        { onHand: inv.onHand, reserved: Math.max(0, inv.reserved - r.quantity) },
        { onHand: 0, reserved: -r.quantity },
        { reason: 'RELEASE_RESERVATION', refType: 'ORDER', refId: orderId },
      );
    }
  }
  return held.length;
}

/**
 * Sweep reservations whose TTL has passed, releasing their stock and marking
 * the orders failed. Called by /api/cron/release-reservations and
 * opportunistically at the start of checkout.
 */
export async function releaseExpiredReservations(limit = 200): Promise<number> {
  const expired = await prisma.stockReservation.findMany({
    where: { status: 'HELD', expiresAt: { lt: new Date() } },
    select: { orderId: true },
    distinct: ['orderId'],
    take: limit,
  });

  let released = 0;
  for (const { orderId } of expired) {
    try {
      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: { paymentStatus: true },
        });
        // Never release stock for an order that has in fact been paid.
        if (!order || order.paymentStatus === 'CAPTURED') return;

        released += await releaseReservations(tx, orderId);
        await tx.order.update({
          where: { id: orderId },
          data: {
            orderStatus: 'PAYMENT_FAILED',
            paymentStatus: 'FAILED',
            cancelReason: 'Payment not completed before the reservation expired.',
          },
        });
        await tx.sellerOrder.updateMany({
          where: { orderId, status: 'PENDING' },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Payment not completed.' },
        });
      });
    } catch (err) {
      console.error('[inventory] failed to release reservations for', orderId, err);
    }
  }
  return released;
}

/** Put units back on the shelf (cancellation or an accepted return). */
export async function restock(
  tx: Tx,
  lines: StockLine[],
  meta: MovementMeta,
): Promise<void> {
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const inv = await tx.inventory.findFirst({ where: inventoryWhere(line) });
    if (!inv) continue;

    await tx.inventory.update({
      where: { id: inv.id },
      data: { onHand: { increment: line.quantity } },
    });

    const product = await tx.product.findUnique({
      where: { id: line.productId },
      select: { sellerId: true },
    });
    if (product) {
      await logMovement(
        tx,
        line,
        product.sellerId,
        { onHand: inv.onHand + line.quantity, reserved: inv.reserved },
        { onHand: line.quantity, reserved: 0 },
        meta,
      );
    }
  }
  await refreshStockStatuses(
    tx,
    lines.map((l) => l.productId),
  );
}

/** A seller editing stock from the dashboard. Absolute set, not a delta. */
export async function setStock(
  tx: Tx,
  args: { productId: string; variantId?: string | null; onHand: number; actorId: string; note?: string },
): Promise<{ onHand: number; reserved: number; available: number }> {
  if (!Number.isInteger(args.onHand) || args.onHand < 0) {
    throw conflict('Stock must be a whole number of units, zero or more.');
  }

  const line: StockLine = { productId: args.productId, variantId: args.variantId, quantity: 0 };
  const inv = await loadInventory(tx, line);

  // Refuse to set stock below what is already promised to paying customers.
  if (args.onHand < inv.reserved) {
    throw conflict(
      `${inv.reserved} unit(s) are reserved by customers currently checking out — stock cannot go below that.`,
    );
  }

  const updated = await tx.inventory.update({
    where: { id: inv.id },
    data: { onHand: args.onHand },
  });

  const product = await tx.product.findUnique({
    where: { id: args.productId },
    select: { sellerId: true },
  });
  if (product) {
    await logMovement(
      tx,
      line,
      product.sellerId,
      { onHand: updated.onHand, reserved: updated.reserved },
      { onHand: args.onHand - inv.onHand, reserved: 0 },
      { reason: 'MANUAL_ADJUST', refType: 'MANUAL', actorId: args.actorId, note: args.note },
    );
  }

  await refreshStockStatuses(tx, [args.productId]);
  return {
    onHand: updated.onHand,
    reserved: updated.reserved,
    available: updated.onHand - updated.reserved,
  };
}

/**
 * Flip products between ACTIVE and OUT_OF_STOCK to match their availability.
 * Only touches products that are already approved — it must never resurrect a
 * DRAFT or REJECTED listing.
 */
export async function refreshStockStatuses(tx: Tx, productIds: string[]): Promise<void> {
  const unique = [...new Set(productIds)];
  for (const productId of unique) {
    const inv = await tx.inventory.findFirst({ where: { productId } });
    if (!inv) continue;
    const available = inv.onHand - inv.reserved;

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { status: true, approvalStatus: true },
    });
    if (!product || product.approvalStatus !== 'APPROVED') continue;

    if (available <= 0 && product.status === 'ACTIVE') {
      await tx.product.update({ where: { id: productId }, data: { status: 'OUT_OF_STOCK' } });
    } else if (available > 0 && product.status === 'OUT_OF_STOCK') {
      await tx.product.update({ where: { id: productId }, data: { status: 'ACTIVE' } });
    }
  }
}

/** Read-only availability, for product pages and cart validation. */
export async function getAvailability(
  productId: string,
  variantId?: string | null,
): Promise<{ onHand: number; reserved: number; available: number; lowStock: boolean }> {
  const inv = await prisma.inventory.findFirst({
    where: variantId ? { variantId } : { productId },
  });
  if (!inv) return { onHand: 0, reserved: 0, available: 0, lowStock: true };
  const available = Math.max(0, inv.onHand - inv.reserved);
  return {
    onHand: inv.onHand,
    reserved: inv.reserved,
    available,
    lowStock: available <= inv.lowStockThreshold,
  };
}
