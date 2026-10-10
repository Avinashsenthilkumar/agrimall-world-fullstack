// app/logistics/page.tsx — §2, §17. The courier's scan console.
//
// This replaces v1's "Regional Vendor" page, which could advance any order in
// a region with no authentication at all. Here a LOGISTICS (or ADMIN) session
// is required, and each action records a real tracking event against one
// seller's shipment — which is what the customer's tracking page reads.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LeafParticles from '../../components/LeafParticles';
import StatusPill from '../../components/StatusPill';
import { toastError, toastSuccess } from '../../components/Toast';
import api from '../../lib/client/api';
import { useApp, errorMessage } from '../../lib/client/AppContext';
import { dateShort, humanise } from '../../lib/client/format';

// What a courier can record, and what each scan means.
const SCANS: Array<{ event: string; label: string; from: string[] }> = [
  { event: 'PICKED_UP', label: 'Collected from nursery', from: ['READY_FOR_PICKUP'] },
  { event: 'IN_TRANSIT', label: 'In transit', from: ['PICKED_UP', 'ARRIVED_AT_HUB', 'OUT_FOR_DELIVERY'] },
  { event: 'ARRIVED_AT_HUB', label: 'Arrived at hub', from: ['IN_TRANSIT', 'PICKED_UP'] },
  { event: 'OUT_FOR_DELIVERY', label: 'Out for delivery', from: ['IN_TRANSIT', 'ARRIVED_AT_HUB'] },
  { event: 'DELIVERED', label: 'Delivered', from: ['OUT_FOR_DELIVERY', 'IN_TRANSIT'] },
  { event: 'DELIVERY_FAILED', label: 'Delivery attempt failed', from: ['OUT_FOR_DELIVERY'] },
];

export default function LogisticsPage() {
  const router = useRouter();
  const { user, authLoading, logout } = useApp();

  const [shipments, setShipments] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login?next=/logistics');
      return;
    }
    if (user.role !== 'LOGISTICS' && user.role !== 'ADMIN') {
      router.replace(user.role === 'SELLER' ? '/seller/dashboard' : '/customer');
    }
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.logistics.shipments(filter || undefined);
      setShipments(d.shipments);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (user && (user.role === 'LOGISTICS' || user.role === 'ADMIN')) void load();
  }, [user, load]);

  async function scan(shipmentId: string, event: string) {
    const location = window.prompt('Where is this scan happening? (e.g. Chennai hub)') ?? undefined;
    if (location === undefined) return;

    setBusyId(shipmentId);
    try {
      const res = await api.logistics.scan(shipmentId, { event, location: location || undefined });
      toastSuccess(res.message ?? `Recorded ${humanise(event)}`);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh',
        flexDirection: 'column', gap: 14, color: 'var(--text-muted)' }}>
        <div className="spinner" />Checking your access…
      </div>
    );
  }

  return (
    <>
      <LeafParticles />
      <div className="dash-shell">
        <div className="dsb">
          <div className="dsb-logo"><div className="icon">🚚</div><div className="name">Agri Mall</div></div>
          <div className="dsb-sub">Logistics · courier scans</div>
          <div className="dnav">
            {([['', 'All active'], ['READY_FOR_PICKUP', 'Awaiting pickup'], ['PICKED_UP', 'Collected'],
               ['IN_TRANSIT', 'In transit'], ['OUT_FOR_DELIVERY', 'Out for delivery'],
               ['DELIVERED', 'Delivered']] as Array<[string, string]>).map(([value, label]) => (
              <div key={label} className={`si ${filter === value ? 'on' : ''}`} onClick={() => setFilter(value)}>
                {label}
              </div>
            ))}
          </div>
          <div className="dexit" onClick={async () => { await logout(); router.push('/'); }}>⏎ Sign out</div>
        </div>

        <div className="dmain">
          <div className="dash-topbar">
            <div>
              <h2>Shipment scans</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Each scan writes a tracking event the customer sees immediately
              </p>
            </div>
            <div className="dash-topbar-right"><span className="rbadge">{user.role}</span></div>
          </div>

          <div className="dash-body">
            <div className="panel">
              <div className="ph">
                <h3>{filter ? humanise(filter) : 'Active shipments'}</h3>
                <button className="btn btn-outline" style={{ padding: '5px 12px', fontSize: 12 }}
                  onClick={() => void load()}>Refresh</button>
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
                </div>
              ) : shipments.length === 0 ? (
                <div className="empty-cart">
                  🚚<br />No shipments{filter ? ` ${humanise(filter).toLowerCase()}` : ' to handle'}.
                </div>
              ) : (
                shipments.map((s) => {
                  const pickup = (s.pickup ?? {}) as Record<string, string>;
                  const deliverTo = (s.deliverTo ?? {}) as Record<string, string>;
                  const lastEvent = s.lastEvent as Record<string, unknown> | null;
                  const current = String(s.shipmentStatus);
                  const available = SCANS.filter((sc) => sc.from.includes(current));
                  const busy = busyId === String(s.id);

                  return (
                    <div key={String(s.id)} style={{ border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                        gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                        <div>
                          <strong style={{ color: 'var(--forest)', fontSize: 14.5 }}>
                            {String(s.sellerOrderNumber)}
                          </strong>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            Customer order {String(s.customerOrderNumber)}
                            {s.trackingNumber ? ` · AWB ${String(s.trackingNumber)}` : ''}
                            {s.courier ? ` · ${String(s.courier)}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <StatusPill status={current} />
                          <StatusPill status={String(s.orderStatus)} />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
                        gap: 14, fontSize: 12.5, marginBottom: 12 }}>
                        <div style={{ background: 'var(--cream)', padding: '10px 12px', borderRadius: 'var(--radius-sm)' }}>
                          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.4px',
                            color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>Collect from</div>
                          <strong>{pickup.name}</strong><br />
                          {pickup.location}<br />
                          📞 {pickup.phone}
                        </div>
                        <div style={{ background: 'var(--green-light)', padding: '10px 12px', borderRadius: 'var(--radius-sm)' }}>
                          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.4px',
                            color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>Deliver to</div>
                          <strong>{deliverTo.name}</strong><br />
                          {deliverTo.line1}{deliverTo.line2 ? `, ${deliverTo.line2}` : ''}<br />
                          {deliverTo.city}, {deliverTo.state} {deliverTo.pincode}<br />
                          📞 {deliverTo.phone}
                        </div>
                      </div>

                      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10 }}>
                        📦 {String(s.contents)}
                        {s.estimatedDelivery ? ` · expected ${dateShort(s.estimatedDelivery as string)}` : ''}
                      </div>

                      {lastEvent ? (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>
                          Last scan: {humanise(String(lastEvent.status))}
                          {lastEvent.location ? ` at ${String(lastEvent.location)}` : ''}
                        </div>
                      ) : null}

                      {available.length > 0 ? (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {available.map((sc) => (
                            <button key={sc.event}
                              className={sc.event === 'DELIVERY_FAILED' ? 'btn btn-outline' : 'btn btn-forest'}
                              style={sc.event === 'DELIVERY_FAILED'
                                ? { color: 'var(--red)', borderColor: 'var(--red)', fontSize: 12.5, padding: '6px 12px' }
                                : { fontSize: 12.5, padding: '6px 12px' }}
                              disabled={busy}
                              onClick={() => void scan(String(s.id), sc.event)}>
                              {busy ? '…' : sc.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                          {current === 'PENDING'
                            ? 'Waiting for the nursery to mark this ready for pickup.'
                            : current === 'DELIVERED'
                              ? '✓ Delivered — nothing further to scan.'
                              : 'No scan available from this state.'}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
