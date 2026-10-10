// lib/server/settings.ts — admin-configurable platform settings (§12, §21).
//
// Settings live in the platform_settings table so an admin can change the
// commission rate or shipping policy without a deploy. Env vars provide the
// boot defaults; the DB row wins when present.

import { prisma } from './prisma';
import { env } from './env';
import type { ShippingPolicy } from '../shared/pricing';

export const SETTING_KEYS = {
  commissionDefaultRate: 'commission.defaultRate',
  shippingFlatFee: 'shipping.flatFeePerSeller',
  shippingFreeAbove: 'shipping.freeAboveSubtotal',
  returnWindowDays: 'returns.windowDays',
  reservationTtlMinutes: 'checkout.reservationTtlMinutes',
  payoutAutoRelease: 'payouts.autoReleaseAfterReturnWindow',
} as const;

/** Short-lived cache so a hot checkout path doesn't re-query settings per call. */
let cache: { at: number; values: Map<string, unknown> } | null = null;
const CACHE_MS = 30_000;

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  const rows = await prisma.platformSetting.findMany();
  const values = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
  cache = { at: Date.now(), values };
  return values;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

async function getNumber(key: string, fallback: number): Promise<number> {
  const values = await loadAll();
  const raw = values.get(key);
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function getDefaultCommissionRate(): Promise<number> {
  return getNumber(SETTING_KEYS.commissionDefaultRate, env.DEFAULT_COMMISSION_RATE);
}

export async function getShippingPolicy(): Promise<ShippingPolicy> {
  const [flatFeePerSeller, freeAboveSubtotal] = await Promise.all([
    getNumber(SETTING_KEYS.shippingFlatFee, env.SHIPPING_FLAT_FEE_PAISE),
    getNumber(SETTING_KEYS.shippingFreeAbove, env.SHIPPING_FREE_ABOVE_PAISE),
  ]);
  return {
    flatFeePerSeller: Math.max(0, Math.round(flatFeePerSeller)),
    freeAboveSubtotal: Math.max(0, Math.round(freeAboveSubtotal)),
  };
}

export async function getReturnWindowDays(): Promise<number> {
  return getNumber(SETTING_KEYS.returnWindowDays, env.RETURN_WINDOW_DAYS);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
  invalidateSettingsCache();
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const values = await loadAll();
  const defaults: Record<string, unknown> = {
    [SETTING_KEYS.commissionDefaultRate]: env.DEFAULT_COMMISSION_RATE,
    [SETTING_KEYS.shippingFlatFee]: env.SHIPPING_FLAT_FEE_PAISE,
    [SETTING_KEYS.shippingFreeAbove]: env.SHIPPING_FREE_ABOVE_PAISE,
    [SETTING_KEYS.returnWindowDays]: env.RETURN_WINDOW_DAYS,
    [SETTING_KEYS.reservationTtlMinutes]: env.RESERVATION_TTL_MINUTES,
    [SETTING_KEYS.payoutAutoRelease]: true,
  };
  for (const [k, v] of values) defaults[k] = v;
  return defaults;
}
