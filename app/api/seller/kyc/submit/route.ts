// POST /api/seller/kyc/submit — §4. DRAFT → PENDING_REVIEW.
import { handler, ok } from '../../../../../lib/server/http';
import { requireSeller } from '../../../../../lib/server/auth';
import { submitSellerApplication } from '../../../../../lib/server/sellers';

export const dynamic = 'force-dynamic';

export const POST = handler(async () => {
  const session = await requireSeller();
  const result = await submitSellerApplication({
    sellerId: session.sellerId,
    userId: session.userId,
  });

  return ok({
    status: result.status,
    message:
      'Your application has been submitted. Our team will review your KYC documents and get back to you — you will be able to list products once approved.',
  });
});
