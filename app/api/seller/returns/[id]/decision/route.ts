// POST /api/seller/returns/[id]/decision — approve or reject a return (§18).
import { handler, ok, parseBody } from '../../../../../../lib/server/http';
import { requireApprovedSeller, ownedReturn } from '../../../../../../lib/server/auth';
import { returnDecisionSchema } from '../../../../../../lib/server/schemas';
import { decideReturn } from '../../../../../../lib/server/returns';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireApprovedSeller();
  await ownedReturn(session, params.id);
  const body = await parseBody(req, returnDecisionSchema);

  const result = await decideReturn({
    returnId: params.id,
    decision: body.decision,
    rejectionReason: body.rejectionReason,
    restock: body.restock,
    actor: { userId: session.userId, role: 'SELLER' },
  });

  return ok({
    ...result,
    message:
      body.decision === 'APPROVE'
        ? 'Return approved. Arrange the pickup and mark it received when the plant arrives back.'
        : 'Return rejected and the customer has been notified.',
  });
});
