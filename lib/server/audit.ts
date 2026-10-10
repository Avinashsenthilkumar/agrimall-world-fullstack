// lib/server/audit.ts — who did what, to which record, when.
//
// Every privileged action (seller approval, KYC decision, product moderation,
// payout release, admin status override, refund) writes a row here. This is
// what makes "admin can do anything" acceptable: it is all recorded.

import { prisma, type Tx } from './prisma';
import type { Role } from '@prisma/client';

export interface AuditArgs {
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

/** Inside a transaction. */
export async function audit(tx: Tx, args: AuditArgs): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: args.actorId ?? null,
      actorRole: args.actorRole ?? null,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId ?? null,
      metadata: (args.metadata ?? null) as object,
      ip: args.ip ?? null,
    },
  });
}

/** Outside a transaction — never throws, so logging can't break a request. */
export async function auditNow(args: AuditArgs): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: args.actorId ?? null,
        actorRole: args.actorRole ?? null,
        action: args.action,
        entityType: args.entityType,
        entityId: args.entityId ?? null,
        metadata: (args.metadata ?? null) as object,
        ip: args.ip ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to record', args.action, err);
  }
}

export async function listAuditLogs(opts: {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  take?: number;
  skip?: number;
}) {
  return prisma.auditLog.findMany({
    where: {
      ...(opts.entityType ? { entityType: opts.entityType } : {}),
      ...(opts.entityId ? { entityId: opts.entityId } : {}),
      ...(opts.actorId ? { actorId: opts.actorId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 100,
    skip: opts.skip ?? 0,
    include: { actor: { select: { email: true, name: true, role: true } } },
  });
}

/** Best-effort client IP, honouring the usual proxy headers. */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('x-real-ip') ?? h.get('cf-connecting-ip') ?? null;
}
