// app/customer/CartDrawer.tsx — §9. THE multi-seller cart.
//
// This is the UI that makes the marketplace legible to a shopper: the basket
// is grouped by nursery, each group shows its own subtotal and shipping, and
// the summary states plainly how many parcels will arrive.
//
// Every figure shown here came from the server's pricing engine. The component
// does no arithmetic on money beyond dividing by 100 to display rupees.
'use client';

import { useState } from 'react';
import { useApp, errorMessage } from '../../lib/client/AppContext';
import { money, discountPercent } from '../../lib/client/format';
import { toastError } from '../../components/Toast';

export default function CartDrawer({
  open,
  onClose,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const { cartGroups, cartTotals, cartIssues, cartLoading, setCartQuantity, removeFromCart } = useApp();
  const [busyItem, setBusyItem] = useState<string | null>(null);

  async function changeQty(cartItemId: string, quantity: number) {
    setBusyItem(cartItemId);
    try {
      await setCartQuantity(cartItemId, quantity);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyItem(null);
    }
  }

  async function remove(cartItemId: string) {
    setBusyItem(cartItemId);
    try {
      await removeFromCart(cartItemId);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyItem(null);
    }
  }

  const isEmpty = !cartLoading && cartGroups.length === 0;

  return (
    <div className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="drawer-head">
        <h3>
          Your Cart
          {cartTotals && cartTotals.itemCount > 0 && (
            <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>
              {cartTotals.itemCount} item{cartTotals.itemCount === 1 ? '' : 's'}
            </span>
          )}
        </h3>
        <button className="close-x" onClick={onClose} aria-label="Close cart">✕</button>
      </div>

      <div className="drawer-body">
        {cartLoading && cartGroups.length === 0 && (
          <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Loading your cart…
          </div>
        )}

        {isEmpty && (
          <div className="empty-cart">
            🌱
            <br />
            Your cart is empty.
            <br />
            Add some plants to get started.
          </div>
        )}

        {/* Items that can no longer be bought, explained rather than hidden. */}
        {cartIssues.length > 0 && (
          <div
            style={{
              background: '#FFF8E8',
              border: '1px solid #F0D9A0',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            <strong style={{ color: 'var(--orange)' }}>Some items need your attention</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-mid)' }}>
              {cartIssues.map((issue) => (
                <li key={issue.cartItemId} style={{ marginBottom: 3 }}>
                  {issue.productName} — {issue.problem}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- Grouped by seller: the heart of the multi-vendor basket ---- */}
        {cartGroups.map((group, gi) => (
          <div key={group.seller.id} style={{ marginBottom: 22 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                paddingBottom: 8,
                marginBottom: 10,
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 15 }}>🏪</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--forest)' }}>
                  {group.seller.businessName}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Parcel {gi + 1} of {cartGroups.length} · ships separately
                </div>
              </div>
            </div>

            {group.lines.map((line) => {
              const off = discountPercent(line.unitPrice, line.compareAtPrice);
              const busy = busyItem === line.cartItemId;
              return (
                <div className="cart-item" key={line.cartItemId ?? line.productId} style={{ opacity: busy ? 0.55 : 1 }}>
                  <div className="cart-thumb">
                    {line.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={line.imageUrl} alt={line.name} loading="lazy" />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: 'var(--cream)' }} />
                    )}
                  </div>
                  <div className="cart-info" style={{ flex: 1, minWidth: 0 }}>
                    <div className="cn">{line.name}</div>
                    <div className="cp">
                      {money(line.unitPrice)}
                      {line.compareAtPrice && off ? (
                        <>
                          {' '}
                          <s style={{ opacity: 0.6 }}>{money(line.compareAtPrice)}</s>{' '}
                          <span style={{ color: 'var(--orange)', fontWeight: 600 }}>{off}% off</span>
                        </>
                      ) : null}
                      {line.variantLabel ? ` · ${line.variantLabel}` : ''}
                    </div>

                    <div className="qty-ctrl">
                      <button
                        disabled={busy}
                        aria-label="Decrease quantity"
                        onClick={() => changeQty(line.cartItemId!, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button
                        disabled={busy}
                        aria-label="Increase quantity"
                        onClick={() => changeQty(line.cartItemId!, line.quantity + 1)}
                      >
                        +
                      </button>
                      <button className="rm-btn" disabled={busy} onClick={() => remove(line.cartItemId!)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--forest)', whiteSpace: 'nowrap' }}>
                    {money(line.lineTotal)}
                  </div>
                </div>
              );
            })}

            {/* Per-seller subtotal, exactly as the server computed it. */}
            <div
              style={{
                background: 'var(--cream)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                fontSize: 12.5,
                marginTop: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: 'var(--text-muted)' }}>Items</span>
                <span>{money(group.subtotal)}</span>
              </div>
              {group.discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: 'var(--green)' }}>
                  <span>Discount</span>
                  <span>−{money(group.discount)}</span>
                </div>
              )}
              {group.tax > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Tax</span>
                  <span>{money(group.tax)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: 'var(--text-muted)' }}>Shipping</span>
                <span style={{ color: group.shippingFee === 0 ? 'var(--green)' : undefined, fontWeight: 600 }}>
                  {group.shippingFee === 0 ? 'Free' : money(group.shippingFee)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 700,
                  color: 'var(--forest)',
                  paddingTop: 6,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <span>Parcel subtotal</span>
                <span>{money(group.total)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {cartTotals && cartGroups.length > 0 && (
        <div className="drawer-foot">
          {cartGroups.length > 1 && (
            <div
              style={{
                background: 'var(--green-light)',
                color: 'var(--green)',
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12.5,
                marginBottom: 12,
                lineHeight: 1.5,
              }}
            >
              📦 You are buying from <strong>{cartTotals.sellerCount} nurseries</strong>. You pay once,
              and {cartTotals.sellerCount} parcels arrive — each with its own tracking.
            </div>
          )}

          <div className="sum-row">
            <span>Subtotal</span>
            <span>{money(cartTotals.subtotal)}</span>
          </div>
          {cartTotals.discount > 0 && (
            <div className="sum-row" style={{ color: 'var(--green)' }}>
              <span>Discount</span>
              <span>−{money(cartTotals.discount)}</span>
            </div>
          )}
          {cartTotals.tax > 0 && (
            <div className="sum-row">
              <span>Tax</span>
              <span>{money(cartTotals.tax)}</span>
            </div>
          )}
          <div className="sum-row">
            <span>Shipping{cartGroups.length > 1 ? ` (${cartGroups.length} parcels)` : ''}</span>
            <span>{cartTotals.shippingFee === 0 ? 'Free' : money(cartTotals.shippingFee)}</span>
          </div>
          <div className="sum-row total">
            <span>Total</span>
            <span>{money(cartTotals.grandTotal)}</span>
          </div>

          <button className="cta-full" onClick={onCheckout}>
            Proceed to Checkout
          </button>
        </div>
      )}
    </div>
  );
}
