// POST /api/logistics/shipments/[id]/event — §17. A courier scan.
//
// This is the real version of v1's simulated tracking: a scan recorded by the
// party holding the parcel, which drives both the shipment status and the
// seller order's lifecycle. Only LOGISTICS and ADMIN can call it.
import { prisma } from '../../../../../../lib/server/prisma';
import { handler, ok, parseBody, notFound, conflict } from '../../../../../../lib/server/http';
import { requireLogistics } from '../../../../../../lib/server/auth';
import { transitionSellerOrder } from '../../../../../../lib/server/orders';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    event: z.enum([
      'PICKED_UP',
      'IN_TRANSIT',
      'ARRIVED_AT_HUB',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'DELIVERY_FAILED',
    ]),
    location: z.string().trim().max(160).optional(),
    message: z.string().trim().max(300).optional(),
  })
  .strict();

// A scan maps to the seller-order status it implies. ARRIVED_AT_HUB is a pure
// tracking event — it adds detail without changing the lifecycle stage.
const EVENT_TO_STATUS = {
  PICKED_UP: 'SHIPPED',
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVED_AT_HUB: null,
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'IN_TRANSIT',
} as const;

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireLogistics();
  const body = await parseBody(req, schema);

  const shipment = await prisma.shipment.findUnique({
    where: { id: params.id },
    select: { id: true, sellerOrderId: true, sellerOrder: { select: { status: true } } },
  });
  if (!shipment) throw notFound('Shipment not found.');

  const target = EVENT_TO_STATUS[body.event];

  // Hub arrival: record the event only.
  if (target === null) {
    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        status: 'ARRIVED_AT_HUB',
        location: body.location ?? null,
        message: body.message ?? null,
      },
    });
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: 'ARRIVED_AT_HUB' },
    });
    return ok({ recorded: 'ARRIVED_AT_HUB', orderStatusChanged: false });
  }

  // A failed attempt records the failure, then returns the parcel to transit.
  if (body.event === 'DELIVERY_FAILED') {
    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        status: 'DELIVERY_FAILED',
        location: body.location ?? null,
        message: body.message ?? 'Delivery attempt unsuccessful.',
      },
    });
    if (shipment.sellerOrder.status === 'OUT_FOR_DELIVERY') {
      await transitionSellerOrder({
        sellerOrderId: shipment.sellerOrderId,
        to: 'IN_TRANSIT',
        actor: { userId: session.userId, role: 'LOGISTICS' },
        note: body.message ?? 'Delivery attempt unsuccessful — reattempting.',
        location: body.location,
      });
    }
    return ok({ recorded: 'DELIVERY_FAILED', orderStatusChanged: true });
  }

  if (shipment.sellerOrder.status === target) {
    throw conflict(`That parcel is already marked ${target.toLowerCase().replace(/_/g, ' ')}.`);
  }

  const result = await transitionSellerOrder({
    sellerOrderId: shipment.sellerOrderId,
    to: target,
    actor: { userId: session.userId, role: 'LOGISTICS' },
    note: body.message,
    location: body.location,
  });

  return ok({
    recorded: body.event,
    ...result,
    message: `Scan recorded. The customer's tracking now shows "${target.toLowerCase().replace(/_/g, ' ')}".`,
  });
});
