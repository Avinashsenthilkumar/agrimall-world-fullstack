// lib/server/prisma.ts — the Prisma client singleton.
//
// Next.js dev mode re-evaluates modules on every hot reload; without the
// global cache that leaks a connection pool per reload until Postgres refuses
// new clients.

import { PrismaClient, Prisma } from '@prisma/client';
import { isProd } from './env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// NOTE: no `datasources` override here on purpose. Prisma reads DATABASE_URL
// from the environment itself, and only when it first opens a connection — so
// importing this module during `next build` neither validates config nor dials
// the database. Passing env.DATABASE_URL here would read (and therefore
// validate) configuration at import time, which is exactly what breaks a build
// that has no runtime secrets.
export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;

/** Transaction client type — what every `prisma.$transaction(tx => …)` gets. */
export type Tx = Prisma.TransactionClient;

/**
 * Run a function inside a SERIALIZABLE transaction, retrying on the
 * serialization failures Postgres raises under contention.
 *
 * Used for checkout and payment capture (§32): these read stock, decide, then
 * write, and must not interleave with a competing checkout. Postgres raises
 * 40001 instead of letting two transactions both succeed on stale reads — the
 * correct response is to retry, not to lower the isolation level.
 */
export async function serializableTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 5;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: opts.timeoutMs ?? 15_000,
        maxWait: 10_000,
      });
    } catch (err: unknown) {
      lastError = err;
      if (!isRetryableTransactionError(err) || attempt === retries) throw err;
      // Exponential backoff with jitter so retries don't resynchronise.
      const delay = Math.min(200 * 2 ** attempt, 1_500) * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function isRetryableTransactionError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  // P2034 = Prisma's "transaction conflict / deadlock, please retry".
  if (code === 'P2034') return true;
  const message = String((err as { message?: string })?.message ?? '');
  // Raw Postgres SQLSTATEs: 40001 serialization_failure, 40P01 deadlock_detected.
  return (
    message.includes('40001') ||
    message.includes('40P01') ||
    message.includes('could not serialize access') ||
    message.includes('deadlock detected')
  );
}

export { Prisma };
