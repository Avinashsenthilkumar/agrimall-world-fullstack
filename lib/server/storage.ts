// lib/server/storage.ts — §1 "Do not store uploaded files only in frontend state."
//
// v1's KYC "upload" never left the browser. Here, every file is validated and
// written to real storage before any reference to it is saved.
//
// Two drivers:
//   LOCAL — ./public/uploads, good for dev and single-server deployments.
//   S3    — presigned PUT, the production path.
//
// Security notes:
//   - The extension is derived from the SNIFFED magic bytes, never from the
//     client's filename, so "invoice.pdf.exe" cannot be smuggled through.
//   - Filenames are random; a client cannot overwrite another's file or guess
//     a KYC document path.
//   - KYC documents go under a private prefix and are served only through an
//     authorised route (app/api/seller/kyc/documents/[id]), never as static
//     public files.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';
import { badRequest, serviceUnavailable } from './http';

export type UploadKind = 'PRODUCT_IMAGE' | 'KYC_DOCUMENT' | 'REVIEW_IMAGE' | 'RETURN_IMAGE';

interface KindPolicy {
  prefix: string;
  maxBytes: number;
  allowed: Array<{ mime: string; ext: string }>;
  /** Private files are never written under public/. */
  isPrivate: boolean;
}

const POLICIES: Record<UploadKind, KindPolicy> = {
  PRODUCT_IMAGE: {
    prefix: 'products',
    maxBytes: 5 * 1024 * 1024,
    allowed: [
      { mime: 'image/jpeg', ext: 'jpg' },
      { mime: 'image/png', ext: 'png' },
      { mime: 'image/webp', ext: 'webp' },
    ],
    isPrivate: false,
  },
  REVIEW_IMAGE: {
    prefix: 'reviews',
    maxBytes: 4 * 1024 * 1024,
    allowed: [
      { mime: 'image/jpeg', ext: 'jpg' },
      { mime: 'image/png', ext: 'png' },
      { mime: 'image/webp', ext: 'webp' },
    ],
    isPrivate: false,
  },
  RETURN_IMAGE: {
    prefix: 'returns',
    maxBytes: 4 * 1024 * 1024,
    allowed: [
      { mime: 'image/jpeg', ext: 'jpg' },
      { mime: 'image/png', ext: 'png' },
      { mime: 'image/webp', ext: 'webp' },
    ],
    isPrivate: false,
  },
  KYC_DOCUMENT: {
    prefix: 'kyc',
    maxBytes: 8 * 1024 * 1024,
    allowed: [
      { mime: 'image/jpeg', ext: 'jpg' },
      { mime: 'image/png', ext: 'png' },
      { mime: 'application/pdf', ext: 'pdf' },
    ],
    isPrivate: true,
  },
};

/**
 * Identify a file from its leading bytes. The browser-supplied MIME type is
 * advisory only; this is what we actually trust.
 */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: "RIFF" .... "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  // PDF: "%PDF-"
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export interface StoredFile {
  /** Reference saved in the database. */
  key: string;
  /** URL to serve it from (public URL, or an authorised route for private). */
  url: string;
  bytes: number;
  mime: string;
  sha256: string;
}

export async function storeUpload(args: {
  kind: UploadKind;
  file: File;
  /** Namespacing, e.g. the seller id — keeps one tenant's files together. */
  ownerId: string;
}): Promise<StoredFile> {
  const policy = POLICIES[args.kind];
  if (!policy) throw badRequest('Unknown upload type.');

  if (args.file.size === 0) throw badRequest('That file is empty.');
  if (args.file.size > policy.maxBytes) {
    throw badRequest(`Files must be ${Math.floor(policy.maxBytes / (1024 * 1024))}MB or smaller.`);
  }

  const buf = Buffer.from(await args.file.arrayBuffer());

  // Trust the bytes, not the name.
  const mime = sniffMime(buf);
  const match = policy.allowed.find((a) => a.mime === mime);
  if (!match) {
    const allowedList = policy.allowed.map((a) => a.ext.toUpperCase()).join(', ');
    throw badRequest(`That file type is not accepted. Please upload: ${allowedList}.`);
  }

  const sha256 = createHash('sha256').update(buf).digest('hex');
  const safeOwner = args.ownerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'unknown';
  const name = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}.${match.ext}`;
  const key = `${policy.prefix}/${safeOwner}/${name}`;

  if (env.STORAGE_DRIVER === 'S3') {
    await putToS3(key, buf, match.mime, policy.isPrivate);
    return {
      key,
      url: policy.isPrivate ? `/api/files/${encodeURIComponent(key)}` : publicS3Url(key),
      bytes: buf.length,
      mime: match.mime,
      sha256,
    };
  }

  // LOCAL: private files go OUTSIDE public/ so the web server can't serve them.
  const baseDir = policy.isPrivate
    ? path.join(process.cwd(), 'storage', 'private')
    : path.join(process.cwd(), 'public', 'uploads');

  const dest = path.join(baseDir, key);

  // Defence in depth against a traversal in the computed key.
  const resolvedBase = path.resolve(baseDir);
  const resolvedDest = path.resolve(dest);
  if (!resolvedDest.startsWith(resolvedBase + path.sep)) {
    throw badRequest('Invalid upload path.');
  }

  await mkdir(path.dirname(resolvedDest), { recursive: true });
  await writeFile(resolvedDest, buf);

  return {
    key,
    url: policy.isPrivate ? `/api/files/${encodeURIComponent(key)}` : `/uploads/${key}`,
    bytes: buf.length,
    mime: match.mime,
    sha256,
  };
}

function publicS3Url(key: string): string {
  if (env.S3_PUBLIC_BASE_URL) return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`;
}

/**
 * S3 PUT with SigV4.
 *
 * Implemented with the standard library so the project doesn't need the AWS
 * SDK. Set the S3_* environment variables to enable it.
 */
async function putToS3(key: string, body: Buffer, contentType: string, isPrivate: boolean): Promise<void> {
  const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_BUCKET || !S3_REGION || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw serviceUnavailable(
      'S3 storage is selected but not configured. Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.',
    );
  }

  const host = `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
  const url = `https://${host}/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(body).digest('hex');

  const acl = isPrivate ? 'private' : 'public-read';
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-acl:${acl}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-acl;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    `/${key}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const { createHmac } = await import('node:crypto');
  const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${S3_SECRET_ACCESS_KEY}`, dateStamp), S3_REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-acl': acl,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[s3] upload failed', res.status, text);
    throw serviceUnavailable('The file could not be stored. Please try again.');
  }
}
