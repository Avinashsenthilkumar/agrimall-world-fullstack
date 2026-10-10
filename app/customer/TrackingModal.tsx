// app/customer/TrackingModal.tsx — §16, §17. Separate tracking per seller.
//
// This is the view v1 structurally could not produce. One order, a tab per
// nursery parcel, and inside each a ladder built from the REAL tracking events
// recorded against that parcel's shipment — the courier's scans, not a timer.
'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { type Parcel } from '../../lib/client/api';
import { money, dateTime, dateShort, humanise } from '../../lib/client/format';
import { errorMessage } from '../../lib/client/AppContext';
import StatusPill from '../../components/StatusPill';
import { toastError, toastSuccess } from '../../components/Toast';

export default function TrackingModal({
  orderId,
  onClose,
}: {
  orderId: string | null;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [activeParcel, setActiveParcel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reviewFor, setReviewFor] = useState<{ orderItemId: string; name: string } | null>(null);
  const [rating, setRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      const data = await api.orders.detail(orderId);
      setOrder(data.order);
      setParcels(data.parcels);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    setActiveParcel(0);
    void load();

    // Poll while anything is still moving, so a seller's update appears
    // without the customer refreshing.
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [orderId, load]);

  async function submitReview() {
    if (!reviewFor) return;
    setBusy(true);
    try {
      await api.reviews.create({
        orderItemId: reviewFor.orderItemId,
        rating,
        title: reviewTitle || undefined,
        comment: reviewComment || undefined,
      });
      toastSuccess('Thank you — your review is published.');
      setReviewFor(null);
      setReviewTitle('');
      setReviewComment('');
      setRating(5);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelParcel(parcel: Parcel) {
    const reason = window.prompt(
      `Cancel the parcel from ${parcel.seller.name}?\n\nPlease tell us why (this is sent to the nursery):`,
    );
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await api.orders.cancel(orderId!, reason.trim(), parcel.id);
      toastSuccess(res.message);
      await load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!orderId) return null;

  const parcel = parcels[activeParcel];

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && onClose()}>
      <div className="mbox wide" style={{ maxWidth: 700 }}>
        <button className="close-x mclose" onClick={onClose} aria-label="Close">✕</button>

        {loading && !order && (
          <div style={{ textAlign: 'center', padding: 44, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 14px' }} />
            Loading your order…
          </div>
        )}

        {error && (
          <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '12px 15px',
            borderRadius: 'var(--radius-sm)', fontSize: 13.5 }}>{error}</div>
        )}

        {order && (
          <>
            <h2 style={{ marginBottom: 2 }}>Order {String(order.orderNumber)}</h2>
            <p className="msub" style={{ marginBottom: 14 }}>
              Placed {dateShort(order.createdAt as string)} · {money(order.grandTotal as number)} ·{' '}
              <StatusPill status={String(order.status)} />
            </p>

            {/* Order-level money summary */}
            <div style={{ background: 'var(--cream)', borderRadius: 'var(--radius-sm)', padding: '12px 14px',
              marginBottom: 16, fontSize: 12.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Items</span><span>{money(order.subtotal as number)}</span>
              </div>
              {(order.discount as number) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--green)' }}>
                  <span>Discount{order.couponCode ? ` (${String(order.couponCode)})` : ''}</span>
                  <span>−{money(order.discount as number)}</span>
                </div>
              )}
              {(order.tax as number) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Tax</span><span>{money(order.tax as number)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Shipping</span>
                <span>{(order.shippingFee as number) === 0 ? 'Free' : money(order.shippingFee as number)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700,
                color: 'var(--forest)', paddingTop: 6, marginTop: 6, borderTop: '1px solid var(--border)' }}>
                <span>Total paid</span><span>{money(order.grandTotal as number)}</span>
              </div>
            </div>

            {/* ---- Parcel tabs: one per seller (§16) ---- */}
            {parcels.length > 1 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
                  color: 'var(--text-muted)', marginBottom: 8 }}>
                  {parcels.length} parcels in this order
                </div>
                <div className="pd-tabs" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                  {parcels.map((p, i) => (
                    <div key={p.id} className={`pd-tab ${activeParcel === i ? 'on' : ''}`}
                      onClick={() => setActiveParcel(i)}>
                      {p.seller.name}
                      <span style={{ marginLeft: 6, fontSize: 10.5, opacity: 0.75 }}>
                        {humanise(p.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {parcel && (
              <div key={parcel.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--forest)' }}>
                      🏪 {parcel.seller.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {parcel.sellerOrderNumber}
                      {parcel.seller.location ? ` · ships from ${parcel.seller.location}` : ''}
                    </div>
                  </div>
                  <StatusPill status={parcel.status} />
                </div>

                {/* Courier details, once there are any */}
                {parcel.shipment?.trackingNumber && (
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', background: 'var(--green-light)',
                    borderRadius: 'var(--radius-sm)', padding: '10px 13px', marginBottom: 12, fontSize: 12.5 }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Courier</div>
                      <strong>{parcel.shipment.courier ?? '—'}</strong>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Tracking number</div>
                      <strong style={{ fontFamily: 'monospace' }}>{parcel.shipment.trackingNumber}</strong>
                    </div>
                    {parcel.shipment.estimatedDelivery && (
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                          {parcel.shipment.deliveredAt ? 'Delivered' : 'Expected'}
                        </div>
                        <strong>
                          {dateShort(parcel.shipment.deliveredAt ?? parcel.shipment.estimatedDelivery)}
                        </strong>
                      </div>
                    )}
                  </div>
                )}

                {/* Progress bar for this parcel only */}
                <div className="prog-bar" style={{ marginBottom: 4 }}>
                  <div className="prog-bar-fill" style={{ width: `${parcel.progress}%` }} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'right', marginBottom: 14 }}>
                  {parcel.progress}% of the way
                </div>

                {parcel.status === 'PENDING' && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', background: 'var(--cream)',
                    padding: '10px 13px', borderRadius: 'var(--radius-sm)', marginBottom: 12, lineHeight: 1.55 }}>
                    ⏳ Waiting for {parcel.seller.name} to accept this parcel. Tracking updates as the
                    nursery and courier record each step.
                  </div>
                )}

                {/* The ladder, with real event times */}
                <div className="track-line">
                  {parcel.ladder.map((step) => (
                    <div key={step.status} className={`ti ${step.done || step.current ? 'on' : ''} ${step.current ? 'cur' : ''}`}>
                      <h4>{step.icon} {step.title}</h4>
                      <p>{step.message || step.note}</p>
                      <div className="ttime">
                        {step.at
                          ? `${dateTime(step.at)}${step.location ? ` · ${step.location}` : ''}`
                          : step.current
                            ? 'in progress'
                            : 'pending'}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Items in this parcel, with review buttons (§19) */}
                <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  <h4 style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--forest)', marginBottom: 10 }}>
                    In this parcel
                  </h4>
                  {parcel.items.map((item) => (
                    <div key={item.id} style={{ display: 'flex', gap: 12, alignItems: 'center',
                      marginBottom: 10, flexWrap: 'wrap' }}>
                      {item.image && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.image} alt={item.name}
                          style={{ width: 46, height: 46, borderRadius: 8, objectFit: 'cover' }} />
                      )}
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {item.variant ? `${item.variant} · ` : ''}
                          Qty {item.quantity} · {money(item.unitPrice)} each
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{money(item.total)}</div>
                      {item.reviewable && (
                        <button className="btn btn-outline" style={{ padding: '5px 11px', fontSize: 12 }}
                          onClick={() => setReviewFor({ orderItemId: item.id, name: item.name })}>
                          ★ Review
                        </button>
                      )}
                      {item.reviewed && (
                        <span style={{ fontSize: 11.5, color: 'var(--green)', fontWeight: 600 }}>✓ Reviewed</span>
                      )}
                    </div>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5,
                    paddingTop: 10, borderTop: '1px solid var(--border)', marginTop: 4 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Parcel total</span>
                    <strong>{money(parcel.totals.total)}</strong>
                  </div>
                </div>

                {/* Actions available on this parcel */}
                <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                  {parcel.cancellable && (
                    <button className="btn btn-outline" disabled={busy} onClick={() => void cancelParcel(parcel)}
                      style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
                      Cancel this parcel
                    </button>
                  )}
                  {parcel.returns.length > 0 && (
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)', alignSelf: 'center' }}>
                      Return {parcel.returns[0].returnNumber}: {humanise(parcel.returns[0].status)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Review composer */}
            {reviewFor && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                onClick={(e) => e.target === e.currentTarget && setReviewFor(null)}>
                <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', padding: 24,
                  maxWidth: 420, width: '100%' }}>
                  <h3 style={{ color: 'var(--forest)', marginBottom: 4, fontSize: 17 }}>
                    Review {reviewFor.name}
                  </h3>
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14 }}>
                    You can review this because it was delivered to you.
                  </p>

                  <div style={{ display: 'flex', gap: 6, marginBottom: 14, fontSize: 28 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} role="button" aria-label={`${n} star`} style={{ cursor: 'pointer',
                        color: n <= rating ? 'var(--gold)' : 'var(--border)', lineHeight: 1 }}
                        onClick={() => setRating(n)}>
                        ★
                      </span>
                    ))}
                  </div>

                  <div className="field">
                    <label>Headline <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                    <input value={reviewTitle} onChange={(e) => setReviewTitle(e.target.value)}
                      placeholder="e.g. Arrived in perfect condition" />
                  </div>
                  <div className="field">
                    <label>Your review <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                    <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)}
                      rows={4} placeholder="How was the plant when it arrived? How is it doing now?"
                      style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--border)',
                        borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }} />
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-outline" onClick={() => setReviewFor(null)}>Cancel</button>
                    <button className="btn btn-forest" style={{ flex: 1 }} onClick={submitReview} disabled={busy}>
                      {busy ? 'Publishing…' : 'Publish review'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
