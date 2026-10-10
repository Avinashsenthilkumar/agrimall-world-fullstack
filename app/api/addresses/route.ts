// GET  /api/addresses — the signed-in customer's address book (§6).
// POST /api/addresses — add one.
import { prisma } from '../../../lib/server/prisma';
import { handler, ok, created, parseBody, conflict } from '../../../lib/server/http';
import { requireCustomer } from '../../../lib/server/auth';
import { addressSchema } from '../../../lib/server/schemas';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireCustomer();
  const addresses = await prisma.address.findMany({
    where: { customerId: session.customerId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return ok({ addresses });
});

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = await parseBody(req, addressSchema);

  const count = await prisma.address.count({ where: { customerId: session.customerId } });
  if (count >= 20) throw conflict('You can save up to 20 addresses.');

  const address = await prisma.$transaction(async (tx) => {
    // The first address is always the default; only one can hold the flag.
    const makeDefault = body.isDefault || count === 0;
    if (makeDefault) {
      await tx.address.updateMany({
        where: { customerId: session.customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.address.create({
      data: {
        customerId: session.customerId,
        label: body.label ?? 'Home',
        fullName: body.fullName,
        phone: body.phone,
        line1: body.line1,
        line2: body.line2 ?? null,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
        country: body.country,
        isDefault: makeDefault,
      },
    });
  });

  return created({ address });
});
