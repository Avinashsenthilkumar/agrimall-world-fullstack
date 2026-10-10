// POST /api/admin/returns/[id]/decision — admin override + pickup progression.
import { handler, ok, parseBody, badRequest } from '../../../../../../lib/server/http';
import { requireAdmin } from '../../../../../../lib/server/auth';
import { returnDecisionSchema, returnProgressSchema } from '../../../../../../lib/server/schemas';
import { decideReturn, progressReturn } from '../../../../../../lib/server/returns';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// One endpoint, two shapes: a decision, or a progression step.
const bodySchema = z.union([
  z.object({ kind: z.literal('DECISION') }).and(returnDecisionSchema),
  z.object({ kind: z.literal('PROGRESS') }).and(returnProgressSchema),
]);

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireAdmin();
  const body = await parseBody(req, bodySchema);

  if (body.kind === 'DECISION') {
    const result = await decideReturn({
      returnId: params.id,
      decision: body.decision,
      rejectionReason: body.rejectionReason,
      restock: body.restock,
      actor: { userId: session.userId, role: 'ADMIN' },
    });
    return ok({ ...result, message: `Return ${body.decision.toLowerCase()}d.` });
  }

  if (body.kind === 'PROGRESS') {
    const result = await progressReturn({
      returnId: params.id,
      status: body.status,
      pickupScheduledAt: body.pickupScheduledAt,
      inspectionNote: body.inspectionNote,
      approvedRefundPaise:
        body.approvedRefundRupees != null ? Math.round(body.approvedRefundRupees * 100) : undefined,
      actor: { userId: session.userId, role: 'ADMIN' },
    });
    return ok({
      ...result,
      message:
        body.status === 'INSPECTED'
          ? 'Inspection recorded. You can now issue the refund.'
          : `Return marked ${body.status.toLowerCase().replace(/_/g, ' ')}.`,
    });
  }

  throw badRequest('Unknown action.');
});
