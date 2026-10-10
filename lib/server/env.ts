// lib/server/env.ts — §30. Nothing secret is hardcoded anywhere in this app.
//
// Required variables are validated once, at first import, so the process fails
// fast on boot instead of throwing a confusing error during a customer's
// checkout. See .env.example for the full list.

import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (PostgreSQL connection string)'),

  // Session signing. Must be at least 32 chars; generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),

  APP_URL: z.string().url().default('http://localhost:3000'),

  // ---- Payments -----------------------------------------------------------
  // The integration code is complete; only these credentials are pending.
  // With none set, the app runs in COD-only mode and online payment is
  // disabled with an explicit error rather than a fake success (§29, §1399).
  PAYMENT_PROVIDER: z.enum(['RAZORPAY', 'STRIPE', 'NONE']).default('NONE'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // ---- Storage ------------------------------------------------------------
  // LOCAL writes to ./public/uploads (fine for dev / single-server).
  // S3 is the production path.
  STORAGE_DRIVER: z.enum(['LOCAL', 'S3']).default('LOCAL'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),

  // ---- Email / SMS --------------------------------------------------------
  EMAIL_DRIVER: z.enum(['LOG', 'SMTP', 'RESEND']).default('LOG'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('AgriMall World <no-reply@agrimall.example>'),
  RESEND_API_KEY: z.string().optional(),

  // ---- Business rules (admin-overridable via PlatformSetting) -------------
  DEFAULT_COMMISSION_RATE: z.coerce.number().min(0).max(100).default(10),
  SHIPPING_FLAT_FEE_PAISE: z.coerce.number().int().min(0).default(14_900),
  SHIPPING_FREE_ABOVE_PAISE: z.coerce.number().int().min(0).default(200_000),
  /** How long checkout holds stock before the reservation expires. */
  RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  /** Return window after delivery, and therefore payout hold period. */
  RETURN_WINDOW_DAYS: z.coerce.number().int().min(0).default(7),

  /** Protects /api/cron/* endpoints. */
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`,
    );
  }
  return parsed.data;
}

/**
 * Validation is LAZY — it runs on first actual access, not at import time.
 *
 * This matters for `next build`: the build imports every route module to
 * analyse it, so eager validation here would abort the build on any machine
 * that doesn't have runtime secrets present (a Docker build stage, or CI that
 * only injects env at deploy time). The same trap bit v1's SQLite layer, which
 * is why its connection was made lazy.
 *
 * Fail-fast is preserved where it counts: the first request that touches
 * configuration still throws immediately with the full list of problems.
 */
let cached: Env | null = null;

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    cached ??= load();
    return cached[prop as keyof Env];
  },
  has(_target, prop: string) {
    cached ??= load();
    return prop in cached;
  },
  ownKeys() {
    cached ??= load();
    return Reflect.ownKeys(cached);
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    cached ??= load();
    return Reflect.getOwnPropertyDescriptor(cached, prop);
  },
});

/** Read directly from process.env so this does NOT trigger validation. */
export const isProd = process.env.NODE_ENV === 'production';

/** Validate eagerly on purpose — call from a startup check or a health route. */
export function assertEnvValid(): Env {
  cached ??= load();
  return cached;
}

/** True when online payment is actually configured (§1399). */
export function onlinePaymentConfigured(): boolean {
  if (env.PAYMENT_PROVIDER === 'RAZORPAY') {
    return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);
  }
  if (env.PAYMENT_PROVIDER === 'STRIPE') {
    return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
  }
  return false;
}
