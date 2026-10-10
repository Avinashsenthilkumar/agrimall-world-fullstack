// GET /api/files/[...key] — authorised access to PRIVATE uploads (KYC docs).
//
// KYC documents are stored outside public/, so they are unreachable as static
// files. This route is the only way to read one, and it checks that the caller
// is either the owning seller or an admin. Every admin read is audited.
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { handler, notFound, forbidden } from '../../../../lib/server/http';
import { requireUser } from '../../../../lib/server/auth';
import { auditNow, clientIp } from '../../../../lib/server/audit';
import { env } from '../../../../lib/server/env';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: Request, { params }: { params: { key: string[] } }) => {
  const session = await requireUser();
  const key = params.key.map(decodeURIComponent).join('/');

  // Path traversal defence: reject anything with a traversal segment before
  // it is ever joined to a filesystem path.
  if (key.includes('..') || key.startsWith('/') || key.includes('\0')) {
    throw notFound('File not found.');
  }

  // Authorisation. `kyc/<sellerId>/<file>` — only that seller, or an admin.
  const [prefix, ownerId] = key.split('/');
  if (prefix === 'kyc') {
    const isOwner = session.sellerId && session.sellerId === ownerId;
    const isAdmin = session.role === 'ADMIN';
    if (!isOwner && !isAdmin) throw forbidden('You do not have access to this document.');

    if (isAdmin && !isOwner) {
      await auditNow({
        actorId: session.userId,
        actorRole: 'ADMIN',
        action: 'KYC_DOCUMENT_VIEWED',
        entityType: 'SellerKyc',
        entityId: ownerId,
        metadata: { key },
        ip: clientIp(req),
      });
    }
  } else {
    throw notFound('File not found.');
  }

  if (env.STORAGE_DRIVER === 'S3') {
    // In production the signed-URL redirect belongs here; the local driver
    // below is what dev and single-server deployments use.
    throw notFound('Private file serving for S3 requires a presigned URL. Set STORAGE_DRIVER=LOCAL or add the redirect.');
  }

  const baseDir = path.resolve(process.cwd(), 'storage', 'private');
  const filePath = path.resolve(baseDir, key);
  if (!filePath.startsWith(baseDir + path.sep)) throw notFound('File not found.');
  if (!existsSync(filePath)) throw notFound('File not found.');

  const stat = statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';

  const stream = createReadStream(filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      // Never cached by a shared proxy.
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
