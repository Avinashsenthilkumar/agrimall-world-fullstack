// app/seller/dashboard/page.tsx — §5, §26. The seller's own data only.
//
// v1's version signed in through `window.__sellerSession` and read a demo
// array. This reads the API, which scopes everything by the session's seller
// id, and shows the honest commission/earning split on every order.
//
// A seller who is not yet APPROVED still gets in — they see their application
// status and what is blocked, rather than a broken dashboard.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LeafParticles from '../../../components/LeafParticles';
import StatusPill from '../../../components/StatusPill';
import { toastError, toastSuccess } from '../../../components/Toast';
import api from '../../../lib/client/api';
import { useApp, errorMessage } from '../../../lib/client/AppContext';
import { money, dateShort, dateTime, humanise } from '../../../lib/client/format';

type Tab = 'overview' | 'products' | 'inventory' | 'orders' | 'finance' | 'returns' | 'profile';

export default function SellerDashboardPage() {
  const router = useRouter();
  const { user, authLoading, logout } = useApp();

  const [tab, setTab] = useState<Tab>('overview');
  const [dash, setDash] = useState<Awaited<ReturnType<typeof api.seller.dashboard>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobMenuOpen, setMobMenuOpen] = useState(false);

  // Route guard: this page belongs to sellers.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login?next=/seller/dashboard');
      return;
    }
    if (user.role !== 'SELLER') {
      router.replace(user.role === 'ADMIN' ? '/admin' : '/customer');
    }
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setDash(await api.seller.dashboard());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'SELLER') void load();
  }, [user, load]);

  if (authLoading || loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh',
        flexDirection: 'column', gap: 14, color: 'var(--text-muted)' }}>
        <div className="spinner" />
        Loading your dashboard…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: 24 }}>
        <h2 style={{ color: 'var(--forest)' }}>We could not load your dashboard</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>{error}</p>
        <button className="btn btn-forest" onClick={() => { setLoading(true); void load(); }}>Try again</button>
      </div>
    );
  }

  const seller = (dash?.seller ?? {}) as Record<string, unknown>;
  const canSell = Boolean(seller.canSell);
  const stats = dash?.stats as Record<string, number> | null;
  const earnings = dash?.earnings as Record<string, number> | null;

  const navItems: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'products', label: '🌿 My Listings' },
    { id: 'inventory', label: '📦 Inventory' },
    { id: 'orders', label: '🛒 Orders' },
    { id: 'finance', label: '💰 Finance' },
    { id: 'returns', label: '↩️ Returns' },
    { id: 'profile', label: '👤 Store & KYC' },
  ];

  return (
    <>
      <LeafParticles />
      <div className="dash-shell">
        {/* SIDEBAR */}
        <div className="dsb">
          <div className="dsb-logo">
            <div className="icon">🌿</div>
            <div className="name">{String(seller.businessName || 'Agri Mall')}</div>
          </div>
          <div className="dsb-sub">
            Seller{seller.location ? ` · ${String(seller.location)}` : ''}
          </div>
          <div className="dnav">
            {navItems.map((n) => (
              <div key={n.id} className={`si ${tab === n.id ? 'on' : ''}`}
                onClick={() => { setTab(n.id); setMobMenuOpen(false); }}>
                {n.label}
              </div>
            ))}
          </div>
          <div className="dexit" onClick={async () => { await logout(); router.push('/'); }}>
            ⏎ Sign out
          </div>
        </div>

        {/* MAIN */}
        <div className="dmain">
          <div className="dash-topbar">
            <div>
              <h2>Seller dashboard</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                {String(seller.businessName || '—')}
                {seller.commissionRate != null
                  ? ` · ${Number(seller.commissionRate)}% commission on your sales`
                  : ''}
              </p>
            </div>
            <div className="dash-topbar-right">
              <button className="hamburger-btn" onClick={() => setMobMenuOpen(true)} aria-label="Menu">
                <span /><span /><span />
              </button>
              <StatusPill status={String(seller.status)} />
            </div>
          </div>

          {mobMenuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 199 }}
                onClick={() => setMobMenuOpen(false)} />
              <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(270px,85vw)',
                background: 'var(--forest)', zIndex: 200, padding: '22px 16px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <span style={{ color: '#fff', fontWeight: 700 }}>🌿 Menu</span>
                  <button onClick={() => setMobMenuOpen(false)}
                    style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff',
                      width: 30, height: 30, borderRadius: '50%', cursor: 'pointer' }}>✕</button>
                </div>
                {navItems.map((n) => (
                  <div key={n.id} className={`si ${tab === n.id ? 'on' : ''}`}
                    onClick={() => { setTab(n.id); setMobMenuOpen(false); }}>{n.label}</div>
                ))}
              </div>
            </>
          )}

          <div className="dash-body">
            {/* ---- Application-status banner (§4) ---- */}
            {!canSell && (
              <div style={{
                background: seller.status === 'REJECTED' ? '#FFF0F0' : '#FFF8E8',
                border: `1px solid ${seller.status === 'REJECTED' ? '#F0B0B0' : '#F0D9A0'}`,
                borderRadius: 'var(--radius-md)', padding: '16px 20px', marginBottom: 22,
              }}>
                <div style={{ fontWeight: 700, color: seller.status === 'REJECTED' ? 'var(--red)' : 'var(--orange)',
                  marginBottom: 6, fontSize: 14.5 }}>
                  {seller.status === 'DRAFT' && '📋 Your application is not finished'}
                  {(seller.status === 'PENDING_REVIEW' || seller.status === 'UNDER_REVIEW') && '⏳ Your application is under review'}
                  {seller.status === 'REJECTED' && '✕ Your application was not approved'}
                  {seller.status === 'SUSPENDED' && '⏸ Your account is suspended'}
                  {seller.status === 'BLOCKED' && '🚫 Your account is blocked'}
                </div>
                <p style={{ fontSize: 13.5, color: 'var(--text-mid)', margin: '0 0 12px', lineHeight: 1.6 }}>
                  {seller.status === 'DRAFT' &&
                    'Complete your KYC, bank details and documents, then submit for review. You can list plants once approved.'}
                  {(seller.status === 'PENDING_REVIEW' || seller.status === 'UNDER_REVIEW') &&
                    `Our verification team is checking your documents${seller.kycSubmittedAt ? ` (submitted ${dateShort(seller.kycSubmittedAt as string)})` : ''}. You will be able to list plants as soon as this is approved.`}
                  {seller.status === 'REJECTED' &&
                    (String(seller.rejectionReason || seller.kycRejectionReason || 'Please contact support for details.'))}
                  {(seller.status === 'SUSPENDED' || seller.status === 'BLOCKED') &&
                    (String(seller.rejectionReason || 'Please contact support.'))}
                </p>
                {(seller.status === 'DRAFT' || seller.status === 'REJECTED') && (
                  <button className="btn btn-forest" onClick={() => router.push('/seller/onboard')}>
                    {seller.status === 'DRAFT' ? 'Finish my application →' : 'Update my details →'}
                  </button>
                )}
              </div>
            )}

            {/* ---- OVERVIEW ---- */}
            {tab === 'overview' && (
              <>
                {canSell && stats && earnings ? (
                  <>
                    <div className="kpi-row" style={{ marginBottom: 20 }}>
                      <div className="kpi">
                        <div className="kpi-icon green">💰</div>
                        <div>
                          <div className="kl">Total sales</div>
                          <div className="kv">{money(stats.totalSales)}</div>
                          <div className="kd">{stats.totalOrders} paid order{stats.totalOrders === 1 ? '' : 's'}</div>
                        </div>
                      </div>
                      <div className="kpi">
                        <div className="kpi-icon blue">🌿</div>
                        <div>
                          <div className="kl">Live listings</div>
                          <div className="kv">{stats.liveProducts}</div>
                          <div className="kd">on the marketplace</div>
                        </div>
                      </div>
                      <div className="kpi">
                        <div className="kpi-icon orange">📦</div>
                        <div>
                          <div className="kl">To fulfil</div>
                          <div className="kv">{stats.pendingOrders}</div>
                          <div className="kd">{stats.pendingOrders > 0 ? 'needs your action' : 'all caught up'}</div>
                        </div>
                      </div>
                      <div className="kpi">
                        <div className="kpi-icon orange">⚠️</div>
                        <div>
                          <div className="kl">Low stock</div>
                          <div className="kv">{stats.lowStockCount}</div>
                          <div className="kd kwarn">{stats.lowStockCount > 0 ? 'restock soon' : 'healthy'}</div>
                        </div>
                      </div>
                    </div>

                    {/* The honest money breakdown (§5 Finance) */}
                    <div className="panel" style={{ marginBottom: 20 }}>
                      <div className="ph"><h3>Your earnings</h3></div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 1,
                        background: 'var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                        {([
                          ['Gross sales', money(earnings.grossSales), 'var(--text)'],
                          ['− Platform commission', `−${money(earnings.commission)}`, 'var(--red)'],
                          ['− Refunds', `−${money(earnings.refunds)}`, 'var(--red)'],
                          ['= Net earnings', money(earnings.netEarnings), 'var(--green)'],
                        ] as Array<[string, string, string]>).map(([label, value, color]) => (
                          <div key={label} style={{ background: '#fff', padding: '14px 16px' }}>
                            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px',
                              color: 'var(--text-muted)', fontWeight: 600, marginBottom: 5 }}>{label}</div>
                            <div style={{ fontSize: 17, fontWeight: 700, color }}>{value}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 16, fontSize: 13 }}>
                        <div><span style={{ color: 'var(--text-muted)' }}>Available for payout: </span>
                          <strong style={{ color: 'var(--green)' }}>{money(earnings.availableForPayout)}</strong></div>
                        <div><span style={{ color: 'var(--text-muted)' }}>Held / pending: </span>
                          <strong>{money(earnings.pendingPayout)}</strong></div>
                        <div><span style={{ color: 'var(--text-muted)' }}>Paid out: </span>
                          <strong>{money(earnings.paidPayout)}</strong></div>
                      </div>
                    </div>

                    {/* Recent orders */}
                    <div className="panel" style={{ marginBottom: 20 }}>
                      <div className="ph">
                        <h3>Recent orders</h3>
                        <button className="btn btn-outline" style={{ padding: '5px 12px', fontSize: 12 }}
                          onClick={() => setTab('orders')}>View all</button>
                      </div>
                      {(dash?.recentOrders.length ?? 0) === 0 ? (
                        <div className="empty-cart">No orders yet. They appear here as soon as a customer buys one of your plants.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table>
                            <thead>
                              <tr><th>Order</th><th>Items</th><th>Status</th><th>Order value</th><th>You earn</th></tr>
                            </thead>
                            <tbody>
                              {dash!.recentOrders.map((o) => (
                                <tr key={String(o.id)}>
                                  <td>
                                    <b>{String(o.sellerOrderNumber)}</b>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                      {dateShort(o.createdAt as string)}
                                      {o.destination ? ` · ${String(o.destination)}` : ''}
                                    </div>
                                  </td>
                                  <td style={{ maxWidth: 210 }}>{String(o.itemsLabel)}</td>
                                  <td><StatusPill status={String(o.status)} /></td>
                                  <td>{money(o.total as number)}</td>
                                  <td style={{ color: 'var(--green)', fontWeight: 600 }}>{money(o.earning as number)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Low stock */}
                    {(dash?.lowStock.length ?? 0) > 0 && (
                      <div className="panel">
                        <div className="ph"><h3>Running low</h3></div>
                        <table>
                          <thead><tr><th>Plant</th><th>Available</th><th>Threshold</th></tr></thead>
                          <tbody>
                            {dash!.lowStock.map((p) => (
                              <tr key={String(p.id)}>
                                <td>{String(p.name)}</td>
                                <td style={{ color: Number(p.available) === 0 ? 'var(--red)' : 'var(--orange)', fontWeight: 700 }}>
                                  {Number(p.available)}
                                </td>
                                <td style={{ color: 'var(--text-muted)' }}>{Number(p.threshold)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="panel" style={{ textAlign: 'center', padding: '50px 24px' }}>
                    <div style={{ fontSize: 42, marginBottom: 14 }}>🌱</div>
                    <h3 style={{ color: 'var(--forest)', marginBottom: 8 }}>Nothing to show yet</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13.5, maxWidth: 400, margin: '0 auto' }}>
                      Your sales, orders and earnings will appear here once your account is approved and
                      you have listed your first plants.
                    </p>
                  </div>
                )}
              </>
            )}

            {tab === 'products' && <ProductsTab canSell={canSell} onChanged={load} />}
            {tab === 'inventory' && <InventoryTab canSell={canSell} />}
            {tab === 'orders' && <OrdersTab canSell={canSell} onChanged={load} />}
            {tab === 'finance' && <FinanceTab canSell={canSell} />}
            {tab === 'returns' && <ReturnsTab canSell={canSell} />}
            {tab === 'profile' && <ProfileTab />}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function ProductsTab({ canSell, onChanged }: { canSell: boolean; onChanged: () => void }) {
  const [products, setProducts] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.seller.products();
      setProducts(d.products);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delist "${name}"? Customers will no longer see it.`)) return;
    try {
      const res = await api.seller.deleteProduct(id);
      toastSuccess(res.message);
      await load();
      onChanged();
    } catch (err) {
      toastError(errorMessage(err));
    }
  }

  return (
    <div className="panel">
      <div className="ph">
        <h3>My listings</h3>
        {canSell && (
          <button className="add-p-btn" onClick={() => setShowAdd(true)}>+ Add a plant</button>
        )}
      </div>

      {!canSell && (
        <div style={{ background: 'var(--cream)', padding: '14px 16px', borderRadius: 'var(--radius-sm)',
          fontSize: 13.5, marginBottom: 16, lineHeight: 1.6 }}>
          You can add plants once your seller account is approved.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
        </div>
      ) : products.length === 0 ? (
        <div className="empty-cart">
          🌱<br />No plants listed yet.
          {canSell && <><br />Click &ldquo;Add a plant&rdquo; to list your first one.</>}
        </div>
      ) : (
        <div className="grid">
          {products.map((p) => {
            const stock = (p.stock ?? {}) as Record<string, number | boolean>;
            return (
              <div className="lcard" key={String(p.id)}>
                <div className="lci">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={String(p.imageUrl ?? 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&q=60')}
                    alt={String(p.name)} />
                  {p.approvalStatus === 'APPROVED' && p.status === 'ACTIVE' && <div className="llive">Live</div>}
                  {p.approvalStatus === 'PENDING' && (
                    <div className="llive" style={{ background: 'var(--orange)' }}>Awaiting approval</div>
                  )}
                  {p.approvalStatus === 'REJECTED' && (
                    <div className="llive" style={{ background: 'var(--red)' }}>Rejected</div>
                  )}
                  {Boolean(stock.isLow) && <div className="llow">Low stock</div>}
                  <div className="ldel" onClick={() => void remove(String(p.id), String(p.name))} title="Delist">🗑</div>
                </div>
                <div className="lcb">
                  <div className="lcn">{String(p.name)}</div>
                  <div className="lcp">{money(p.price as number)}</div>
                  <div className="lcs">
                    📦 {Number(stock.available)} available
                    {Number(stock.reserved) > 0 && (
                      <span style={{ color: 'var(--orange)' }}> · {Number(stock.reserved)} reserved</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    SKU {String(p.sku)} · {Number(p.soldCount ?? 0)} sold
                  </div>
                  {p.rejectionReason ? (
                    <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 6, lineHeight: 1.45 }}>
                      {String(p.rejectionReason)}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddProductModal
          onClose={() => setShowAdd(false)}
          onAdded={async () => { setShowAdd(false); await load(); onChanged(); }}
        />
      )}
    </div>
  );
}

function AddProductModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [categories, setCategories] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [form, setForm] = useState({
    name: '', latinName: '', description: '', categoryId: '', sku: '',
    price: '', compareAtPrice: '', stock: '', lowStockThreshold: '10',
    careLight: '', careWater: '', careTemp: '', careDifficulty: '', careSafety: '',
  });
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void api.catalog.categories().then((d) => {
      setCategories(d.categories);
      if (d.categories[0]) setForm((f) => ({ ...f, categoryId: d.categories[0].id }));
    });
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function pickImage(file: File) {
    setUploading(true);
    try {
      const res = await api.upload(file, 'PRODUCT_IMAGE');
      setImageUrl(res.file.url);
      toastSuccess('Photo uploaded');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const res = await api.seller.createProduct({
        name: form.name,
        latinName: form.latinName || undefined,
        description: form.description || undefined,
        categoryId: form.categoryId,
        sku: form.sku,
        // Rupees in; the server converts to paise and is the only authority
        // on what this plant costs from here on.
        price: Number(form.price),
        compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : undefined,
        stock: Number(form.stock),
        lowStockThreshold: Number(form.lowStockThreshold) || 10,
        careLight: form.careLight || undefined,
        careWater: form.careWater || undefined,
        careTemp: form.careTemp || undefined,
        careDifficulty: form.careDifficulty || undefined,
        careSafety: form.careSafety || undefined,
        imageUrls: imageUrl ? [imageUrl] : [],
        submitForApproval: true,
      });
      toastSuccess(res.message);
      onAdded();
    } catch (err) {
      if (err instanceof Error && 'fields' in err) {
        const fields = (err as { fields?: Record<string, string[]> }).fields;
        if (fields) {
          const flat: Record<string, string> = {};
          for (const [k, v] of Object.entries(fields)) flat[k] = v.join(' ');
          setFieldErrors(flat);
        }
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && onClose()}>
      <div className="mbox" style={{ maxWidth: 560 }}>
        <button className="close-x mclose" onClick={onClose}>✕</button>
        <h2>List a new plant</h2>
        <p className="msub">
          Our catalogue team checks each new listing before it goes live, usually within a day.
        </p>

        {imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={imageUrl} alt="preview"
            style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 10, marginBottom: 12 }} />
        )}

        <div className="field">
          <label>Photo</label>
          <label className="btn btn-outline" style={{ cursor: 'pointer', display: 'inline-block' }}>
            {uploading ? 'Uploading…' : imageUrl ? 'Replace photo' : 'Choose a photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = ''; }} />
          </label>
        </div>

        <div className="field">
          <label>Plant name</label>
          <input value={form.name} onChange={set('name')} placeholder="e.g. Curry Leaf Plant" />
          {fieldErrors.name && <small style={{ color: 'var(--red)' }}>{fieldErrors.name}</small>}
        </div>
        <div className="frow">
          <div className="field">
            <label>Botanical name <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <input value={form.latinName} onChange={set('latinName')} placeholder="Murraya koenigii" />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.categoryId} onChange={set('categoryId')}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="frow">
          <div className="field">
            <label>Your SKU</label>
            <input value={form.sku} onChange={set('sku')} placeholder="GRN-CUR-002" />
            {fieldErrors.sku && <small style={{ color: 'var(--red)' }}>{fieldErrors.sku}</small>}
          </div>
          <div className="field">
            <label>Price (₹)</label>
            <input type="number" min="0" value={form.price} onChange={set('price')} placeholder="350" />
            {fieldErrors.price && <small style={{ color: 'var(--red)' }}>{fieldErrors.price}</small>}
          </div>
          <div className="field">
            <label>Was (₹) <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <input type="number" min="0" value={form.compareAtPrice} onChange={set('compareAtPrice')} placeholder="450" />
            {fieldErrors.compareAtPrice && <small style={{ color: 'var(--red)' }}>{fieldErrors.compareAtPrice}</small>}
          </div>
        </div>
        <div className="frow">
          <div className="field">
            <label>Stock on hand</label>
            <input type="number" min="0" value={form.stock} onChange={set('stock')} placeholder="40" />
            {fieldErrors.stock && <small style={{ color: 'var(--red)' }}>{fieldErrors.stock}</small>}
          </div>
          <div className="field">
            <label>Warn me below</label>
            <input type="number" min="0" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <textarea rows={3} value={form.description} onChange={set('description')}
            placeholder="What makes this plant worth buying, and how it arrives."
            style={{ width: '100%', padding: '11px 13px', border: '1.5px solid var(--border)',
              borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }} />
        </div>
        <div className="frow">
          <div className="field"><label>Light</label>
            <input value={form.careLight} onChange={set('careLight')} placeholder="Bright indirect" /></div>
          <div className="field"><label>Water</label>
            <input value={form.careWater} onChange={set('careWater')} placeholder="Weekly" /></div>
          <div className="field"><label>Pet safety</label>
            <input value={form.careSafety} onChange={set('careSafety')} placeholder="Non-toxic" /></div>
        </div>

        {error && (
          <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '10px 13px',
            borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        <button className="cta-full" onClick={submit}
          disabled={busy || !form.name || !form.price || !form.sku || !form.stock}>
          {busy ? 'Submitting…' : 'Submit for approval'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

function InventoryTab({ canSell }: { canSell: boolean }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [movements, setMovements] = useState<Array<Record<string, unknown>>>([]);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.seller.inventory();
      setRows(d.inventory);
      setMovements(d.movements);
      setDraft({});
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(productId: string, value: number) {
    try {
      const res = await api.seller.setStock(productId, value);
      toastSuccess(res.message);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
      await load();
    }
  }

  return (
    <>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="ph"><h3>Inventory</h3></div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -6, marginBottom: 14, lineHeight: 1.6 }}>
          <strong>Available</strong> is what shoppers can buy. <strong>Reserved</strong> is held by
          customers currently checking out — you cannot set stock below that figure.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-cart">No products yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Plant</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const id = String(r.productId);
                  const onHand = Number(r.onHand);
                  const value = draft[id] ?? onHand;
                  return (
                    <tr key={id}>
                      <td>
                        {r.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img className="rthumb" src={String(r.imageUrl)} alt="" />
                        ) : null}
                        {String(r.name)}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{String(r.sku)}</td>
                      <td>
                        <input
                          className={`sinp ${Boolean(r.isLow) ? 'low' : ''}`}
                          type="number"
                          min={Number(r.reserved)}
                          value={value}
                          disabled={!canSell}
                          onChange={(e) => setDraft((d) => ({ ...d, [id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                          onBlur={() => { if (value !== onHand) void save(id, value); }}
                        />
                      </td>
                      <td style={{ color: Number(r.reserved) > 0 ? 'var(--orange)' : 'var(--text-muted)' }}>
                        {Number(r.reserved)}
                      </td>
                      <td style={{ fontWeight: 700,
                        color: Number(r.available) === 0 ? 'var(--red)' : Boolean(r.isLow) ? 'var(--orange)' : 'var(--green)' }}>
                        {Number(r.available)}
                      </td>
                      <td><StatusPill status={String(r.status)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="ph"><h3>Stock movement history</h3></div>
        {movements.length === 0 ? (
          <div className="empty-cart">No movements recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>When</th><th>Plant</th><th>Reason</th><th>Change</th><th>After</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={String(m.id)}>
                    <td style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{dateTime(m.createdAt as string)}</td>
                    <td>{String(m.productName)}</td>
                    <td style={{ fontSize: 12 }}>{humanise(String(m.reason))}</td>
                    <td style={{ fontWeight: 600,
                      color: Number(m.delta) > 0 ? 'var(--green)' : Number(m.delta) < 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                      {Number(m.delta) > 0 ? '+' : ''}{Number(m.delta)}
                      {Number(m.reservedDelta) !== 0 && (
                        <span style={{ color: 'var(--orange)', fontWeight: 400, fontSize: 11 }}>
                          {' '}(reserved {Number(m.reservedDelta) > 0 ? '+' : ''}{Number(m.reservedDelta)})
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {Number(m.onHandAfter)} on hand, {Number(m.reservedAfter)} reserved
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
// Orders
// ---------------------------------------------------------------------------

function OrdersTab({ canSell, onChanged }: { canSell: boolean; onChanged: () => void }) {
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [counts, setCounts] = useState<Array<{ status: string; count: number }>>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [courierFor, setCourierFor] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.seller.orders(filter ? { status: filter } : undefined);
      setOrders(d.orders);
      setCounts(d.statusCounts);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function advance(order: Record<string, unknown>) {
    const next = order.nextAction as { to: string; label: string } | null;
    if (!next) return;

    // Dispatching needs courier details, so collect them first.
    if (next.to === 'SHIPPED') {
      setCourierFor(order);
      return;
    }

    setBusyId(String(order.id));
    try {
      const res = await api.seller.transition(String(order.id), { to: next.to });
      toastSuccess(res.message);
      await load();
      onChanged();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="panel">
        <div className="ph">
          <h3>Orders for your plants</h3>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}>
            <option value="">All statuses</option>
            {counts.map((c) => (
              <option key={c.status} value={c.status}>{humanise(c.status)} ({c.count})</option>
            ))}
          </select>
        </div>

        {!canSell && (
          <div style={{ background: 'var(--cream)', padding: '14px 16px', borderRadius: 'var(--radius-sm)',
            fontSize: 13.5, marginBottom: 14 }}>
            Orders will appear here once your account is approved and your plants are live.
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-cart">
            📦<br />No orders{filter ? ` with status “${humanise(filter)}”` : ' yet'}.
          </div>
        ) : (
          orders.map((o) => {
            const money_ = (o.money ?? {}) as Record<string, number>;
            const shipTo = (o.shipTo ?? {}) as Record<string, string>;
            const items = (o.items ?? []) as Array<Record<string, unknown>>;
            const next = o.nextAction as { to: string; label: string } | null;
            const busy = busyId === String(o.id);

            return (
              <div key={String(o.id)} style={{ border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div>
                    <strong style={{ color: 'var(--forest)', fontSize: 14.5 }}>{String(o.sellerOrderNumber)}</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      Part of customer order {String(o.customerOrderNumber)} · {dateShort(o.placedAt as string)}
                    </div>
                  </div>
                  <StatusPill status={String(o.status)} />
                </div>

                {/* Items */}
                <div style={{ marginBottom: 10 }}>
                  {items.map((i) => (
                    <div key={String(i.id)} style={{ display: 'flex', gap: 10, alignItems: 'center',
                      fontSize: 12.5, padding: '5px 0' }}>
                      {i.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={String(i.image)} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                      ) : null}
                      <span style={{ flex: 1 }}>
                        {String(i.name)}
                        {Number(i.quantity) > 1 && <strong> ×{Number(i.quantity)}</strong>}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>{money(i.total as number)}</span>
                    </div>
                  ))}
                </div>

                {/* The money split, stated plainly */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', background: 'var(--cream)',
                  padding: '10px 13px', borderRadius: 'var(--radius-sm)', fontSize: 12, marginBottom: 10 }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>Order value </span><strong>{money(money_.gross)}</strong></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Commission ({money_.commissionRate}%) </span>
                    <strong style={{ color: 'var(--red)' }}>−{money(money_.commission)}</strong></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>You earn </span>
                    <strong style={{ color: 'var(--green)' }}>{money(money_.earning)}</strong></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Payout </span>
                    <StatusPill status={String(o.payoutStatus)} /></div>
                </div>

                {/* Ship-to: full address only after acceptance (§5) */}
                <div style={{ fontSize: 12.5, marginBottom: 12, lineHeight: 1.6 }}>
                  <strong>Deliver to:</strong>{' '}
                  {shipTo.fullName ? (
                    <>
                      {shipTo.fullName}, {shipTo.line1}
                      {shipTo.line2 ? `, ${shipTo.line2}` : ''}, {shipTo.city}, {shipTo.state} {shipTo.pincode}
                      {' · 📞 '}{shipTo.phone}
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {shipTo.city}, {shipTo.state} {shipTo.pincode} — full address shown once you accept
                    </span>
                  )}
                </div>

                {o.shipment && (o.shipment as Record<string, unknown>).trackingNumber ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                    🚚 {String((o.shipment as Record<string, unknown>).courier)} ·{' '}
                    {String((o.shipment as Record<string, unknown>).trackingNumber)}
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {next && canSell ? (
                    <button className="btn btn-forest" disabled={busy} onClick={() => void advance(o)}>
                      {busy ? '…' : next.label}
                    </button>
                  ) : null}
                  {!next && (
                    <span style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600, alignSelf: 'center' }}>
                      {o.status === 'DELIVERED' ? '✓ Delivered' : `✓ ${humanise(String(o.status))}`}
                    </span>
                  )}
                  {o.status === 'DELIVERED' && (
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', alignSelf: 'center' }}>
                      Delivery is confirmed by the courier, not by you.
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {courierFor && (
        <CourierModal
          order={courierFor}
          onClose={() => setCourierFor(null)}
          onDone={async () => { setCourierFor(null); await load(); onChanged(); }}
        />
      )}
    </>
  );
}

function CourierModal({
  order,
  onClose,
  onDone,
}: {
  order: Record<string, unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [courier, setCourier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dispatch() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.seller.transition(String(order.id), {
        to: 'SHIPPED',
        courier: courier || undefined,
        trackingNumber: trackingNumber || undefined,
      });
      toastSuccess(res.message);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && onClose()}>
      <div className="mbox" style={{ maxWidth: 440 }}>
        <button className="close-x mclose" onClick={onClose}>✕</button>
        <h2>Dispatch {String(order.sellerOrderNumber)}</h2>
        <p className="msub">
          Add the courier details so the customer can follow this parcel.
        </p>
        <div className="field">
          <label>Courier</label>
          <input value={courier} onChange={(e) => setCourier(e.target.value)}
            placeholder="e.g. Delhivery, BlueDart, India Post" />
        </div>
        <div className="field">
          <label>Tracking / AWB number</label>
          <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="e.g. 1234567890" style={{ fontFamily: 'monospace' }} />
        </div>
        {error && (
          <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '10px 13px',
            borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}
        <button className="cta-full" onClick={dispatch} disabled={busy}>
          {busy ? 'Recording dispatch…' : 'Mark as dispatched'}
        </button>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 10 }}>
          The customer&apos;s tracking page updates immediately.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

function FinanceTab({ canSell }: { canSell: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.seller.finance>> | null>(null);
  const [payouts, setPayouts] = useState<Awaited<ReturnType<typeof api.seller.payouts>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([api.seller.finance(), api.seller.payouts()])
      .then(([f, p]) => { setData(f); setPayouts(p); })
      .catch((err) => toastError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 44, color: 'var(--text-muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading your finances…
      </div>
    );
  }

  if (!canSell || !data) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 44 }}>
        <div style={{ fontSize: 38, marginBottom: 12 }}>💰</div>
        <h3 style={{ color: 'var(--forest)', marginBottom: 8 }}>No earnings yet</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>
          Your sales, commission and payouts will appear here once you start selling.
        </p>
      </div>
    );
  }

  const s = data.summary;

  return (
    <>
      <div className="kpi-row" style={{ marginBottom: 20 }}>
        <div className="kpi"><div className="kl">Gross sales</div><div className="kv">{money(s.grossSales)}</div></div>
        <div className="kpi"><div className="kl">Commission paid</div>
          <div className="kv" style={{ color: 'var(--red)' }}>{money(s.commission)}</div></div>
        <div className="kpi"><div className="kl">Net earnings</div>
          <div className="kv" style={{ color: 'var(--green)' }}>{money(s.netEarnings)}</div></div>
        <div className="kpi"><div className="kl">Ready for payout</div>
          <div className="kv">{money(s.availableForPayout)}</div>
          <div className="kd">{money(s.pendingPayout)} still held</div></div>
      </div>

      {payouts && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="ph"><h3>Payouts</h3></div>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -6, marginBottom: 14, lineHeight: 1.6 }}>
            {payouts.note}
          </p>
          {payouts.payouts.length === 0 ? (
            <div className="empty-cart">No payouts yet. One is created for each parcel you deliver.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Order</th><th>Delivered</th><th>Gross</th><th>Commission</th><th>Net</th><th>Status</th><th>Reference</th></tr>
                </thead>
                <tbody>
                  {payouts.payouts.map((p) => (
                    <tr key={String(p.id)}>
                      <td><b>{String(p.sellerOrderNumber)}</b></td>
                      <td style={{ fontSize: 12 }}>{dateShort(p.deliveredAt as string)}</td>
                      <td>{money(p.gross as number)}</td>
                      <td style={{ color: 'var(--red)' }}>−{money(p.commission as number)}</td>
                      <td><strong>{money(p.net as number)}</strong></td>
                      <td>
                        <StatusPill status={String(p.status)} />
                        {p.status === 'PENDING' && p.eligibleAt ? (
                          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                            from {dateShort(p.eligibleAt as string)}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {p.reference ? String(p.reference) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="ph"><h3>Commission on each order</h3></div>
        {data.commissions.length === 0 ? (
          <div className="empty-cart">No commission records yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Order</th><th>Rate</th><th>Order value</th><th>Commission</th><th>You earn</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.commissions.map((c) => (
                  <tr key={String(c.id)}>
                    <td><b>{String(c.sellerOrderNumber)}</b></td>
                    <td>{Number(c.rate)}%</td>
                    <td>{money(c.gross as number)}</td>
                    <td style={{ color: 'var(--red)' }}>
                      −{money(c.commission as number)}
                      {Number(c.reversed) > 0 && (
                        <div style={{ fontSize: 10.5, color: 'var(--green)' }}>
                          +{money(c.reversed as number)} reversed
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--green)', fontWeight: 600 }}>{money(c.earning as number)}</td>
                    <td><StatusPill status={String(c.status)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.refunds.length > 0 && (
        <div className="panel">
          <div className="ph"><h3>Refunds affecting you</h3></div>
          <table>
            <thead><tr><th>Order</th><th>Refunded</th><th>Commission returned</th><th>Your share</th><th>Status</th></tr></thead>
            <tbody>
              {data.refunds.map((r) => (
                <tr key={String(r.id)}>
                  <td><b>{String(r.sellerOrderNumber ?? '—')}</b></td>
                  <td>{money(r.amount as number)}</td>
                  <td style={{ color: 'var(--green)' }}>+{money(r.commissionReversed as number)}</td>
                  <td style={{ color: 'var(--red)' }}>−{money(r.sellerDebit as number)}</td>
                  <td><StatusPill status={String(r.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

function ReturnsTab({ canSell }: { canSell: boolean }) {
  const [returns, setReturns] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.seller.returns();
      setReturns(d.returns);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    let rejectionReason: string | undefined;
    if (decision === 'REJECT') {
      const reason = window.prompt('Why are you rejecting this return? (the customer sees this)');
      if (!reason || reason.trim().length < 3) return;
      rejectionReason = reason.trim();
    }
    setBusyId(id);
    try {
      const res = await api.seller.decideReturn(id, { decision, rejectionReason, restock: true });
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
      <div className="ph"><h3>Return requests</h3></div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
        </div>
      ) : returns.length === 0 ? (
        <div className="empty-cart">↩️<br />No return requests.</div>
      ) : (
        returns.map((r) => {
          const so = (r.sellerOrder ?? {}) as Record<string, unknown>;
          const items = (r.items ?? []) as Array<Record<string, unknown>>;
          const busy = busyId === String(r.id);
          const pending = r.status === 'REQUESTED';

          return (
            <div key={String(r.id)} style={{ border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <div>
                  <strong style={{ color: 'var(--forest)' }}>{String(r.returnNumber)}</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {String(so.sellerOrderNumber ?? '')} · raised {dateShort(r.createdAt as string)}
                  </div>
                </div>
                <StatusPill status={String(r.status)} />
              </div>

              <div style={{ fontSize: 13, marginBottom: 8 }}>
                <strong>Reason:</strong> {humanise(String(r.reason))}
                {r.description ? (
                  <div style={{ color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.55 }}>
                    &ldquo;{String(r.description)}&rdquo;
                  </div>
                ) : null}
              </div>

              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10 }}>
                {items.map((i) => {
                  const oi = (i.orderItem ?? {}) as Record<string, unknown>;
                  return `${String(oi.productNameSnapshot ?? '')} ×${Number(i.quantity)}`;
                }).join(', ')}
                {' · refund requested '}
                <strong style={{ color: 'var(--text)' }}>{money(r.refundAmount as number)}</strong>
              </div>

              {pending && canSell && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-forest" disabled={busy} onClick={() => void decide(String(r.id), 'APPROVE')}>
                    {busy ? '…' : 'Approve return'}
                  </button>
                  <button className="btn btn-outline" disabled={busy}
                    style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                    onClick={() => void decide(String(r.id), 'REJECT')}>
                    Reject
                  </button>
                </div>
              )}
              {r.status === 'APPROVED' && (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Approved — arrange the pickup. Our team records the refund once the plant is back
                  and inspected.
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
// Profile & KYC
// ---------------------------------------------------------------------------

function ProfileTab() {
  const [seller, setSeller] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api.seller
      .profile()
      .then((d) => setSeller(d.seller))
      .catch((err) => toastError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
      </div>
    );
  }
  if (!seller) return null;

  const kyc = (seller.kyc ?? {}) as Record<string, unknown>;
  const bank = (seller.bankAccount ?? {}) as Record<string, unknown>;
  const documents = (kyc.documents ?? {}) as Record<string, boolean>;

  return (
    <>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="ph"><h3>Store details</h3></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
          gap: 16, fontSize: 13.5 }}>
          {([
            ['Nursery', seller.businessName],
            ['Owner', seller.ownerName],
            ['Email', seller.businessEmail],
            ['Phone', seller.businessPhone],
            ['Location', [seller.city, seller.state, seller.pincode].filter(Boolean).join(', ')],
            ['Storefront', `/sellers/${String(seller.slug)}`],
            ['Account status', humanise(String(seller.status))],
            ['Commission rate', seller.commissionRate != null
              ? `${Number(seller.commissionRate)}% (negotiated)`
              : 'Platform / category default'],
          ] as Array<[string, unknown]>).map(([label, value]) => (
            <div key={label}>
              <b>{label}</b><br />
              <span style={{ color: 'var(--text-muted)', wordBreak: 'break-word' }}>
                {String(value ?? '—')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><h3>Verification &amp; payouts</h3></div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -6, marginBottom: 16, lineHeight: 1.6 }}>
          For your security, identifiers are shown masked. Full numbers are not stored in readable
          form and cannot be displayed — even to you.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
          gap: 16, fontSize: 13.5, marginBottom: 18 }}>
          <div><b>KYC status</b><br /><StatusPill status={String(kyc.verificationStatus ?? 'DRAFT')} /></div>
          <div><b>PAN</b><br /><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {String(kyc.panNumber ?? '— not provided')}</span></div>
          <div><b>GSTIN</b><br /><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {String(kyc.gstNumber ?? '— not provided')}</span></div>
          <div><b>Aadhaar</b><br /><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {kyc.aadhaarLast4 ? `•••• •••• ${String(kyc.aadhaarLast4)}` : '— not provided'}</span></div>
          <div><b>Bank account</b><br /><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {bank.accountLast4 ? `•••••• ${String(bank.accountLast4)}` : '— not provided'}</span></div>
          <div><b>IFSC</b><br /><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {String(bank.ifsc ?? '—')}</span></div>
        </div>

        {kyc.rejectionReason ? (
          <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '11px 14px',
            borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 14 }}>
            <strong>Needs correcting:</strong> {String(kyc.rejectionReason)}
          </div>
        ) : null}

        <div style={{ fontSize: 13 }}>
          <strong style={{ display: 'block', marginBottom: 7 }}>Documents on file</strong>
          {([['pan', 'PAN card'], ['address', 'Address proof'], ['gst', 'GST certificate'],
             ['bank', 'Bank proof']] as Array<[string, string]>).map(([key, label]) => (
            <div key={key} style={{ display: 'flex', gap: 8, marginBottom: 4,
              color: documents[key] ? 'var(--green)' : 'var(--text-muted)' }}>
              <span>{documents[key] ? '✓' : '○'}</span><span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
