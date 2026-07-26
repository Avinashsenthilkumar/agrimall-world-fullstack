import db from '../../../lib/db.js';
import { ok, fail } from '../../../lib/server.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sellers = db.prepare('SELECT id,email,biz_name,owner_name,biz_state,status,created_at FROM sellers ORDER BY id DESC').all();
  return ok({ sellers });
}

// POST /api/sellers — register a new seller (from the KYC onboarding flow).
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.email || !b.pass) return fail('email and password are required');
  const exists = db.prepare('SELECT 1 FROM sellers WHERE email=?').get(b.email.toLowerCase());
  if (exists) return fail('an account with this email already exists', 409);

  const info = db.prepare(`
    INSERT INTO sellers (email,pass,biz_name,owner_name,biz_phone,biz_state,status)
    VALUES (@email,@pass,@biz_name,@owner_name,@biz_phone,@biz_state,'Active')
  `).run({
    email: b.email.toLowerCase(), pass: b.pass, biz_name: b.bizName || '', owner_name: b.ownerName || '',
    biz_phone: b.bizPhone || '', biz_state: b.bizState || '',
  });
  const seller = db.prepare('SELECT id,email,biz_name,owner_name,biz_state,status FROM sellers WHERE id=?').get(info.lastInsertRowid);
  return ok({ seller }, { status: 201 });
}
