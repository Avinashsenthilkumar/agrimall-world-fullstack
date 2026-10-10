// POST /api/admin/sellers/[id]/decision — §4, §21. Approve / reject / suspend.
//
// Approval is what flips the seller from "can sign in" to "can sell".
import { handler, ok, parseBody } from '../../../../../../lib/server/http';
import { requireAdmin } from '../../../../../../lib/server/auth';
import { sellerDecisionSchema } from '../../../../../../lib/server/schemas';
import { decideSellerApplication } from '../../../../../../lib/server/sellers';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireAdmin();
  const body = await parseBody(req, sellerDecisionSchema);

  const result = await decideSellerApplication({
    sellerId: params.id,
    decision: body.decision,
    reason: body.reason,
    commissionRate: body.commissionRate,
    actor: { userId: session.userId, role: 'ADMIN' },
  });

  const messages: Record<string, string> = {
    APPROVE: `${result.businessName} is approved and can now list products.`,
    REJECT: `${result.businessName}'s application was rejected and they have been notified.`,
    SUSPEND: `${result.businessName} is suspended and their listings are hidden.`,
    BLOCK: `${result.businessName} is blocked.`,
    REINSTATE: `${result.businessName} is reinstated and their approved listings are live again.`,
    UNDER_REVIEW: `${result.businessName} is marked as under review.`,
  };

  return ok({
    sellerId: result.sellerId,
    status: result.status,
    message: messages[body.decision] ?? 'Decision recorded.',
  });
});
