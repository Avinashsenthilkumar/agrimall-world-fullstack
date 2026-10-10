// POST /api/uploads — §1. Real file storage for product images and KYC docs.
//
// Validates by SNIFFED file type, stores to disk or S3, returns a URL.
// KYC documents are written outside public/ and served only through an
// authorised route.
import { handler, created, parseBody, badRequest, forbidden } from '../../../lib/server/http';
import { requireUser } from '../../../lib/server/auth';
import { storeUpload, type UploadKind } from '../../../lib/server/storage';
import { attachKycDocument } from '../../../lib/server/sellers';
import { enforceRateLimit, LIMITS } from '../../../lib/server/ratelimit';

export const dynamic = 'force-dynamic';

const KYC_FIELDS = ['panDocUrl', 'gstDocUrl', 'addressDocUrl', 'bankDocUrl'] as const;

export const POST = handler(async (req: Request) => {
  const session = await requireUser();
  enforceRateLimit(`upload:${session.userId}`, LIMITS.upload.limit, LIMITS.upload.windowMs);

  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest('Send the file as multipart/form-data.');

  const file = form.get('file');
  const kind = String(form.get('kind') ?? '') as UploadKind;

  if (!(file instanceof File)) throw badRequest('No file was received.');
  if (!['PRODUCT_IMAGE', 'KYC_DOCUMENT', 'REVIEW_IMAGE', 'RETURN_IMAGE'].includes(kind)) {
    throw badRequest('Unknown upload type.');
  }

  // Only sellers upload product images and KYC documents.
  if ((kind === 'PRODUCT_IMAGE' || kind === 'KYC_DOCUMENT') && !session.sellerId) {
    throw forbidden('Only seller accounts can upload this file type.');
  }

  const ownerId = session.sellerId ?? session.customerId ?? session.userId;
  const stored = await storeUpload({ kind, file, ownerId });

  // A KYC document can be attached to its field in the same request.
  if (kind === 'KYC_DOCUMENT' && session.sellerId) {
    const field = String(form.get('field') ?? '');
    if (KYC_FIELDS.includes(field as (typeof KYC_FIELDS)[number])) {
      await attachKycDocument({
        sellerId: session.sellerId,
        field: field as (typeof KYC_FIELDS)[number],
        url: stored.url,
      });
    }
  }

  return created({
    file: { url: stored.url, key: stored.key, bytes: stored.bytes, mime: stored.mime },
  });
});
