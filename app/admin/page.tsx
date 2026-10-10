// app/admin/page.tsx — §21, §27. The platform console.
//
// v1's admin page had no login at all and advanced orders directly. This one
// requires an ADMIN session and does the work the spec asks of an admin:
// approve sellers after reading their KYC, moderate listings, watch GMV and
// commission, release payouts only with a provider reference, and issue
// refunds that correctly reverse commission.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LeafParticles from '../../components/LeafParticles';
import StatusPill from '../../components/StatusPill';
import { toastError, toastSuccess } from '../../components/Toast';
import api from '../../lib/client/api';
import { useApp, errorMessage } from '../../lib/client/AppContext';
import { money, dateShort, dateTime, humanise } from '../../lib/client/format';

type Tab = 'overview' | 'sellers' | 'products' | 'orders' | 'payouts' | 'returns' | 'coupons' | 'settings';

export default function AdminPage() {
  const router = useRouter();
  const { user, authLoading, logout } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const [mobMenuOpen, setMobMenuOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login?next=/admin');
      return;
    }
    if (user.role !== 'ADMIN') {
      router.replace(user.role === 'SELLER' ? '/seller/dashboard' : '/customer');
    }
  }, [authLoading, user, router]);

  if (authLoading || !user || user.role !== 'ADMIN') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh',
        flexDirection: 'column', gap: 14, color: 'var(--text-muted)' }}>
        <div className="spinner" />Checking your access…
      </div>
    );
  }

  const nav: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'sellers', label: '🏪 Sellers & KYC' },
    { id: 'products', label: '🌿 Moderation' },
    { id: 'orders', label: '🛒 Orders' },
    { id: 'payouts', label: '💸 Payouts' },
    { id: 'returns', label: '↩️ Returns & refunds' },
    { id: 'coupons', label: '🎟️ Coupons' },
    { id: 'settings', label: '⚙️ Settings' },
  ];

  return (
    <>
      <LeafParticles />
      <div className="dash-shell">
        <div className="dsb">
          <div className="dsb-logo"><div className="icon">🛠️</div><div className="name">Agri Mall</div></div>
          <div className="dsb-sub">Platform admin</div>
          <div className="dnav">
            {nav.map((n) => (
              <div key={n.id} className={`si ${tab === n.id ? 'on' : ''}`}
                onClick={() => { setTab(n.id); setMobMenuOpen(false); }}>{n.label}</div>
            ))}
          </div>
          <div className="dexit" onClick={async () => { await logout(); router.push('/'); }}>⏎ Sign out</div>
        </div>

        <div className="dmain">
          <div className="dash-topbar">
            <div>
              <h2>Platform console</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Signed in as {user.email}
              </p>
            </div>
            <div className="dash-topbar-right">
              <button className="hamburger-btn" onClick={() => setMobMenuOpen(true)} aria-label="Menu">
                <span /><span /><span />
              </button>
              <span className="rbadge">Admin</span>
            </div>
          </div>

          {mobMenuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 199 }}
                onClick={() => setMobMenuOpen(false)} />
              <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(270px,85vw)',
                background: 'var(--forest)', zIndex: 200, padding: '22px 16px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <span style={{ color: '#fff', fontWeight: 700 }}>🛠️ Admin</span>
                  <button onClick={() => setMobMenuOpen(false)}
                    style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff',
                      width: 30, height: 30, borderRadius: '50%', cursor: 'pointer' }}>✕</button>
                </div>
                {nav.map((n) => (
                  <div key={n.id} className={`si ${tab === n.id ? 'on' : ''}`}
                    onClick={() => { setTab(n.id); setMobMenuOpen(false); }}>{n.label}</div>
                ))}
              </div>
            </>
          )}

          <div className="dash-body">
            {tab === 'overview' && <Overview onGo={setTab} />}
            {tab === 'sellers' && <SellersTab />}
            {tab === 'products' && <ModerationTab />}
            {tab === 'orders' && <OrdersTab />}
            {tab === 'payouts' && <PayoutsTab />}
            {tab === 'returns' && <ReturnsTab />}
            {tab === 'coupons' && <CouponsTab />}
            {tab === 'settings' && <SettingsTab />}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({ onGo }: { onGo: (t: Tab) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin.dashboard>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api.admin
      .dashboard()
      .then(setData)
      .catch((err) => toastError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 46, color: 'var(--text-muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading the platform overview…
      </div>
    );
  }
  if (!data) return null;

  const f = data.finance as Record<string, number>;
  const c = data.counts;
  const maxGmv = Math.max(...data.trend.map((t) => t.gmv), 1);

  return (
    <>
      {/* Work waiting for an admin */}
      {(c.pendingSellers > 0 || c.pendingProducts > 0 || c.payoutsDue > 0 || c.openReturns > 0) && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          {c.pendingSellers > 0 && (
            <ActionCard count={c.pendingSellers} label="seller application" icon="🏪" onClick={() => onGo('sellers')} />
          )}
          {c.pendingProducts > 0 && (
            <ActionCard count={c.pendingProducts} label="listing to review" icon="🌿" onClick={() => onGo('products')} />
          )}
          {c.payoutsDue > 0 && (
            <ActionCard count={c.payoutsDue} label="payout due" icon="💸" onClick={() => onGo('payouts')} />
          )}
          {c.openReturns > 0 && (
            <ActionCard count={c.openReturns} label="open return" icon="↩️" onClick={() => onGo('returns')} />
          )}
        </div>
      )}

      <div className="kpi-row" style={{ marginBottom: 20 }}>
        <div className="kpi">
          <div className="kpi-icon green">📈</div>
          <div>
            <div className="kl">GMV (paid)</div>
            <div className="kv">{money(f.gmv)}</div>
            <div className="kd">{f.paidOrderCount} paid orders</div>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-icon blue">💰</div>
          <div>
            <div className="kl">Platform revenue</div>
            <div className="kv">{money(f.platformRevenue)}</div>
            <div className="kd">commission, net of reversals</div>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-icon orange">🏪</div>
          <div>
            <div className="kl">Approved sellers</div>
            <div className="kv">{c.approvedSellers}</div>
            <div className="kd">{c.pendingSellers} awaiting review</div>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-icon green">🌿</div>
          <div>
            <div className="kl">Live listings</div>
            <div className="kv">{c.activeProducts}</div>
            <div className="kd">{c.pendingProducts} pending approval</div>
          </div>
        </div>
      </div>

      {/* 30-day trend */}
      {data.trend.length > 0 && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="ph"><h3>Last 30 days</h3></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140, marginBottom: 10 }}>
            {data.trend.map((t) => (
              <div key={t.day} style={{ flex: 1, display: 'flex', flexDirection: 'column',
                justifyContent: 'flex-end', height: '100%' }} title={`${t.day}: ${money(t.gmv)} · ${t.orders} orders`}>
                <div style={{ background: 'var(--forest-mid)', borderRadius: '3px 3px 0 0',
                  height: `${Math.max(2, (t.gmv / maxGmv) * 100)}%`, transition: 'height .3s' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
            <span>{data.trend[0]?.day}</span>
            <span>{data.trend[data.trend.length - 1]?.day}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
        {/* Top sellers */}
        <div className="panel">
          <div className="ph"><h3>Top sellers</h3></div>
          {data.topSellers.length === 0 ? (
            <div className="empty-cart">No sales yet.</div>
          ) : (
            <table>
              <thead><tr><th>Seller</th><th>Orders</th><th>Revenue</th></tr></thead>
              <tbody>
                {data.topSellers.map((s) => (
                  <tr key={s.sellerId}>
                    <td>{s.name}</td>
                    <td>{s.orders}</td>
                    <td><strong>{money(s.revenue)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Money summary */}
        <div className="panel">
          <div className="ph"><h3>Finance</h3></div>
          <table>
            <tbody>
              <tr><td>Commission earned</td><td><strong>{money(f.commissionEarned)}</strong></td></tr>
              <tr><td>Commission reversed</td><td style={{ color: 'var(--red)' }}>−{money(f.commissionReversed)}</td></tr>
              <tr><td>Refunds paid out</td><td style={{ color: 'var(--red)' }}>{money(f.refundsPaid)}</td></tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Net platform revenue</td>
                <td style={{ color: 'var(--green)' }}>{money(f.platformRevenue)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 12.5 }}>
            {(f.payouts as unknown as Array<{ status: string; amount: number; count: number }>).map((p) => (
              <div key={p.status} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span style={{ color: 'var(--text-muted)' }}>Payouts {humanise(p.status).toLowerCase()}</span>
                <span>{money(p.amount)} <span style={{ color: 'var(--text-muted)' }}>({p.count})</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent orders with the full split */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="ph">
          <h3>Recent orders</h3>
          <button className="btn btn-outline" style={{ padding: '5px 12px', fontSize: 12 }}
            onClick={() => onGo('orders')}>View all</button>
        </div>
        {data.recentOrders.length === 0 ? (
          <div className="empty-cart">No paid orders yet.</div>
        ) : (
          data.recentOrders.map((o) => {
            const sos = (o.sellerOrders ?? []) as Array<Record<string, unknown>>;
            return (
              <div key={String(o.id)} style={{ borderBottom: '1px solid var(--border)', padding: '11px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <div>
                    <strong>{String(o.orderNumber)}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {String(o.customer)}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {dateShort(o.createdAt as string)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <strong>{money(o.total as number)}</strong>
                    <StatusPill status={String(o.status)} />
                  </div>
                </div>
                {/* The fan-out, which only an admin sees in full */}
                <div style={{ paddingLeft: 12, fontSize: 12 }}>
                  {sos.map((so) => (
                    <div key={String(so.sellerOrderNumber)} style={{ display: 'flex', gap: 10,
                      flexWrap: 'wrap', padding: '2px 0', color: 'var(--text-muted)' }}>
                      <span style={{ fontFamily: 'monospace' }}>{String(so.sellerOrderNumber)}</span>
                      <span>{String(so.sellerName)}</span>
                      <span>{money(so.gross as number)}</span>
                      <span style={{ color: 'var(--green)' }}>fee {money(so.commission as number)}</span>
                      <StatusPill status={String(so.status)} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function ActionCard({ count, label, icon, onClick }: { count: number; label: string; icon: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ background: '#FFF8E8', border: '1px solid #F0D9A0',
      borderRadius: 'var(--radius-md)', padding: '13px 18px', cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 12, minWidth: 190 }}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 19, color: 'var(--orange)', lineHeight: 1.1 }}>{count}</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
          {label}{count === 1 ? '' : 's'} waiting
        </div>
      </div>
      <span style={{ marginLeft: 'auto', color: 'var(--orange)' }}>→</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sellers & KYC
// ---------------------------------------------------------------------------

function SellersTab() {
  const [sellers, setSellers] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.admin.sellers({ status: status || undefined, q: query || undefined });
      setSellers(d.sellers);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="panel">
        <div className="ph">
          <h3>Sellers</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="dash-search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, city…" style={{ minWidth: 180 }} />
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}>
              <option value="">All statuses</option>
              <option value="PENDING_REVIEW">Pending review</option>
              <option value="UNDER_REVIEW">Under review</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="DRAFT">Draft (incomplete)</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        ) : sellers.length === 0 ? (
          <div className="empty-cart">
            🏪<br />No sellers{status ? ` with status “${humanise(status)}”` : ''}.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Nursery</th><th>Owner</th><th>Location</th><th>KYC</th><th>Status</th><th>Listings</th><th /></tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={String(s.id)}>
                    <td>
                      <b>{String(s.businessName)}</b>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{String(s.businessEmail)}</div>
                    </td>
                    <td>{String(s.ownerName)}</td>
                    <td style={{ fontSize: 12 }}>{[s.city, s.state].filter(Boolean).join(', ')}</td>
                    <td>
                      <StatusPill status={String((s.kyc as Record<string, unknown>)?.verificationStatus ?? 'DRAFT')} />
                    </td>
                    <td><StatusPill status={String(s.status)} /></td>
                    <td>{Number(s.productCount)}</td>
                    <td>
                      <button className="btn btn-outline" style={{ padding: '5px 11px', fontSize: 12 }}
                        onClick={() => setReviewing(String(s.id))}>
                        Review →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewing && (
        <SellerReviewModal
          sellerId={reviewing}
          onClose={() => setReviewing(null)}
          onDecided={async () => { setReviewing(null); await load(); }}
        />
      )}
    </>
  );
}

function SellerReviewModal({
  sellerId,
  onClose,
  onDecided,
}: {
  sellerId: string;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [seller, setSeller] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [commissionRate, setCommissionRate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.admin
      .seller(sellerId)
      .then((d) => setSeller(d.seller))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [sellerId]);

  async function decide(decision: string) {
    if (['REJECT', 'SUSPEND', 'BLOCK'].includes(decision) && reason.trim().length < 3) {
      setError('Please give a reason — the seller is shown this.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin.decideSeller(sellerId, {
        decision,
        reason: reason.trim() || undefined,
        commissionRate: commissionRate ? Number(commissionRate) : undefined,
      });
      toastSuccess(res.message);
      onDecided();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const kyc = (seller?.kyc ?? {}) as Record<string, unknown>;
  const bank = (seller?.bankAccount ?? {}) as Record<string, unknown>;
  const status = String(seller?.status ?? '');

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && onClose()}>
      <div className="mbox wide" style={{ maxWidth: 640 }}>
        <button className="close-x mclose" onClick={onClose}>✕</button>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading the application…
          </div>
        )}

        {seller && (
          <>
            <h2 style={{ marginBottom: 2 }}>{String(seller.businessName)}</h2>
            <p className="msub">
              <StatusPill status={status} /> · registered {dateShort(seller.createdAt as string)}
            </p>

            {/* Business */}
            <Section title="Business">
              <Row label="Owner" value={String(seller.ownerName)} />
              <Row label="Email" value={String(seller.businessEmail)} />
              <Row label="Phone" value={String(seller.businessPhone)} />
              <Row label="Address" value={[seller.addressLine1, seller.addressLine2, seller.city, seller.state, seller.pincode].filter(Boolean).join(', ') || '—'} />
              {seller.description ? <Row label="About" value={String(seller.description)} /> : null}
              <Row label="Listings / orders" value={`${Number(seller.productCount)} / ${Number(seller.orderCount)}`} />
            </Section>

            {/* KYC — the one place these are shown, and the view is audited */}
            <Section title="KYC (viewing this is recorded in the audit log)">
              <Row label="KYC status" value={humanise(String(kyc.verificationStatus ?? 'DRAFT'))} />
              <Row label="PAN" value={String(kyc.panNumber ?? '— not provided')} mono />
              <Row label="GSTIN" value={String(kyc.gstNumber ?? '— not provided')} mono />
              <Row label="MSME" value={String(kyc.msmeNumber ?? '— not provided')} mono />
              <Row label="Aadhaar"
                value={kyc.aadhaarLast4 ? `•••• •••• ${String(kyc.aadhaarLast4)} (only last 4 stored)` : '— not provided'} mono />
              <Row label="Submitted" value={kyc.submittedAt ? dateTime(kyc.submittedAt as string) : '— not submitted'} />
            </Section>

            {/* Documents */}
            <Section title="Documents">
              {([['panDocUrl', 'PAN card'], ['addressDocUrl', 'Address proof'],
                 ['gstDocUrl', 'GST certificate'], ['bankDocUrl', 'Bank proof']] as Array<[string, string]>)
                .map(([key, label]) => {
                  const url = kyc[key] as string | null | undefined;
                  return (
                    <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'center',
                      padding: '5px 0', fontSize: 13 }}>
                      <span style={{ color: url ? 'var(--green)' : 'var(--text-muted)' }}>{url ? '✓' : '○'}</span>
                      <span style={{ flex: 1 }}>{label}</span>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--green)', fontSize: 12, fontWeight: 600 }}>
                          Open document →
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>not uploaded</span>
                      )}
                    </div>
                  );
                })}
            </Section>

            {/* Bank */}
            <Section title="Payout account">
              <Row label="Holder" value={String(bank.accountHolderName ?? '— not provided')} />
              <Row label="Account" value={bank.accountLast4 ? `•••••• ${String(bank.accountLast4)}` : '— not provided'} mono />
              <Row label="IFSC" value={String(bank.ifsc ?? '—')} mono />
              <Row label="Bank" value={String(bank.bankName ?? '—')} />
            </Section>

            {/* Decision */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 6 }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--forest)', marginBottom: 10 }}>
                Decision
              </h4>

              {status !== 'APPROVED' && (
                <div className="field">
                  <label>
                    Negotiated commission rate (%)
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> — optional, overrides category rates</span>
                  </label>
                  <input type="number" min="0" max="100" step="0.5" value={commissionRate}
                    onChange={(e) => setCommissionRate(e.target.value)} placeholder="e.g. 8" />
                </div>
              )}

              <div className="field">
                <label>
                  Reason / note
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> — required when rejecting or suspending</span>
                </label>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="The seller is shown this message."
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 13.5, resize: 'vertical' }} />
              </div>

              {error && (
                <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '10px 13px',
                  borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 12 }}>{error}</div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {['PENDING_REVIEW', 'UNDER_REVIEW', 'REJECTED', 'SUSPENDED'].includes(status) && (
                  <button className="btn btn-forest" disabled={busy} onClick={() => void decide('APPROVE')}>
                    {busy ? '…' : '✓ Approve seller'}
                  </button>
                )}
                {['PENDING_REVIEW', 'UNDER_REVIEW'].includes(status) && (
                  <>
                    <button className="btn btn-outline" disabled={busy} onClick={() => void decide('UNDER_REVIEW')}>
                      Mark under review
                    </button>
                    <button className="btn btn-outline" disabled={busy}
                      style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                      onClick={() => void decide('REJECT')}>
                      ✕ Reject
                    </button>
                  </>
                )}
                {status === 'APPROVED' && (
                  <button className="btn btn-outline" disabled={busy}
                    style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }}
                    onClick={() => void decide('SUSPEND')}>
                    ⏸ Suspend (hides their listings)
                  </button>
                )}
                {status === 'SUSPENDED' && (
                  <button className="btn btn-forest" disabled={busy} onClick={() => void decide('REINSTATE')}>
                    Reinstate
                  </button>
                )}
              </div>

              {status === 'DRAFT' && (
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.55 }}>
                  This seller has not submitted their application yet, so there is nothing to approve.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h4 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.5px',
        color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8 }}>{title}</h4>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 14px' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 13,
      borderBottom: '1px solid var(--cream-dark)' }}>
      <span style={{ width: 130, flexShrink: 0, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 500, wordBreak: 'break-word', fontFamily: mono ? 'monospace' : undefined }}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product moderation
// ---------------------------------------------------------------------------

function ModerationTab() {
  const [products, setProducts] = useState<Array<Record<string, unknown>>>([]);
  const [counts, setCounts] = useState<Array<{ approvalStatus: string; count: number }>>([]);
  const [approval, setApproval] = useState('PENDING');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.admin.products({ approval: approval || undefined });
      setProducts(d.products);
      setCounts(d.queueCounts);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [approval]);

  useEffect(() => { void load(); }, [load]);

  async function moderate(id: string, decision: 'APPROVE' | 'REJECT') {
    let reason: string | undefined;
    if (decision === 'REJECT') {
      const input = window.prompt('Why is this listing rejected? (the seller sees this)');
      if (!input || input.trim().length < 3) return;
      reason = input.trim();
    }
    setBusyId(id);
    try {
      const res = await api.admin.moderateProduct(id, { decision, reason });
      toastSuccess(res.message);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel">
      <div className="ph">
        <h3>Listing moderation</h3>
        <select value={approval} onChange={(e) => setApproval(e.target.value)}
          style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}>
          <option value="">All</option>
          {counts.map((c) => (
            <option key={c.approvalStatus} value={c.approvalStatus}>
              {humanise(c.approvalStatus)} ({c.count})
            </option>
          ))}
        </select>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -6, marginBottom: 16, lineHeight: 1.6 }}>
        Nothing is purchasable until it is approved here. A seller editing an approved listing&apos;s
        price or name sends it back to this queue.
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
        </div>
      ) : products.length === 0 ? (
        <div className="empty-cart">
          ✓<br />Nothing{approval ? ` ${humanise(approval).toLowerCase()}` : ''} in the queue.
        </div>
      ) : (
        products.map((p) => {
          const seller = (p.seller ?? {}) as Record<string, unknown>;
          const images = (p.images ?? []) as string[];
          const busy = busyId === String(p.id);

          return (
            <div key={String(p.id)} style={{ border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 14,
              display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {images[0] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={images[0]} alt={String(p.name)}
                  style={{ width: 110, height: 110, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 110, height: 110, borderRadius: 10, background: 'var(--cream)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>
                  🌱
                </div>
              )}

              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10,
                  flexWrap: 'wrap', marginBottom: 4 }}>
                  <strong style={{ fontSize: 14.5, color: 'var(--forest)' }}>{String(p.name)}</strong>
                  <StatusPill status={String(p.approvalStatus)} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {p.latinName ? <em>{String(p.latinName)} · </em> : null}
                  {String((p.category as Record<string, unknown>)?.name ?? '')} · SKU {String(p.sku)}
                </div>
                <div style={{ fontSize: 12.5, marginBottom: 6 }}>
                  🏪 <strong>{String(seller.businessName)}</strong>{' '}
                  <StatusPill status={String(seller.status)} />
                </div>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <strong style={{ fontSize: 15, color: 'var(--forest)' }}>{money(p.price as number)}</strong>
                  {p.compareAtPrice ? (
                    <s style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{money(p.compareAtPrice as number)}</s>
                  ) : null}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>{Number(p.stock)} in stock</span>
                </div>
                {p.description ? (
                  <p style={{ fontSize: 12.5, color: 'var(--text-mid)', margin: '0 0 10px',
                    lineHeight: 1.55, maxHeight: 60, overflow: 'hidden' }}>
                    {String(p.description)}
                  </p>
                ) : null}
                {p.rejectionReason ? (
                  <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>
                    Previously rejected: {String(p.rejectionReason)}
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {p.approvalStatus !== 'APPROVED' && (
                    <button className="btn btn-forest" disabled={busy}
                      onClick={() => void moderate(String(p.id), 'APPROVE')}>
                      {busy ? '…' : '✓ Approve'}
                    </button>
                  )}
                  {p.approvalStatus !== 'REJECTED' && (
                    <button className="btn btn-outline" disabled={busy}
                      style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                      onClick={() => void moderate(String(p.id), 'REJECT')}>
                      ✕ Reject
                    </button>
                  )}
                  {seller.status !== 'APPROVED' && p.approvalStatus !== 'APPROVED' && (
                    <span style={{ fontSize: 11.5, color: 'var(--orange)', alignSelf: 'center' }}>
                      The seller must be approved first.
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function OrdersTab() {
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [counts, setCounts] = useState<Array<{ status: string; count: number }>>([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.admin.orders({ status: status || undefined, q: query || undefined });
      setOrders(d.orders);
      setCounts(d.statusCounts);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="panel">
      <div className="ph">
        <h3>All orders</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="dash-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Order number, customer…" style={{ minWidth: 170 }} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}>
            <option value="">All statuses</option>
            {counts.map((c) => (
              <option key={c.status} value={c.status}>{humanise(c.status)} ({c.count})</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-cart">🛒<br />No orders found.</div>
      ) : (
        orders.map((o) => {
          const sos = (o.sellerOrders ?? []) as Array<Record<string, unknown>>;
          const customer = (o.customer ?? {}) as Record<string, unknown>;
          const isOpen = expanded === String(o.id);

          return (
            <div key={String(o.id)} style={{ border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: '13px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 12, flexWrap: 'wrap', cursor: 'pointer' }}
                onClick={() => setExpanded(isOpen ? null : String(o.id))}>
                <div>
                  <strong style={{ color: 'var(--forest)' }}>{String(o.orderNumber)}</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {String(customer.name)} · {String(customer.email)} · {dateShort(o.createdAt as string)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {sos.length} parcel{sos.length === 1 ? '' : 's'}
                  </span>
                  <strong>{money(o.grandTotal as number)}</strong>
                  <StatusPill status={String(o.paymentStatus)} />
                  <StatusPill status={String(o.status)} />
                  <span style={{ color: 'var(--text-muted)' }}>{isOpen ? '▴' : '▾'}</span>
                </div>
              </div>

              {isOpen && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr><th>Seller order</th><th>Seller</th><th>Status</th><th>Gross</th>
                          <th>Rate</th><th>Commission</th><th>Seller earns</th><th>Payout</th></tr>
                      </thead>
                      <tbody>
                        {sos.map((so) => (
                          <tr key={String(so.id)}>
                            <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                              {String(so.sellerOrderNumber)}
                            </td>
                            <td>{String((so.seller as Record<string, unknown>)?.businessName ?? '')}</td>
                            <td><StatusPill status={String(so.status)} /></td>
                            <td>{money(so.gross as number)}</td>
                            <td>{Number(so.commissionRate)}%</td>
                            <td style={{ color: 'var(--green)' }}>{money(so.commission as number)}</td>
                            <td>{money(so.sellerEarning as number)}</td>
                            <td><StatusPill status={String(so.payoutStatus)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5 }}>
                    <div><span style={{ color: 'var(--text-muted)' }}>Subtotal </span>{money(o.subtotal as number)}</div>
                    {Number(o.discount) > 0 && (
                      <div><span style={{ color: 'var(--text-muted)' }}>Discount </span>
                        <span style={{ color: 'var(--green)' }}>−{money(o.discount as number)}</span></div>
                    )}
                    {Number(o.tax) > 0 && (
                      <div><span style={{ color: 'var(--text-muted)' }}>Tax </span>{money(o.tax as number)}</div>
                    )}
                    <div><span style={{ color: 'var(--text-muted)' }}>Shipping </span>{money(o.shippingFee as number)}</div>
                    <div><strong>Total {money(o.grandTotal as number)}</strong></div>
                    {o.payment ? (
                      <div><span style={{ color: 'var(--text-muted)' }}>Paid via </span>
                        {String((o.payment as Record<string, unknown>).provider)}
                        {(o.payment as Record<string, unknown>).method
                          ? ` (${String((o.payment as Record<string, unknown>).method)})`
                          : ''}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

function PayoutsTab() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin.payouts>> | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.admin.payouts(status ? { status } : undefined));
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api.admin.payoutAction(body);
      toastSuccess(res.message);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(payoutId: string) {
    const reference = window.prompt(
      'Enter the payment provider\'s transfer reference.\n\nA payout cannot be marked paid without one — this is the record that the money actually moved.',
    );
    if (!reference || reference.trim().length < 3) return;
    await act({ action: 'MARK_PAID', payoutId, providerReference: reference.trim() });
  }

  const summary = data?.summary as Record<string, unknown> | undefined;
  const dueNow = (summary?.dueNow ?? { amount: 0, count: 0 }) as { amount: number; count: number };

  return (
    <>
      <div className="kpi-row" style={{ marginBottom: 20 }}>
        <div className="kpi">
          <div className="kl">Due for release now</div>
          <div className="kv">{money(dueNow.amount)}</div>
          <div className="kd">{dueNow.count} payout{dueNow.count === 1 ? '' : 's'} past the return window</div>
        </div>
        {((summary?.byStatus ?? []) as Array<{ status: string; amount: number; count: number }>).map((s) => (
          <div className="kpi" key={s.status}>
            <div className="kl">{humanise(s.status)}</div>
            <div className="kv">{money(s.amount)}</div>
            <div className="kd">{s.count} payout{s.count === 1 ? '' : 's'}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="ph">
          <h3>Seller payouts</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}>
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="PAID">Paid</option>
              <option value="ON_HOLD">On hold</option>
            </select>
            <button className="btn btn-forest" disabled={busy || dueNow.count === 0}
              onClick={() => void act({ action: 'SUBMIT_BATCH' })}>
              {busy ? '…' : `Submit batch (${dueNow.count})`}
            </button>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -6, marginBottom: 16, lineHeight: 1.6 }}>
          Submitting a batch moves payouts to <strong>processing</strong> only. They become{' '}
          <strong>paid</strong> when you record the provider&apos;s transfer reference — nothing here
          marks money as sent on its own.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        ) : (data?.payouts.length ?? 0) === 0 ? (
          <div className="empty-cart">💸<br />No payouts{status ? ` ${humanise(status).toLowerCase()}` : ' yet'}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Seller</th><th>Order</th><th>Bank</th><th>Net</th><th>Status</th><th>Eligible</th><th /></tr>
              </thead>
              <tbody>
                {data!.payouts.map((p) => {
                  const seller = (p.seller ?? {}) as Record<string, unknown>;
                  const bank = (seller.bankAccount ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={String(p.id)}>
                      <td>
                        <b>{String(seller.businessName)}</b>
                        {!bank.isVerified && (
                          <div style={{ fontSize: 10.5, color: 'var(--orange)' }}>bank not verified</div>
                        )}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{String(p.sellerOrderNumber)}</td>
                      <td style={{ fontSize: 11.5, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {bank.accountLast4 ? `••${String(bank.accountLast4)} / ${String(bank.ifsc)}` : '— none'}
                      </td>
                      <td>
                        <strong>{money(p.net as number)}</strong>
                        {Number(p.refundAdjustment) > 0 && (
                          <div style={{ fontSize: 10.5, color: 'var(--red)' }}>
                            −{money(p.refundAdjustment as number)} refunded
                          </div>
                        )}
                      </td>
                      <td>
                        <StatusPill status={String(p.status)} />
                        {p.failureReason ? (
                          <div style={{ fontSize: 10.5, color: 'var(--red)', maxWidth: 140 }}>
                            {String(p.failureReason)}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ fontSize: 11.5 }}>
                        {p.eligibleNow ? (
                          <span style={{ color: 'var(--green)', fontWeight: 600 }}>now</span>
                        ) : (
                          dateShort(p.eligibleAt as string)
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {p.status === 'PROCESSING' && (
                            <button className="btn btn-forest" style={{ padding: '4px 10px', fontSize: 11.5 }}
                              disabled={busy} onClick={() => void markPaid(String(p.id))}>
                              Mark paid
                            </button>
                          )}
                          {['PENDING', 'PROCESSING'].includes(String(p.status)) && (
                            <button className="btn btn-outline" style={{ padding: '4px 10px', fontSize: 11.5 }}
                              disabled={busy}
                              onClick={() => {
                                const reason = window.prompt('Why hold this payout?');
                                if (reason && reason.trim()) void act({ action: 'HOLD', payoutId: String(p.id), reason: reason.trim() });
                              }}>
                              Hold
                            </button>
                          )}
                          {p.status === 'PAID' && (
                            <span style={{ fontSize: 10.5, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                              {String(p.reference ?? '')}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Returns & refunds
// ---------------------------------------------------------------------------

function ReturnsTab() {
  const [returns, setReturns] = useState<Array<Record<string, unknown>>>([]);
  const [refunds, setRefunds] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, f] = await Promise.all([api.admin.returns(), api.admin.refunds()]);
      setReturns(r.returns);
      setRefunds(f.refunds);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function progress(id: string, status: string) {
    setBusyId(id);
    try {
      const res = await api.admin.returnAction(id, { kind: 'PROGRESS', status });
      toastSuccess(res.message);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function refund(sellerOrderId: string, returnId: string, suggested: number) {
    const input = window.prompt(
      `Refund amount in ₹ (leave as-is for the full inspected amount).\n\nCommission is reversed proportionally and the seller's payout adjusted automatically.`,
      String(suggested / 100),
    );
    if (input === null) return;
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0) {
      toastError('Please enter a valid amount.');
      return;
    }
    setBusyId(returnId);
    try {
      const res = await api.admin.issueRefund({
        sellerOrderId,
        amountRupees: amount,
        reason: 'Approved return',
        returnId,
      });
      toastSuccess(res.message);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const NEXT_STEP: Record<string, { status: string; label: string }> = {
    APPROVED: { status: 'PICKUP_SCHEDULED', label: 'Schedule pickup' },
    PICKUP_SCHEDULED: { status: 'PICKED_UP', label: 'Mark picked up' },
    PICKED_UP: { status: 'RECEIVED', label: 'Mark received (restocks)' },
    RECEIVED: { status: 'INSPECTED', label: 'Mark inspected' },
  };

  return (
    <>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="ph"><h3>Returns</h3></div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        ) : returns.length === 0 ? (
          <div className="empty-cart">↩️<br />No returns.</div>
        ) : (
          returns.map((r) => {
            const so = (r.sellerOrder ?? {}) as Record<string, unknown>;
            const seller = (so.seller ?? {}) as Record<string, unknown>;
            const next = NEXT_STEP[String(r.status)];
            const busy = busyId === String(r.id);
            const canRefund = r.status === 'INSPECTED' && !r.refund;

            return (
              <div key={String(r.id)} style={{ border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '13px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div>
                    <strong style={{ color: 'var(--forest)' }}>{String(r.returnNumber)}</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {String(so.sellerOrderNumber ?? '')} · {String(seller.businessName ?? '')} ·{' '}
                      {dateShort(r.createdAt as string)}
                    </div>
                  </div>
                  <StatusPill status={String(r.status)} />
                </div>

                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <strong>{humanise(String(r.reason))}</strong>
                  {r.description ? (
                    <span style={{ color: 'var(--text-mid)' }}> — &ldquo;{String(r.description)}&rdquo;</span>
                  ) : null}
                </div>

                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10 }}>
                  Refund requested: <strong style={{ color: 'var(--text)' }}>{money(r.refundAmount as number)}</strong>
                  {r.refund ? (
                    <>
                      {' · refunded '}
                      <strong style={{ color: 'var(--green)' }}>
                        {money((r.refund as Record<string, unknown>).amount as number)}
                      </strong>
                    </>
                  ) : null}
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {next && (
                    <button className="btn btn-forest" disabled={busy}
                      onClick={() => void progress(String(r.id), next.status)}>
                      {busy ? '…' : next.label}
                    </button>
                  )}
                  {canRefund && (
                    <button className="btn btn-forest" disabled={busy}
                      onClick={() => void refund(String(so.id ?? ''), String(r.id), Number(r.refundAmount))}>
                      💸 Issue refund
                    </button>
                  )}
                  {r.status === 'REQUESTED' && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                      Waiting for the seller to approve or reject.
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="panel">
        <div className="ph"><h3>Refund ledger</h3></div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -6, marginBottom: 14, lineHeight: 1.6 }}>
          Every refund reverses platform commission and debits the seller in the original proportion.
        </p>
        {refunds.length === 0 ? (
          <div className="empty-cart">No refunds issued.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Order</th><th>Seller</th><th>Refunded</th><th>Commission reversed</th>
                  <th>Seller debit</th><th>Status</th><th>Provider ref</th></tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={String(r.id)}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                      {String(r.sellerOrderNumber ?? r.orderNumber)}
                    </td>
                    <td style={{ fontSize: 12 }}>{String(r.sellerName ?? '—')}</td>
                    <td><strong>{money(r.amount as number)}</strong></td>
                    <td style={{ color: 'var(--green)' }}>{money(r.commissionReversed as number)}</td>
                    <td style={{ color: 'var(--red)' }}>{money(r.sellerDebit as number)}</td>
                    <td><StatusPill status={String(r.status)} /></td>
                    <td style={{ fontSize: 10.5, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {r.providerRefundId ? String(r.providerRefundId) : 'manual'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

function CouponsTab() {
  const [coupons, setCoupons] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.admin.coupons();
      setCoupons(d.coupons);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(id: string, isActive: boolean) {
    try {
      await api.admin.toggleCoupon(id, isActive);
      toastSuccess(isActive ? 'Coupon enabled' : 'Coupon disabled');
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    }
  }

  return (
    <>
      <div className="panel">
        <div className="ph">
          <h3>Coupons</h3>
          <button className="add-p-btn" onClick={() => setShowNew(true)}>+ New coupon</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        ) : coupons.length === 0 ? (
          <div className="empty-cart">🎟️<br />No coupons yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Code</th><th>Applies to</th><th>Discount</th><th>Minimum</th>
                  <th>Used</th><th>Window</th><th>State</th><th /></tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={String(c.id)}>
                    <td><b style={{ fontFamily: 'monospace' }}>{String(c.code)}</b>
                      {c.description ? (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{String(c.description)}</div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {humanise(String(c.scope))}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{String(c.target)}</div>
                    </td>
                    <td>
                      {c.discountType === 'PERCENT'
                        ? `${Number(c.discountValue)}%`
                        : money(c.discountValue as number)}
                      {c.maxDiscount ? (
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                          max {money(c.maxDiscount as number)}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {Number(c.minOrderValue) > 0 ? money(c.minOrderValue as number) : '—'}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {Number(c.usageCount)}{c.usageLimit ? ` / ${Number(c.usageLimit)}` : ''}
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {dateShort(c.startsAt as string)}<br />→ {dateShort(c.expiresAt as string)}
                    </td>
                    <td><StatusPill status={String(c.state)} /></td>
                    <td>
                      <button className="btn btn-outline" style={{ padding: '4px 10px', fontSize: 11.5 }}
                        onClick={() => void toggle(String(c.id), !c.isActive)}>
                        {c.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewCouponModal onClose={() => setShowNew(false)}
        onCreated={async () => { setShowNew(false); await load(); }} />}
    </>
  );
}

function NewCouponModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const [form, setForm] = useState({
    code: '', description: '', scope: 'PLATFORM', discountType: 'PERCENT',
    discountValue: '10', maxDiscountRupees: '', minOrderRupees: '0',
    startsAt: today, expiresAt: in30, usageLimit: '', perCustomerLimit: '1',
    sellerId: '', categoryId: '',
  });
  const [sellers, setSellers] = useState<Array<{ id: string; businessName: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.admin.sellers({ status: 'APPROVED', perPage: 100 })
      .then((d) => setSellers(d.sellers as never))
      .catch(() => undefined);
    void api.catalog.categories().then((d) => setCategories(d.categories as never)).catch(() => undefined);
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.admin.createCoupon({
        code: form.code,
        description: form.description || undefined,
        scope: form.scope,
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        maxDiscountRupees: form.maxDiscountRupees ? Number(form.maxDiscountRupees) : undefined,
        minOrderRupees: Number(form.minOrderRupees) || 0,
        startsAt: new Date(form.startsAt).toISOString(),
        expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString(),
        usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
        perCustomerLimit: Number(form.perCustomerLimit) || 1,
        sellerId: form.scope === 'SELLER' ? form.sellerId : undefined,
        categoryId: form.scope === 'CATEGORY' ? form.categoryId : undefined,
      });
      toastSuccess(`Coupon ${form.code} created`);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && onClose()}>
      <div className="mbox" style={{ maxWidth: 520 }}>
        <button className="close-x mclose" onClick={onClose}>✕</button>
        <h2>New coupon</h2>
        <p className="msub">
          Platform coupons are split across sellers pro-rata, so commission stays correct.
        </p>

        <div className="frow">
          <div className="field">
            <label>Code</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="GREEN10" style={{ fontFamily: 'monospace' }} />
          </div>
          <div className="field">
            <label>Applies to</label>
            <select value={form.scope} onChange={set('scope')}>
              <option value="PLATFORM">Whole marketplace</option>
              <option value="SELLER">One seller</option>
              <option value="CATEGORY">One category</option>
            </select>
          </div>
        </div>

        {form.scope === 'SELLER' && (
          <div className="field">
            <label>Seller</label>
            <select value={form.sellerId} onChange={set('sellerId')}>
              <option value="">Choose a seller…</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.businessName}</option>)}
            </select>
          </div>
        )}
        {form.scope === 'CATEGORY' && (
          <div className="field">
            <label>Category</label>
            <select value={form.categoryId} onChange={set('categoryId')}>
              <option value="">Choose a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="frow">
          <div className="field">
            <label>Type</label>
            <select value={form.discountType} onChange={set('discountType')}>
              <option value="PERCENT">Percentage off</option>
              <option value="FIXED">Fixed ₹ off</option>
            </select>
          </div>
          <div className="field">
            <label>{form.discountType === 'PERCENT' ? 'Percent (1–100)' : 'Amount (₹)'}</label>
            <input type="number" min="1" value={form.discountValue} onChange={set('discountValue')} />
          </div>
          {form.discountType === 'PERCENT' && (
            <div className="field">
              <label>Cap (₹)</label>
              <input type="number" min="0" value={form.maxDiscountRupees}
                onChange={set('maxDiscountRupees')} placeholder="300" />
            </div>
          )}
        </div>

        <div className="frow">
          <div className="field">
            <label>Minimum order (₹)</label>
            <input type="number" min="0" value={form.minOrderRupees} onChange={set('minOrderRupees')} />
          </div>
          <div className="field">
            <label>Total uses</label>
            <input type="number" min="1" value={form.usageLimit} onChange={set('usageLimit')} placeholder="unlimited" />
          </div>
          <div className="field">
            <label>Per customer</label>
            <input type="number" min="1" value={form.perCustomerLimit} onChange={set('perCustomerLimit')} />
          </div>
        </div>

        <div className="frow">
          <div className="field">
            <label>Starts</label>
            <input type="date" value={form.startsAt} onChange={set('startsAt')} />
          </div>
          <div className="field">
            <label>Expires</label>
            <input type="date" value={form.expiresAt} onChange={set('expiresAt')} />
          </div>
        </div>

        <div className="field">
          <label>Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(shown to customers)</span></label>
          <input value={form.description} onChange={set('description')} placeholder="10% off your order, up to ₹300" />
        </div>

        {error && (
          <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '10px 13px',
            borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        <button className="cta-full" onClick={submit} disabled={busy || !form.code || !form.discountValue}>
          {busy ? 'Creating…' : 'Create coupon'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsTab() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.admin.settings();
      setSettings(d.settings);
      setDescriptions(d.descriptions);
      setDraft(
        Object.fromEntries(Object.entries(d.settings).map(([k, v]) => [k, String(v)])),
      );
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, number> = {};
      for (const key of Object.keys(descriptions)) {
        const value = Number(draft[key]);
        if (Number.isFinite(value) && String(value) !== String(settings[key])) body[key] = value;
      }
      if (Object.keys(body).length === 0) {
        toastSuccess('No changes to save.');
        return;
      }
      const res = await api.admin.updateSettings(body);
      toastSuccess(res.message);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading settings…
      </div>
    );
  }

  const PAISE_KEYS = ['shipping.flatFeePerSeller', 'shipping.freeAboveSubtotal'];

  return (
    <div className="panel">
      <div className="ph"><h3>Platform settings</h3></div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -6, marginBottom: 18, lineHeight: 1.6 }}>
        These apply to <strong>new</strong> orders. Existing orders keep the commission rate and
        shipping they were placed at, which is why historical reports stay correct.
      </p>

      {Object.entries(descriptions).map(([key, description]) => (
        <div className="field" key={key}>
          <label>
            {key}
            {PAISE_KEYS.includes(key) && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> (in paise)</span>
            )}
          </label>
          <input type="number" value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          <small style={{ color: 'var(--text-muted)' }}>
            {description}
            {PAISE_KEYS.includes(key) && draft[key]
              ? ` — currently ${money(Number(draft[key]))}`
              : ''}
          </small>
        </div>
      ))}

      <button className="btn btn-forest" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
