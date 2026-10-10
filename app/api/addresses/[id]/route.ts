// PATCH / DELETE /api/addresses/[id] — owner-scoped.
import { prisma } from '../../../../lib/server/prisma';
import { handler, ok, parseBody, conflict } from '../../../../lib/server/http';
import { requireCustomer, ownedAddress } from '../../../../lib/server/auth';
import { addressSchema } from '../../../../lib/server/schemas';

export const dynamic = 'force-dynamic';

export const PATCH = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireCustomer();
  await ownedAddress(session, params.id);
  const body = await parseBody(req, addressSchema.partial());

  const address = await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.address.updateMany({
        where: { customerId: session.customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.address.update({ where: { id: params.id }, data: body });
  });

  return ok({ address });
});

export const DELETE = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const session = await requireCustomer();
  const address = await ownedAddress(session, params.id);

  // Orders snapshot their address, so deleting one never affects order history.
  await prisma.address.delete({ where: { id: address.id } });

  // Promote another address to default if we removed the default one.
  if (address.isDefault) {
    const next = await prisma.address.findFirst({
      where: { customerId: session.customerId },
      orderBy: { createdAt: 'desc' },
    });
    if (next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
  }

  return ok({ removed: true });
});
