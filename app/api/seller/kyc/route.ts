// POST /api/seller/kyc — §4. Save KYC identifiers.
//
// Aadhaar is accepted for verification but only its last 4 digits plus a
// one-way hash are persisted. The full number is never written to the
// database and never returned by any endpoint.
import { handler, ok, parseBody } from '../../../../lib/server/http';
import { requireSeller } from '../../../../lib/server/auth';
import { sellerKycSchema } from '../../../../lib/server/schemas';
import { saveKyc, sellerSelfView } from '../../../../lib/server/sellers';
import { auditNow } from '../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const session = await requireSeller();
  const body = await parseBody(req, sellerKycSchema);

  await saveKyc({
    sellerId: session.sellerId,
    panNumber: body.panNumber,
    gstNumber: body.gstNumber || undefined,
    msmeNumber: body.msmeNumber || undefined,
    aadhaarNumber: body.aadhaarNumber || undefined,
  });

  // Note what is NOT logged: no identifier values.
  await auditNow({
    actorId: session.userId,
    actorRole: 'SELLER',
    action: 'KYC_SAVED',
    entityType: 'SellerKyc',
    entityId: session.sellerId,
    metadata: { hasGst: Boolean(body.gstNumber), hasAadhaar: Boolean(body.aadhaarNumber) },
  });

  const seller = await sellerSelfView(session.sellerId);
  return ok({ kyc: seller.kyc, message: 'KYC details saved.' });
});
