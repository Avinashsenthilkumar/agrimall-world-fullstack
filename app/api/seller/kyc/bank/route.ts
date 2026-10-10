// POST /api/seller/kyc/bank — §4. Bank details for payouts.
// Only the last 4 digits are stored in the clear; the rest is hashed.
import { handler, ok, parseBody } from '../../../../../lib/server/http';
import { requireSeller } from '../../../../../lib/server/auth';
import { sellerBankSchema } from '../../../../../lib/server/schemas';
import { saveBankAccount, sellerSelfView } from '../../../../../lib/server/sellers';
import { auditNow } from '../../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const session = await requireSeller();
  const body = await parseBody(req, sellerBankSchema);

  await saveBankAccount({
    sellerId: session.sellerId,
    accountHolderName: body.accountHolderName,
    accountNumber: body.accountNumber,
    ifsc: body.ifsc,
    bankName: body.bankName,
    branch: body.branch,
  });

  await auditNow({
    actorId: session.userId,
    actorRole: 'SELLER',
    action: 'BANK_DETAILS_SAVED',
    entityType: 'SellerBankAccount',
    entityId: session.sellerId,
    metadata: { ifsc: body.ifsc, last4: body.accountNumber.slice(-4) },
  });

  const seller = await sellerSelfView(session.sellerId);
  return ok({ bankAccount: seller.bankAccount, message: 'Bank details saved.' });
});
