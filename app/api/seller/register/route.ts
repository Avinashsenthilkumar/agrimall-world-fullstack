// POST /api/seller/register — §4. Registration does NOT activate the seller.
//
// Creates a SELLER user whose seller record is DRAFT. They can sign in and
// complete KYC, but `requireApprovedSeller()` blocks listing and fulfilment
// until an admin approves them.
import { handler, created, parseBody, unprocessable } from '../../../../lib/server/http';
import { sellerRegisterSchema } from '../../../../lib/server/schemas';
import { registerSeller } from '../../../../lib/server/sellers';
import { checkPasswordPolicy } from '../../../../lib/server/password';
import { createSession } from '../../../../lib/server/session';
import { enforceRateLimit, LIMITS } from '../../../../lib/server/ratelimit';
import { clientIp } from '../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const ip = clientIp(req) ?? 'unknown';
  enforceRateLimit(`sellerreg:${ip}`, LIMITS.register.limit, LIMITS.register.windowMs);

  const body = await parseBody(req, sellerRegisterSchema);

  const policy = checkPasswordPolicy(body.password);
  if (!policy.valid) throw unprocessable('Please choose a stronger password.', { password: policy.problems });

  const result = await registerSeller({
    ownerName: body.ownerName,
    email: body.email,
    password: body.password,
    businessName: body.businessName,
    legalName: body.legalName,
    businessPhone: body.businessPhone,
    businessEmail: body.businessEmail,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    pincode: body.pincode,
    description: body.description,
  });

  // Sign them in so they can continue straight into KYC.
  await createSession(result.userId, { userAgent: req.headers.get('user-agent'), ip });

  return created({
    sellerId: result.sellerId,
    slug: result.slug,
    status: result.status,
    nextStep: 'KYC',
    message:
      'Your seller account has been created. Complete your KYC and bank details, then submit for review.',
  });
});
