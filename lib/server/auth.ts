// lib/server/auth.ts — §2, §23. Role and ownership enforcement.
//
// THE RULE: no endpoint ever reads a role, a sellerId or a customerId from the
// request. Those come only from the server-side session, and ownership is
// re-checked against the database on every single access.
//
// The guards below are the only sanctioned way to authorise a request. A route
// that doesn't call one of them is unauthenticated by construction, which
// makes auditing easy: grep for `require` in app/api.

import type { Role } from '@prisma/client';
import { prisma } from './prisma';
import { getSessionUser, type SessionUser } from './session';
import { forbidden, notFound, unauthorized } from './http';

export type { SessionUser };

/** Any signed-in, active user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
}

/** A signed-in user holding one of the given roles. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw forbidden(`This area is restricted to ${roles.join(' / ').toLowerCase()} accounts.`);
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  return requireRole('ADMIN');
}

export async function requireLogistics(): Promise<SessionUser> {
  return requireRole('LOGISTICS', 'ADMIN');
}

export interface CustomerSession extends SessionUser {
  customerId: string;
}

export async function requireCustomer(): Promise<CustomerSession> {
  const user = await requireRole('CUSTOMER');
  if (!user.customerId) throw forbidden('This account has no customer profile.');
  return user as CustomerSession;
}

export interface SellerSession extends SessionUser {
  sellerId: string;
}

/** A seller account at ANY status — use for onboarding/KYC endpoints that a
 *  pending seller must still be able to reach. */
export async function requireSeller(): Promise<SellerSession> {
  const user = await requireRole('SELLER');
  if (!user.sellerId) throw forbidden('This account has no seller profile.');
  return user as SellerSession;
}

/**
 * A seller who has been APPROVED by an admin (§4).
 *
 * This is the guard that makes "registration does not make you active" real:
 * a PENDING_REVIEW seller can sign in and finish their KYC, but cannot list
 * products or receive orders until an admin approves them.
 */
export async function requireApprovedSeller(): Promise<SellerSession> {
  const user = await requireSeller();

  // Re-read from the DB rather than trusting the value cached in the session,
  // so a mid-session suspension takes effect immediately.
  const seller = await prisma.seller.findUnique({
    where: { id: user.sellerId },
    select: { status: true, businessName: true },
  });
  if (!seller) throw forbidden('Seller profile not found.');

  switch (seller.status) {
    case 'APPROVED':
      return user;
    case 'DRAFT':
      throw forbidden('Please complete your seller application before continuing.');
    case 'PENDING_REVIEW':
    case 'UNDER_REVIEW':
      throw forbidden(
        'Your seller application is still under review. You can list products once it is approved.',
      );
    case 'REJECTED':
      throw forbidden('Your seller application was not approved. Please contact support.');
    case 'SUSPENDED':
      throw forbidden('Your seller account is suspended. Please contact support.');
    case 'BLOCKED':
      throw forbidden('Your seller account has been blocked.');
    default:
      throw forbidden('Your seller account is not active.');
  }
}

// ---------------------------------------------------------------------------
// Ownership checks — the layer that stops Seller A touching Seller B (§23)
// ---------------------------------------------------------------------------
//
// Each helper takes the acting session and the id of the thing being accessed,
// and either returns the row or throws. They deliberately throw 404 rather
// than 403 for cross-tenant access, so that Seller A cannot use the API to
// discover which product ids belong to Seller B.

export async function ownedProduct(session: SellerSession | SessionUser, productId: string) {
  const isAdmin = session.role === 'ADMIN';
  const product = await prisma.product.findFirst({
    where: { id: productId, ...(isAdmin ? {} : { sellerId: sellerIdOf(session) }) },
  });
  if (!product) throw notFound('Product not found.');
  return product;
}

export async function ownedSellerOrder(session: SellerSession | SessionUser, sellerOrderId: string) {
  const isAdmin = session.role === 'ADMIN' || session.role === 'LOGISTICS';
  const so = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId, ...(isAdmin ? {} : { sellerId: sellerIdOf(session) }) },
  });
  if (!so) throw notFound('Order not found.');
  return so;
}

export async function ownedOrder(session: CustomerSession | SessionUser, orderId: string) {
  const isAdmin = session.role === 'ADMIN';
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(isAdmin ? {} : { customerId: customerIdOf(session) }) },
  });
  if (!order) throw notFound('Order not found.');
  return order;
}

export async function ownedAddress(session: CustomerSession, addressId: string) {
  const address = await prisma.address.findFirst({
    where: { id: addressId, customerId: session.customerId },
  });
  if (!address) throw notFound('Address not found.');
  return address;
}

export async function ownedReturn(session: SessionUser, returnId: string) {
  const where =
    session.role === 'ADMIN'
      ? { id: returnId }
      : session.role === 'SELLER'
        ? { id: returnId, sellerOrder: { sellerId: sellerIdOf(session) } }
        : { id: returnId, customerId: customerIdOf(session) };

  const row = await prisma.returnRequest.findFirst({ where });
  if (!row) throw notFound('Return request not found.');
  return row;
}

function sellerIdOf(session: SessionUser): string {
  if (!session.sellerId) throw forbidden('This account has no seller profile.');
  return session.sellerId;
}

function customerIdOf(session: SessionUser): string {
  if (!session.customerId) throw forbidden('This account has no customer profile.');
  return session.customerId;
}

/**
 * Scope filter helper for list endpoints.
 *
 * `sellerScope(session)` returns `{}` for an admin and
 * `{ sellerId: '<their id>' }` for a seller — so a single query serves both
 * dashboards without any chance of a seller seeing another's rows.
 */
export function sellerScope(session: SessionUser): { sellerId?: string } {
  if (session.role === 'ADMIN' || session.role === 'LOGISTICS') return {};
  return { sellerId: sellerIdOf(session) };
}

export function customerScope(session: SessionUser): { customerId?: string } {
  if (session.role === 'ADMIN') return {};
  return { customerId: customerIdOf(session) };
}
