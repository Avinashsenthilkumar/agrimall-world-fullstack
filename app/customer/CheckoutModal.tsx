// app/customer/CheckoutModal.tsx — §9, §10, §14. Real checkout.
//
// What this component sends to the server:
//     { items: [{ productId, quantity }], addressId, couponCode, paymentMethod }
//
// What it does NOT send: any price, any total, any sellerId. It cannot — the
// server's schema rejects those fields outright. The total shown is whatever
// /api/cart/quote returned, and the amount charged is recomputed server-side
// at the moment the order is created.
//
// Payment: for an online method we hand off to the provider's widget. We then
// poll /api/payments/verify, which reports the order's REAL state as recorded
// by the signed webhook. There is no path here that can declare success.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp, errorMessage, ApiClientError } from '../../lib/client/AppContext';
import api from '../../lib/client/api';
import { money } from '../../lib/client/format';
import { toastError, toastSuccess } from '../../components/Toast';

type Step = 'ADDRESS' | 'REVIEW' | 'PAYING' | 'CONFIRMING' | 'DONE' | 'FAILED';

interface Address {
  id: string;
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export default function CheckoutModal({
  open,
  onClose,
  onOrderPlaced,
}: {
  open: boolean;
  onClose: () => void;
  onOrderPlaced: (orderId: string) => void;
}) {
  const { user, cartGroups, cartTotals, checkoutItems, refreshCart } = useApp();

  const [step, setStep] = useState<Step>('ADDRESS');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<string>('');
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({
    fullName: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '', country: 'India',
  });

  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [quotedTotals, setQuotedTotals] = useState<{
    subtotal: number; discount: number; tax: number; shippingFee: number; grandTotal: number;
  } | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<'RAZORPAY' | 'COD'>('COD');
  const [onlineAvailable, setOnlineAvailable] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [placedOrder, setPlacedOrder] = useState<{ id: string; number: string; total: number; parcels: number } | null>(null);
  const [confirmMessage, setConfirmMessage] = useState('');

  // One key per modal opening, so a double-click cannot create two orders.
  const idempotencyKey = useMemo(
    () => (open ? `co_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` : ''),
    [open],
  );

  const items = checkoutItems();
  const totals = quotedTotals ?? cartTotals;

  // --- load addresses and payment capability on open ----------------------
  useEffect(() => {
    if (!open) return;
    setStep('ADDRESS');
    setError(null);
    setPlacedOrder(null);

    void (async () => {
      try {
        const [addrRes, health] = await Promise.all([
          api.addresses.list(),
          api.health().catch(() => null),
        ]);
        const list = addrRes.addresses as unknown as Address[];
        setAddresses(list);
        const preferred = list.find((a) => a.isDefault) ?? list[0];
        if (preferred) setAddressId(preferred.id);
        else setShowNewAddress(true);

        // Honest about whether online payment is actually configured (§1399).
        const configured = Boolean(health?.config?.onlinePaymentConfigured);
        setOnlineAvailable(configured);
        setPaymentMethod(configured ? 'RAZORPAY' : 'COD');
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [open]);

  // --- re-quote whenever the coupon changes -------------------------------
  const requote = useCallback(
    async (code?: string) => {
      if (items.length === 0) return;
      try {
        const res = await api.cart.quote(items, code);
        setQuotedTotals(res.totals);
        setAppliedCoupon(res.couponApplied);
        setCouponError(res.couponError);
        if (res.couponApplied) toastSuccess(`Coupon ${res.couponApplied} applied`);
      } catch (err) {
        setCouponError(errorMessage(err));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(items)],
  );

  async function saveAddress() {
    setBusy(true);
    setFieldErrors({});
    try {
      const created = await api.addresses.create({ ...newAddress, isDefault: addresses.length === 0 });
      const addr = created.address as unknown as Address;
      setAddresses((a) => [...a, addr]);
      setAddressId(addr.id);
      setShowNewAddress(false);
      toastSuccess('Address saved');
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) flat[k] = v[0];
        setFieldErrors(flat);
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function goToReview() {
    if (!addressId) {
      setError('Please choose or add a delivery address.');
      return;
    }
    setError(null);
    setStep('REVIEW');
    void requote(appliedCoupon ?? undefined);
  }

  // --- place the order ----------------------------------------------------
  async function placeOrder() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.checkout.submit({
        items,
        addressId,
        billingSameAsShipping: true,
        couponCode: appliedCoupon ?? undefined,
        customerNote: note || undefined,
        paymentMethod,
        idempotencyKey,
      });

      setPlacedOrder({
        id: result.orderId,
        number: result.orderNumber,
        total: result.grandTotal,
        parcels: result.sellerOrders.length,
      });

      // Cash on delivery: the server already confirmed it through the same
      // verified path an online payment uses.
      if (!result.requiresPayment) {
        await refreshCart();
        setConfirmMessage(
          `Order ${result.orderNumber} is confirmed. You will pay ${money(result.grandTotal)} on delivery.`,
        );
        setStep('DONE');
        return;
      }

      // Online: open the provider's widget.
      setStep('PAYING');
      await openPaymentWidget(result);
    } catch (err) {
      setError(errorMessage(err));
      setStep('REVIEW');
    } finally {
      setBusy(false);
    }
  }

  async function openPaymentWidget(result: {
    orderId: string;
    orderNumber: string;
    grandTotal: number;
    payment?: { provider: string; providerOrderId: string; publicKey: string; amount: number; currency: string };
  }) {
    const payment = result.payment;
    if (!payment) {
      setError('The payment could not be started. Please try again from My Orders.');
      setStep('FAILED');
      return;
    }

    if (payment.provider === 'RAZORPAY') {
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        setError(
          'The payment window could not load. Your order is saved — you can pay for it from My Orders.',
        );
        setStep('FAILED');
        return;
      }

      const rzp = new window.Razorpay({
        key: payment.publicKey,
        // The amount comes from the server, not from this component.
        amount: payment.amount,
        currency: payment.currency,
        name: 'Agri Mall',
        description: `Order ${result.orderNumber}`,
        order_id: payment.providerOrderId,
        prefill: { name: user?.name ?? '', email: user?.email ?? '' },
        theme: { color: '#1C3829' },
        handler: (response: Record<string, string>) => {
          // NOTE: we do not treat this callback as proof of payment. We ask
          // the server, which only trusts its signed webhook.
          void confirmWithServer(result.orderId, response);
        },
        modal: {
          ondismiss: () => {
            setStep('FAILED');
            setError(
              'The payment window was closed. Your order is saved and unpaid — you can complete it from My Orders.',
            );
          },
        },
      });
      rzp.open();
    } else {
      setError('This deployment is configured for a payment provider that the UI does not yet handle.');
      setStep('FAILED');
    }
  }

  /**
   * Ask the server what actually happened. Polls briefly, because the webhook
   * and the browser redirect race each other — the webhook is authoritative
   * but may land a second or two later.
   */
  async function confirmWithServer(orderId: string, response: Record<string, string>) {
    setStep('CONFIRMING');
    const payload = {
      orderId,
      razorpayOrderId: response.razorpay_order_id,
      razorpayPaymentId: response.razorpay_payment_id,
      signature: response.razorpay_signature,
    };

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await api.checkout.verify(payload);
        if (res.state === 'CONFIRMED') {
          await refreshCart();
          setConfirmMessage(res.message);
          setStep('DONE');
          return;
        }
        if (res.state === 'FAILED') {
          setError(res.message);
          setStep('FAILED');
          return;
        }
        setConfirmMessage(res.message);
      } catch {
        /* keep polling */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Still not confirmed: say so truthfully rather than claiming success.
    await refreshCart();
    setConfirmMessage(
      'Your payment is being confirmed with the gateway. This can take a minute — your order will appear under My Orders as soon as it clears.',
    );
    setStep('DONE');
  }

  if (!open) return null;

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && step !== 'CONFIRMING' && onClose()}>
      <div className="mbox" style={{ maxWidth: 560 }}>
        {step !== 'CONFIRMING' && (
          <button className="close-x mclose" onClick={onClose} aria-label="Close">✕</button>
        )}

        {/* ---------------- ADDRESS ---------------- */}
        {step === 'ADDRESS' && (
          <>
            <h2>Delivery address</h2>
            <p className="msub">Where should your {cartGroups.length > 1 ? 'parcels' : 'parcel'} go?</p>

            {addresses.length > 0 && !showNewAddress && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {addresses.map((a) => (
                  <label
                    key={a.id}
                    style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer',
                      border: `1.5px solid ${addressId === a.id ? 'var(--forest)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-sm)', padding: '12px 14px',
                      background: addressId === a.id ? 'var(--green-light)' : '#fff',
                    }}
                  >
                    <input type="radio" name="addr" checked={addressId === a.id}
                      onChange={() => setAddressId(a.id)} style={{ marginTop: 3 }} />
                    <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                      <strong>{a.fullName}</strong>
                      {a.label ? <span style={{ color: 'var(--text-muted)' }}> · {a.label}</span> : null}
                      {a.isDefault && (
                        <span style={{ marginLeft: 6, fontSize: 10.5, background: 'var(--green)', color: '#fff',
                          padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>DEFAULT</span>
                      )}
                      <div style={{ color: 'var(--text-muted)' }}>
                        {a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />
                        {a.city}, {a.state} {a.pincode}<br />
                        📞 {a.phone}
                      </div>
                    </div>
                  </label>
                ))}
                <button className="btn btn-outline" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setShowNewAddress(true)}>
                  + Add a different address
                </button>
              </div>
            )}

            {showNewAddress && (
              <div style={{ marginBottom: 16 }}>
                <div className="field">
                  <label>Full name</label>
                  <input value={newAddress.fullName}
                    onChange={(e) => setNewAddress({ ...newAddress, fullName: e.target.value })}
                    placeholder="e.g. Anjali Menon" />
                  {fieldErrors.fullName && <small style={{ color: 'var(--red)' }}>{fieldErrors.fullName}</small>}
                </div>
                <div className="frow">
                  <div className="field">
                    <label>Mobile number</label>
                    <input inputMode="numeric" value={newAddress.phone}
                      onChange={(e) => setNewAddress({ ...newAddress, phone: e.target.value })}
                      placeholder="98400 11223" />
                    {fieldErrors.phone && <small style={{ color: 'var(--red)' }}>{fieldErrors.phone}</small>}
                  </div>
                  <div className="field">
                    <label>PIN code</label>
                    <input inputMode="numeric" maxLength={6} value={newAddress.pincode}
                      onChange={(e) => setNewAddress({ ...newAddress, pincode: e.target.value })}
                      placeholder="682031" />
                    {fieldErrors.pincode && <small style={{ color: 'var(--red)' }}>{fieldErrors.pincode}</small>}
                  </div>
                </div>
                <div className="field">
                  <label>Address</label>
                  <input value={newAddress.line1}
                    onChange={(e) => setNewAddress({ ...newAddress, line1: e.target.value })}
                    placeholder="Flat / house, street" />
                  {fieldErrors.line1 && <small style={{ color: 'var(--red)' }}>{fieldErrors.line1}</small>}
                </div>
                <div className="field">
                  <label>Landmark / area <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                  <input value={newAddress.line2}
                    onChange={(e) => setNewAddress({ ...newAddress, line2: e.target.value })} />
                </div>
                <div className="frow">
                  <div className="field">
                    <label>City</label>
                    <input value={newAddress.city}
                      onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })} placeholder="Kochi" />
                    {fieldErrors.city && <small style={{ color: 'var(--red)' }}>{fieldErrors.city}</small>}
                  </div>
                  <div className="field">
                    <label>State</label>
                    <input value={newAddress.state}
                      onChange={(e) => setNewAddress({ ...newAddress, state: e.target.value })} placeholder="Kerala" />
                    {fieldErrors.state && <small style={{ color: 'var(--red)' }}>{fieldErrors.state}</small>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-forest" onClick={saveAddress} disabled={busy}>
                    {busy ? 'Saving…' : 'Save address'}
                  </button>
                  {addresses.length > 0 && (
                    <button className="btn btn-outline" onClick={() => setShowNewAddress(false)}>Cancel</button>
                  )}
                </div>
              </div>
            )}

            {error && <ErrorBox message={error} />}

            {!showNewAddress && (
              <button className="cta-full" onClick={goToReview} disabled={!addressId}>
                Continue to review →
              </button>
            )}
          </>
        )}

        {/* ---------------- REVIEW ---------------- */}
        {step === 'REVIEW' && (
          <>
            <h2>Review your order</h2>
            <p className="msub">
              {cartGroups.length === 1
                ? 'One parcel from one nursery.'
                : `${cartGroups.length} parcels from ${cartGroups.length} nurseries — you pay once.`}
            </p>

            {/* Per-seller summary, so the split is clear before paying. */}
            <div style={{ marginBottom: 16 }}>
              {cartGroups.map((g, i) => (
                <div key={g.seller.id}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                    padding: '10px 12px', background: 'var(--cream)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--forest)' }}>
                      Parcel {i + 1} · {g.seller.businessName}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {g.lines.map((l) => `${l.name}${l.quantity > 1 ? ` ×${l.quantity}` : ''}`).join(', ')}
                    </div>
                  </div>
                  <strong style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>{money(g.total)}</strong>
                </div>
              ))}
            </div>

            {/* Coupon — validated server-side (§20) */}
            <div className="field">
              <label>Coupon code</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  placeholder="e.g. GREEN10" style={{ flex: 1 }} />
                <button className="btn btn-forest" style={{ whiteSpace: 'nowrap' }}
                  onClick={() => void requote(coupon)} disabled={!coupon.trim()}>
                  Apply
                </button>
              </div>
              {appliedCoupon && (
                <small style={{ color: 'var(--green)', fontWeight: 600 }}>
                  ✓ {appliedCoupon} applied
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, cursor: 'pointer', marginLeft: 8 }}
                    onClick={() => { setCoupon(''); setAppliedCoupon(null); void requote(undefined); }}>
                    remove
                  </span>
                </small>
              )}
              {couponError && <small style={{ color: 'var(--red)' }}>{couponError}</small>}
            </div>

            <div className="field">
              <label>Note for the nursery <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
              <input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. please pack the sapling upright" />
            </div>

            {/* Payment method */}
            <div className="pay-tabs">
              {onlineAvailable && (
                <div className={`pay-tab ${paymentMethod === 'RAZORPAY' ? 'on' : ''}`}
                  onClick={() => setPaymentMethod('RAZORPAY')}>
                  💳 Card / UPI / Netbanking
                </div>
              )}
              <div className={`pay-tab ${paymentMethod === 'COD' ? 'on' : ''}`} onClick={() => setPaymentMethod('COD')}>
                💵 Cash on Delivery
              </div>
            </div>

            {!onlineAvailable && (
              <div style={{ background: '#FFF8E8', border: '1px solid #F0D9A0', borderRadius: 'var(--radius-sm)',
                padding: '10px 13px', fontSize: 12.5, marginBottom: 12, lineHeight: 1.55 }}>
                Online payment is not configured on this deployment yet, so only Cash on Delivery is
                available. Add your payment provider keys to enable card, UPI and netbanking.
              </div>
            )}

            {totals && (
              <div style={{ background: 'var(--cream)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', margin: '14px 0' }}>
                <div className="sum-row"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
                {totals.discount > 0 && (
                  <div className="sum-row" style={{ color: 'var(--green)' }}>
                    <span>Discount</span><span>−{money(totals.discount)}</span>
                  </div>
                )}
                {totals.tax > 0 && <div className="sum-row"><span>Tax</span><span>{money(totals.tax)}</span></div>}
                <div className="sum-row">
                  <span>Shipping{cartGroups.length > 1 ? ` · ${cartGroups.length} parcels` : ''}</span>
                  <span>{totals.shippingFee === 0 ? 'Free' : money(totals.shippingFee)}</span>
                </div>
                <div className="sum-row total"><span>Total due</span><span>{money(totals.grandTotal)}</span></div>
              </div>
            )}

            {error && <ErrorBox message={error} />}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" onClick={() => setStep('ADDRESS')}>← Address</button>
              <button className="cta-full" style={{ marginTop: 0 }} onClick={placeOrder} disabled={busy}>
                {busy
                  ? 'Placing your order…'
                  : paymentMethod === 'COD'
                    ? `Place order · ${money(totals?.grandTotal ?? 0)}`
                    : `Pay ${money(totals?.grandTotal ?? 0)}`}
              </button>
            </div>

            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
              The amount is calculated on our server from current prices and stock.
            </p>
          </>
        )}

        {/* ---------------- PAYING / CONFIRMING ---------------- */}
        {(step === 'PAYING' || step === 'CONFIRMING') && (
          <div className="pay-processing">
            <div className="spinner" />
            <p style={{ fontWeight: 600, color: 'var(--forest)' }}>
              {step === 'PAYING' ? 'Waiting for your payment…' : 'Confirming your payment…'}
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 340, lineHeight: 1.6 }}>
              {step === 'PAYING'
                ? 'Complete the payment in the window that opened.'
                : confirmMessage ||
                  'We are checking with the payment gateway. Please do not close this window.'}
            </p>
          </div>
        )}

        {/* ---------------- DONE ---------------- */}
        {step === 'DONE' && placedOrder && (
          <div className="pay-success">
            <div className="check-circle">
              <svg viewBox="0 0 24 24" fill="none" width="34" height="34">
                <path d="M4 12.5L9.5 18L20 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <h3 style={{ color: 'var(--forest)', margin: '0 0 6px' }}>Order {placedOrder.number}</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-mid)', maxWidth: 380, lineHeight: 1.6, margin: '0 auto 8px' }}>
              {confirmMessage}
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 18 }}>
              {money(placedOrder.total)} ·{' '}
              {placedOrder.parcels === 1
                ? '1 parcel'
                : `${placedOrder.parcels} parcels, each tracked separately`}
            </p>
            <button className="cta-full" onClick={() => onOrderPlaced(placedOrder.id)}>
              Track my order →
            </button>
          </div>
        )}

        {/* ---------------- FAILED ---------------- */}
        {step === 'FAILED' && (
          <>
            <h2>Payment not completed</h2>
            <p className="msub">Your order is saved — nothing has been lost.</p>
            {error && <ErrorBox message={error} />}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              {placedOrder && (
                <button
                  className="btn btn-forest"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const retry = await api.checkout.retryPayment(placedOrder.id);
                      setStep('PAYING');
                      await openPaymentWidget({
                        orderId: placedOrder.id,
                        orderNumber: placedOrder.number,
                        grandTotal: placedOrder.total,
                        payment: retry.payment,
                      });
                    } catch (err) {
                      toastError(errorMessage(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  Try paying again
                </button>
              )}
              <button className="btn btn-outline" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '11px 14px',
      borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
      {message}
    </div>
  );
}

/** Loads Razorpay's checkout script once. */
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.Razorpay) return resolve(true);
    const existing = document.getElementById('razorpay-checkout-js');
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.id = 'razorpay-checkout-js';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}
