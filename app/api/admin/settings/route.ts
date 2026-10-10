// GET / PATCH /api/admin/settings — §12, §21. Commission and shipping policy.
import { handler, ok, parseBody } from '../../../../lib/server/http';
import { requireAdmin } from '../../../../lib/server/auth';
import { settingsUpdateSchema } from '../../../../lib/server/schemas';
import { getAllSettings, setSetting } from '../../../../lib/server/settings';
import { auditNow } from '../../../../lib/server/audit';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  await requireAdmin();
  const settings = await getAllSettings();
  return ok({
    settings,
    descriptions: {
      'commission.defaultRate': 'Platform commission % when no seller or category rate applies.',
      'shipping.flatFeePerSeller': 'Shipping fee in paise, charged per seller in the order.',
      'shipping.freeAboveSubtotal': 'Per-seller goods value in paise above which shipping is free.',
      'returns.windowDays': 'Days after delivery a customer may request a return; payouts are held this long.',
      'checkout.reservationTtlMinutes': 'How long checkout holds stock while the customer pays.',
    },
  });
});

export const PATCH = handler(async (req: Request) => {
  const session = await requireAdmin();
  const body = await parseBody(req, settingsUpdateSchema);

  const changed: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    await setSetting(key, value);
    changed.push(key);
  }

  await auditNow({
    actorId: session.userId,
    actorRole: 'ADMIN',
    action: 'SETTINGS_UPDATED',
    entityType: 'PlatformSetting',
    metadata: body as Record<string, unknown>,
  });

  const settings = await getAllSettings();
  return ok({
    settings,
    message:
      changed.length > 0
        ? `Updated: ${changed.join(', ')}. New orders use these values immediately; existing orders keep the rate they were placed at.`
        : 'No changes.',
  });
});
