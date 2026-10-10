// app/customer/page.tsx — the storefront. §25.
//
// v1's design is preserved: the same topbar, hero, category tiles, product
// grid, trust bar, footer, mobile drawer and bottom nav, using the same CSS.
// What changed is where the data comes from — every product, price and stock
// flag is now read from the API, so a seller adding a plant or an admin
// approving one is visible here immediately.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import LeafParticles from '../../components/LeafParticles';
import StatusPill from '../../components/StatusPill';
import { toast, toastError, toastSuccess } from '../../components/Toast';
import api, { type ProductCard } from '../../lib/client/api';
import { useApp, errorMessage } from '../../lib/client/AppContext';
import { money, discountPercent, stars, dateShort, humanise } from '../../lib/client/format';
import { CARE_SYMPTOMS, matchSymptom, type CareSymptom } from '../../lib/client/plant-care';
import CartDrawer from './CartDrawer';
import CheckoutModal from './CheckoutModal';
import TrackingModal from './TrackingModal';

interface Category {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  productCount: number;
}

export default function CustomerPage() {
  const router = useRouter();
  const { user, authLoading, cartItemCount, addToCart, logout } = useApp();

  // --- catalogue state ---------------------------------------------------
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<string>('');
  const [sort, setSort] = useState('popular');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);

  // --- UI state (mirrors v1) --------------------------------------------
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [careOpen, setCareOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);

  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());

  // --- load catalogue ----------------------------------------------------
  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.catalog.products({
        category: category || undefined,
        q: search || undefined,
        sort,
        page,
        perPage: 24,
      });
      setProducts(data.products);
      setPageCount(data.pagination.pages);
      setTotal(data.pagination.total);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [category, search, sort, page]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    void api.catalog
      .categories()
      .then((d) => setCategories(d.categories))
      .catch(() => undefined);
  }, []);

  // Wishlist, for signed-in customers.
  useEffect(() => {
    if (!user || user.role !== 'CUSTOMER') return;
    void api.wishlist
      .list()
      .then((d) => setWishlist(new Set(d.items.map((i) => String(i.productId)))))
      .catch(() => undefined);
  }, [user]);

  // Reveal-on-scroll, as in v1.
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [products]);

  useEffect(() => {
    document.body.classList.add('has-mob-nav');
    return () => document.body.classList.remove('has-mob-nav');
  }, []);

  // --- actions -----------------------------------------------------------
  const requireSignIn = useCallback(
    (action: string) => {
      if (authLoading) return false;
      if (!user) {
        toast(`Please sign in to ${action}.`);
        router.push(`/login?next=${encodeURIComponent('/customer')}`);
        return false;
      }
      if (user.role !== 'CUSTOMER') {
        toast(`You are signed in as a ${user.role.toLowerCase()} account. Shopping needs a customer account.`);
        return false;
      }
      return true;
    },
    [authLoading, user, router],
  );

  async function handleAdd(product: ProductCard, quantity = 1) {
    if (!requireSignIn('add items to your cart')) return;
    try {
      await addToCart(product.id, quantity);
      toastSuccess(`${product.name} added to your cart 🌱`);
      const btn = document.getElementById('cartBtn');
      if (btn) {
        btn.style.transform = 'scale(1.18)';
        setTimeout(() => (btn.style.transform = ''), 260);
      }
    } catch (err) {
      toastError(errorMessage(err));
    }
  }

  async function toggleWishlist(product: ProductCard) {
    if (!requireSignIn('save plants')) return;
    try {
      if (wishlist.has(product.id)) {
        await api.wishlist.remove(product.id);
        setWishlist((s) => {
          const next = new Set(s);
          next.delete(product.id);
          return next;
        });
      } else {
        await api.wishlist.add(product.id);
        setWishlist((s) => new Set(s).add(product.id));
        toastSuccess('Saved to your wishlist');
      }
    } catch (err) {
      toastError(errorMessage(err));
    }
  }

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 70, behavior: 'smooth' });
  }

  const anyOverlay = cartOpen || checkoutOpen || Boolean(trackingOrderId) || careOpen || Boolean(detailSlug);

  return (
    <>
      <LeafParticles />

      {/* MOBILE BOTTOM NAV */}
      <div className="mob-nav">
        <div className="mob-nav-inner">
          <div className="mob-nav-item" onClick={() => scrollTo('shop')}><span>🏠</span>Home</div>
          <div className="mob-nav-item" onClick={() => setSearchOpen(true)}><span>🔍</span>Search</div>
          <div className="mob-nav-item" onClick={() => setCartOpen(true)}>
            <span>🛒</span>Cart{cartItemCount > 0 ? ` (${cartItemCount})` : ''}
          </div>
          <div className="mob-nav-item" onClick={() => setCareOpen(true)}><span>🌿</span>Care</div>
          <div className="mob-nav-item" onClick={() => (user ? setOrdersOpen(true) : router.push('/login'))}>
            <span>👤</span>{user ? 'Orders' : 'Sign in'}
          </div>
        </div>
      </div>

      {/* TOPBAR */}
      <div className="topbar">
        <div className="topbar-logo" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
          Agri Mall
        </div>
        <div className="topbar-nav">
          <span className="active" onClick={() => scrollTo('shop')}>Shop</span>
          <span onClick={() => setCareOpen(true)}>Plant Care</span>
          <span onClick={() => scrollTo('nurseries')}>Nurseries</span>
          <span onClick={() => setLookupOpen(true)}>Track Order</span>
          <span onClick={() => scrollTo('how')}>How It Works</span>
        </div>
        <div className="topbar-right">
          <div className="topbar-search" style={{ cursor: 'pointer' }} onClick={() => setSearchOpen(true)}>
            🔍 Search plants, seeds, tools…
          </div>
          <button id="cartBtn" className="icon-btn" onClick={() => setCartOpen(true)} aria-label="Cart">
            🛒{cartItemCount > 0 && <span className="cart-badge">{cartItemCount}</span>}
          </button>
          {user ? (
            <button className="icon-btn" onClick={() => setOrdersOpen(true)} aria-label="My orders" title={user.email}>
              👤
            </button>
          ) : (
            <button className="btn btn-forest" style={{ padding: '7px 14px', fontSize: 13 }}
              onClick={() => router.push('/login')}>
              Sign in
            </button>
          )}
          <button className="hamburger-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <span /><span /><span />
          </button>
        </div>
      </div>

      {/* HERO */}
      <div className="hero-banner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1545241047-6083a3684587?w=1600&q=70"
          alt="Indoor plants in a bright living room"
        />
        <div className="hero-overlay">
          <div className="hero-content">
            <div className="hero-badge">🌿 Verified nurseries</div>
            <h1>Plants from<br />growers you can trace</h1>
            <p>
              Buy from several independent nurseries in one basket. You pay once; each nursery packs
              and ships its own parcel, and you track every one separately.
            </p>
            <div className="hero-btns">
              <button className="btn btn-forest" onClick={() => scrollTo('shop')}>Browse plants →</button>
              <button className="btn btn-ghost" onClick={() => setCareOpen(true)}>Plant care guide</button>
            </div>
          </div>
        </div>
      </div>

      {/* CATEGORIES */}
      <div className="section" id="shop">
        <div className="section-head reveal">
          <h2>Shop by category</h2>
          {category && (
            <span className="see-all" onClick={() => { setCategory(''); setPage(1); }}>
              Clear filter ✕
            </span>
          )}
        </div>
        <div className="cat-grid reveal">
          {categories.map((c) => (
            <div
              className="cat-tile"
              key={c.id}
              onClick={() => { setCategory(c.slug === category ? '' : c.slug); setPage(1); }}
              style={{ outline: category === c.slug ? '2.5px solid var(--forest)' : undefined }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.imageUrl ?? 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&q=60'} alt={c.name} loading="lazy" />
              <div className="cat-tile-label">
                {c.name}
                <span style={{ opacity: 0.75, fontWeight: 400 }}> · {c.productCount}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PLANT CARE BANNER — honest framing (§29) */}
      <div className="section" style={{ paddingTop: 0 }}>
        <div className="pd-banner reveal">
          <div className="pd-banner-icon">🌿</div>
          <div className="pd-banner-text">
            <h3>Plant care guide</h3>
            <p>
              Yellowing leaves? Brown tips? Look up the symptom and what to do about it — written by
              our growers, not a guess.
            </p>
          </div>
          <button className="btn btn-forest" onClick={() => setCareOpen(true)}>Open the guide</button>
        </div>
      </div>

      {/* PRODUCTS */}
      <div className="section">
        <div className="sort-bar reveal">
          <h2>
            {search
              ? `Results for “${search}”`
              : category
                ? (categories.find((c) => c.slug === category)?.name ?? 'Plants')
                : 'All plants'}
            {total > 0 && (
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                {total} item{total === 1 ? '' : 's'}
              </span>
            )}
          </h2>
          <div className="sort-select">
            Sort by:{' '}
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              <option value="popular">Most popular</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="rating">Best rated</option>
              <option value="newest">Newest</option>
            </select>
          </div>
        </div>

        {search && (
          <div style={{ marginBottom: 16 }}>
            <button className="chip" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}>
              “{search}” ✕
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 14px' }} />
            Loading the catalogue…
          </div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🌱</div>
            <h3 style={{ color: 'var(--forest)', marginBottom: 6 }}>Nothing here yet</h3>
            <p style={{ fontSize: 13.5, maxWidth: 400, margin: '0 auto' }}>
              {search || category
                ? 'Try a different search or category.'
                : 'No plants are listed yet. Once a seller is approved and lists a plant, it appears here.'}
            </p>
          </div>
        ) : (
          <>
            <div className="products-grid">
              {products.map((p, i) => {
                const off = discountPercent(p.price, p.compareAtPrice);
                return (
                  <div className="pcard reveal" key={p.id} style={{ transitionDelay: `${(i % 4) * 0.06}s` }}
                    onClick={() => setDetailSlug(p.slug)}>
                    <div className="pcard-img">
                      {!p.inStock ? (
                        <div className="pcard-badge" style={{ background: 'var(--text-muted)' }}>Out of stock</div>
                      ) : p.lowStock ? (
                        <div className="pcard-badge" style={{ background: 'var(--orange)' }}>Only a few left</div>
                      ) : off ? (
                        <div className="pcard-badge" style={{ background: 'var(--red)' }}>{off}% off</div>
                      ) : null}

                      <div className="pcard-wish" onClick={(e) => { e.stopPropagation(); void toggleWishlist(p); }}>
                        {wishlist.has(p.id) ? '❤️' : '🤍'}
                      </div>

                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.imageUrl ?? 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600&q=60'}
                        alt={p.name}
                        loading="lazy"
                        style={{ opacity: p.inStock ? 1 : 0.55 }}
                      />
                    </div>
                    <div className="pcard-body">
                      <div className="pcard-stars">
                        <span className="stars">{stars(p.rating)}</span>
                        <span className="star-count">
                          {p.reviewCount > 0 ? `(${p.reviewCount})` : '(no reviews yet)'}
                        </span>
                      </div>
                      <div className="pcard-name">{p.name}</div>
                      <div className="pcard-lat">{p.latinName || p.category.name}</div>
                      {/* Who you are actually buying from — a marketplace must say so. */}
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        🏪 {p.seller.businessName}
                        {p.seller.state ? ` · ${p.seller.state}` : ''}
                      </div>
                      <div className="pcard-foot">
                        <div className="pcard-price">
                          {money(p.price)}
                          {p.compareAtPrice ? <s>{money(p.compareAtPrice)}</s> : null}
                        </div>
                        {p.inStock ? (
                          <div className="cart-circle" onClick={(e) => { e.stopPropagation(); void handleAdd(p); }}
                            title="Add to cart">
                            🛒
                          </div>
                        ) : (
                          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Unavailable</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {pageCount > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 30, alignItems: 'center' }}>
                <button className="btn btn-outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Previous
                </button>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Page {page} of {pageCount}</span>
                <button className="btn btn-outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* TRUST BAR */}
      <div className="trust-bar reveal">
        {[
          ['🏪', 'Verified sellers only', 'Every nursery passes KYC and bank verification before it can list.'],
          ['📦', 'Tracked per parcel', 'Each nursery ships its own parcel, with its own courier scans.'],
          ['🔒', 'Server-verified payments', 'Orders are confirmed from the gateway webhook, never the browser.'],
          ['↩️', 'Returns window', 'Request a return per parcel; refunds settle commission automatically.'],
        ].map(([icon, title, body]) => (
          <div className="trust-item" key={title}>
            <div className="trust-icon">{icon}</div>
            <div><h4>{title}</h4><p>{body}</p></div>
          </div>
        ))}
      </div>

      {/* HOW IT WORKS */}
      <div id="how" style={{ background: 'var(--forest)', position: 'relative', zIndex: 1 }}>
        <div className="section">
          <div className="section-head reveal"><h2 style={{ color: '#fff' }}>How Agri Mall works</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 18 }}>
            {[
              ['01', 'Fill one basket', 'Add plants from as many nurseries as you like — the cart groups them by grower.'],
              ['02', 'Pay once', 'We calculate the total on our server and split it into one order per nursery.'],
              ['03', 'Each grower packs', 'Every nursery accepts, packs and dispatches its own parcel.'],
              ['04', 'Track separately', 'Each parcel has its own courier and tracking, so you always know what is where.'],
            ].map(([n, t, d]) => (
              <div key={n} className="reveal" style={{ background: 'rgba(255,255,255,.07)',
                border: '1px solid rgba(255,255,255,.12)', borderRadius: 'var(--radius-lg)', padding: 22 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, color: 'var(--gold)',
                  fontWeight: 700, marginBottom: 10 }}>{n}</div>
                <h4 style={{ color: '#fff', marginBottom: 7, fontSize: 16 }}>{t}</h4>
                <p style={{ fontSize: 13, opacity: 0.72, lineHeight: 1.55, margin: 0, color: '#fff' }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* NURSERIES — real approved sellers */}
      <NurseryNetwork />

      {/* FOOTER */}
      <div className="footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <h3>Agri Mall</h3>
            <p>
              A marketplace connecting India&apos;s heritage nurseries with modern homes. Independent
              growers, verified sourcing, nationwide delivery.
            </p>
          </div>
          <div className="footer-col">
            <h4>Shop</h4>
            <ul>
              <li onClick={() => scrollTo('shop')} style={{ cursor: 'pointer' }}>All plants</li>
              <li onClick={() => setCareOpen(true)} style={{ cursor: 'pointer' }}>Plant care guide</li>
              <li onClick={() => setLookupOpen(true)} style={{ cursor: 'pointer' }}>Track an order</li>
              <li onClick={() => user ? setOrdersOpen(true) : router.push('/login')} style={{ cursor: 'pointer' }}>My orders</li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Sell with us</h4>
            <ul>
              <li onClick={() => router.push('/seller/onboard')} style={{ cursor: 'pointer' }}>Become a seller</li>
              <li onClick={() => router.push('/login')} style={{ cursor: 'pointer' }}>Seller sign-in</li>
              <li onClick={() => scrollTo('nurseries')} style={{ cursor: 'pointer' }}>Our nurseries</li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Account</h4>
            <ul>
              {user ? (
                <>
                  <li>{user.email}</li>
                  <li onClick={() => void logout()} style={{ cursor: 'pointer' }}>Sign out</li>
                </>
              ) : (
                <>
                  <li onClick={() => router.push('/login')} style={{ cursor: 'pointer' }}>Sign in</li>
                  <li onClick={() => router.push('/register')} style={{ cursor: 'pointer' }}>Create an account</li>
                </>
              )}
            </ul>
          </div>
        </div>
        <div className="footer-bottom">© {new Date().getFullYear()} Agri Mall · A multi-vendor plant marketplace</div>
      </div>

      {/* MOBILE DRAWER */}
      <div className={`mob-drawer-ov ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className={`mob-drawer ${menuOpen ? 'open' : ''}`}>
        <div className="mob-drawer-head">
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 19, color: 'var(--forest)' }}>
            🌿 Agri Mall
          </div>
          <button className="close-x" onClick={() => setMenuOpen(false)}>✕</button>
        </div>
        <div className="mob-drawer-body">
          <div className="mob-search-bar" onClick={() => { setMenuOpen(false); setSearchOpen(true); }}>
            <span>🔍</span><span>Search plants, seeds, tools…</span>
          </div>
          {([
            ['🏪', 'Shop', () => { setMenuOpen(false); scrollTo('shop'); }],
            ['🌿', 'Plant care guide', () => { setMenuOpen(false); setCareOpen(true); }],
            ['🌍', 'Our nurseries', () => { setMenuOpen(false); scrollTo('nurseries'); }],
            ['📦', 'Track an order', () => { setMenuOpen(false); setLookupOpen(true); }],
            ['🛒', `Cart (${cartItemCount})`, () => { setMenuOpen(false); setCartOpen(true); }],
            ['🧾', 'My orders', () => { setMenuOpen(false); user ? setOrdersOpen(true) : router.push('/login'); }],
            ['👤', user ? 'Sign out' : 'Sign in', () => { setMenuOpen(false); user ? void logout() : router.push('/login'); }],
          ] as Array<[string, string, () => void]>).map(([icon, label, fn]) => (
            <div key={label} className="mob-menu-item" onClick={fn}>
              <span className="mob-menu-ic">{icon}</span>
              <span className="mob-menu-label">{label}</span>
              <span className="mob-menu-arr">›</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`overlay ${anyOverlay ? 'open' : ''}`}
        onClick={() => { setCartOpen(false); setCareOpen(false); setDetailSlug(null); }} />

      {/* SEARCH */}
      {searchOpen && (
        <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && setSearchOpen(false)}>
          <div className="mbox" style={{ maxWidth: 560 }}>
            <button className="close-x mclose" onClick={() => setSearchOpen(false)}>✕</button>
            <h2>Search plants</h2>
            <p className="msub">By name, botanical name, category or nursery.</p>
            <form onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1); setSearchOpen(false); scrollTo('shop'); }}>
              <div className="field">
                <input autoFocus value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="e.g. monstera, jasmine, mango sapling" />
              </div>
              <button className="cta-full" type="submit">Search</button>
            </form>
          </div>
        </div>
      )}

      {/* ORDER LOOKUP */}
      {lookupOpen && <OrderLookup onClose={() => setLookupOpen(false)} />}

      {/* MY ORDERS */}
      {ordersOpen && (
        <MyOrders
          onClose={() => setOrdersOpen(false)}
          onTrack={(id) => { setOrdersOpen(false); setTrackingOrderId(id); }}
        />
      )}

      {/* PRODUCT DETAIL */}
      {detailSlug && (
        <ProductDetail
          slug={detailSlug}
          onClose={() => setDetailSlug(null)}
          onAdd={(product, qty) => { void handleAdd(product, qty); setDetailSlug(null); }}
        />
      )}

      {/* PLANT CARE GUIDE */}
      {careOpen && <CareGuide onClose={() => setCareOpen(false)} />}

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          if (!requireSignIn('check out')) return;
          setCartOpen(false);
          setCheckoutOpen(true);
        }}
      />

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onOrderPlaced={(orderId) => { setCheckoutOpen(false); setTrackingOrderId(orderId); }}
      />

      <TrackingModal orderId={trackingOrderId} onClose={() => setTrackingOrderId(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Nursery network — the real approved sellers, not a hardcoded list
// ---------------------------------------------------------------------------

function NurseryNetwork() {
  const [sellers, setSellers] = useState<Array<{ id: string; businessName: string; slug: string; city: string | null; state: string | null; count: number }>>([]);

  useEffect(() => {
    // Derived from the catalogue, so it only ever shows sellers who are
    // approved AND actually have live listings.
    void api.catalog
      .products({ perPage: 60, sort: 'popular' })
      .then((d) => {
        const map = new Map<string, { id: string; businessName: string; slug: string; city: string | null; state: string | null; count: number }>();
        for (const p of d.products) {
          const existing = map.get(p.seller.id);
          if (existing) existing.count++;
          else map.set(p.seller.id, { ...p.seller, count: 1 });
        }
        setSellers([...map.values()].sort((a, b) => b.count - a.count));
      })
      .catch(() => undefined);
  }, []);

  if (sellers.length === 0) return null;

  return (
    <div className="section" id="nurseries">
      <div className="section-head reveal"><h2>Our nursery network</h2></div>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, marginTop: -16 }}>
        {sellers.length} verified grower{sellers.length === 1 ? '' : 's'} currently selling on Agri Mall
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 16 }}>
        {sellers.map((s) => (
          <div key={s.id} className="reveal" style={{ background: '#fff', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🏪</div>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--forest)', marginBottom: 3 }}>
              {s.businessName}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 8 }}>
              📍 {[s.city, s.state].filter(Boolean).join(', ') || 'India'}
            </div>
            <span style={{ background: 'var(--green-light)', color: 'var(--green)', fontSize: 11,
              fontWeight: 600, padding: '3px 9px', borderRadius: 999 }}>
              {s.count} plant{s.count === 1 ? '' : 's'} listed
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

function ProductDetail({
  slug,
  onClose,
  onAdd,
}: {
  slug: string;
  onClose: () => void;
  onAdd: (product: ProductCard, qty: number) => void;
}) {
  const [data, setData] = useState<{ product: Record<string, unknown>; reviews: Array<Record<string, unknown>>; ratingHistogram: Array<Record<string, unknown>> } | null>(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void api.catalog
      .product(slug)
      .then((d) => setData(d as never))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [slug]);

  const p = data?.product as Record<string, unknown> | undefined;
  const care = (p?.care ?? {}) as Record<string, string | null>;
  const seller = (p?.seller ?? {}) as Record<string, unknown>;
  const images = (p?.images ?? []) as Array<{ url: string; alt: string | null }>;
  const maxQty = Math.max(1, Number(p?.maxOrderQuantity ?? 1));
  const off = p ? discountPercent(Number(p.price), p.compareAtPrice as number | null) : null;

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && onClose()}>
      <div className="mbox wide">
        <button className="close-x mclose" onClick={onClose} aria-label="Close">✕</button>

        {loading && (
          <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        )}
        {error && <div style={{ color: 'var(--red)', padding: 20 }}>{error}</div>}

        {p && (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 280px' }}>
              <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', height: 300,
                background: 'var(--cream)', marginBottom: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={images[0]?.url ?? ''} alt={String(p.name)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              {images.length > 1 && (
                <div className="pd-thumbs">
                  {images.slice(0, 4).map((img, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={i} className="pd-thumb" src={img.url} alt={img.alt ?? ''} />
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 280 }}>
              <h2 style={{ margin: '0 0 3px', fontSize: 27 }}>{String(p.name)}</h2>
              {p.latinName ? (
                <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: 14, marginBottom: 10 }}>
                  {String(p.latinName)}
                </div>
              ) : null}

              {/* Who is selling this — a marketplace must be explicit */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--cream)',
                padding: '9px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 12, fontSize: 12.5 }}>
                <span style={{ fontSize: 16 }}>🏪</span>
                <div>
                  <div style={{ fontWeight: 600 }}>Sold by {String(seller.businessName)}</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    {[seller.city, seller.state].filter(Boolean).join(', ')}
                    {Number(seller.ratingCount) > 0
                      ? ` · ${Number(seller.ratingAvg).toFixed(1)}★ from ${seller.ratingCount} reviews`
                      : ' · new seller'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--forest)' }}>{money(Number(p.price))}</span>
                {p.compareAtPrice ? (
                  <span style={{ fontSize: 15, color: '#aaa', textDecoration: 'line-through' }}>
                    {money(p.compareAtPrice as number)}
                  </span>
                ) : null}
                {off ? (
                  <span style={{ background: '#FFF0E8', color: 'var(--orange)', fontSize: 12,
                    fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>{off}% OFF</span>
                ) : null}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, marginBottom: 14,
                paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--gold)' }}>{stars(Number(p.rating))}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {Number(p.reviewCount) > 0
                    ? `${Number(p.rating).toFixed(1)} · ${p.reviewCount} review${Number(p.reviewCount) === 1 ? '' : 's'}`
                    : 'No reviews yet'}
                </span>
                {p.inStock ? (
                  p.lowStock ? (
                    <span style={{ color: 'var(--orange)', fontWeight: 600 }}>Only a few left</span>
                  ) : (
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>In stock</span>
                  )
                ) : (
                  <span style={{ color: 'var(--red)', fontWeight: 600 }}>Out of stock</span>
                )}
              </div>

              {/* Care grid, as in v1 */}
              {(care.light || care.water || care.temp || care.safety) && (
                <div className="care-grid" style={{ marginBottom: 14 }}>
                  {([['☀️', 'Light', care.light], ['💧', 'Water', care.water],
                     ['🌡️', 'Temp', care.temp], ['🐾', 'Pets', care.safety]] as Array<[string, string, string | null]>)
                    .filter(([, , v]) => Boolean(v))
                    .map(([icon, label, value]) => (
                      <div className="care-box" key={label}>
                        <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
                        <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--text-muted)',
                          fontWeight: 600, marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 11.5, fontWeight: 600 }}>{value}</div>
                      </div>
                    ))}
                </div>
              )}

              {p.description ? (
                <p style={{ fontSize: 13.5, color: 'var(--text-mid)', lineHeight: 1.7, marginBottom: 16 }}>
                  {String(p.description)}
                </p>
              ) : null}

              {p.inStock ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="qty-box">
                    <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">−</button>
                    <span>{qty}</span>
                    <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} aria-label="Increase">+</button>
                  </div>
                  <button className="pd-add-btn" style={{ flex: 1, minWidth: 180 }}
                    onClick={() => onAdd(
                      {
                        id: String(p.id), name: String(p.name), slug: String(p.slug),
                        latinName: null, price: Number(p.price), compareAtPrice: null,
                        imageUrl: images[0]?.url ?? null, rating: 0, reviewCount: 0,
                        category: { slug: '', name: '' },
                        seller: { id: String(seller.id), businessName: String(seller.businessName), slug: '', city: null, state: null },
                        careDifficulty: null, careSafety: null, originLabel: null,
                        inStock: true, lowStock: false,
                      },
                      qty,
                    )}>
                    🛒 Add {qty > 1 ? `${qty} ` : ''}to cart · {money(Number(p.price) * qty)}
                  </button>
                </div>
              ) : (
                <div style={{ background: 'var(--cream)', padding: '14px 16px', borderRadius: 'var(--radius-sm)',
                  fontSize: 13.5, color: 'var(--text-muted)' }}>
                  This plant is out of stock at {String(seller.businessName)} right now.
                </div>
              )}

              {/* Real reviews only */}
              <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: 'var(--forest)' }}>
                  Customer reviews
                </h4>
                {(data?.reviews.length ?? 0) === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    No reviews yet. Only customers who have actually received this plant can review it.
                  </p>
                ) : (
                  data!.reviews.map((r) => (
                    <div key={String(r.id)} style={{ borderBottom: '1px solid var(--border)',
                      paddingBottom: 12, marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{String(r.author)}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{dateShort(r.createdAt as string)}</span>
                      </div>
                      <div style={{ color: 'var(--gold)', fontSize: 12, marginBottom: 4 }}>{stars(Number(r.rating))}</div>
                      {r.title ? <div style={{ fontWeight: 600, fontSize: 13 }}>{String(r.title)}</div> : null}
                      {r.comment ? (
                        <p style={{ fontSize: 13, color: 'var(--text-mid)', margin: '3px 0 0', lineHeight: 1.6 }}>
                          {String(r.comment)}
                        </p>
                      ) : null}
                      {r.sellerReply ? (
                        <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '8px 11px',
                          marginTop: 7, fontSize: 12.5 }}>
                          <strong>Reply from the nursery:</strong> {String(r.sellerReply)}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guest order lookup
// ---------------------------------------------------------------------------

function OrderLookup({ onClose }: { onClose: () => void }) {
  const [orderNumber, setOrderNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<{ orderNumber: string; status: string; placedAt: string; parcels: Array<Record<string, unknown>> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.orders.track(orderNumber.trim().toUpperCase(), phone.trim() || undefined);
      setResult(data as never);
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
        <h2>Track your order</h2>
        <p className="msub">Enter your order number and the last 4 digits of the delivery phone.</p>

        <form onSubmit={lookup}>
          <div className="frow">
            <div className="field">
              <label>Order number</label>
              <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
                placeholder="AGM-4821" />
            </div>
            <div className="field">
              <label>Phone (last 4)</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric" maxLength={4} placeholder="1223" />
            </div>
          </div>
          {error && (
            <div style={{ background: '#FFF0F0', color: 'var(--red)', padding: '10px 13px',
              borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          <button className="cta-full" type="submit" disabled={busy || !orderNumber.trim()}>
            {busy ? 'Looking…' : 'Track →'}
          </button>
        </form>

        {result && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ color: 'var(--forest)' }}>{result.orderNumber}</strong>
              <StatusPill status={result.status} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Placed {dateShort(result.placedAt)} · {result.parcels.length} parcel{result.parcels.length === 1 ? '' : 's'}
            </div>
            {result.parcels.map((parcel, i) => (
              <div key={i} style={{ background: 'var(--cream)', borderRadius: 'var(--radius-sm)',
                padding: '12px 14px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>🏪 {String(parcel.sellerName)}</strong>
                  <StatusPill status={String(parcel.status)} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {String(parcel.itemsLabel)}
                </div>
                <div className="prog-bar"><div className="prog-bar-fill" style={{ width: `${Number(parcel.progress)}%` }} /></div>
                {parcel.trackingNumber ? (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                    {String(parcel.courier)} · {String(parcel.trackingNumber)}
                    {parcel.estimatedDelivery ? ` · expected ${dateShort(parcel.estimatedDelivery as string)}` : ''}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My orders
// ---------------------------------------------------------------------------

function MyOrders({ onClose, onTrack }: { onClose: () => void; onTrack: (orderId: string) => void }) {
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.orders
      .list()
      .then((d) => setOrders(d.orders))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && onClose()}>
      <div className="mbox wide" style={{ maxWidth: 640 }}>
        <button className="close-x mclose" onClick={onClose}>✕</button>
        <h2>My orders</h2>
        <p className="msub">Each order may contain several parcels, one per nursery.</p>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        )}
        {error && <div style={{ color: 'var(--red)', fontSize: 13.5 }}>{error}</div>}

        {!loading && orders.length === 0 && (
          <div className="empty-cart">🌱<br />No orders yet.<br />Your first order will appear here.</div>
        )}

        {orders.map((o) => {
          const parcels = (o.parcels ?? []) as Array<Record<string, unknown>>;
          return (
            <div key={String(o.id)} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <div>
                  <strong style={{ color: 'var(--forest)' }}>{String(o.orderNumber)}</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {dateShort(o.createdAt as string)} · {money(o.grandTotal as number)} ·{' '}
                    {Number(o.parcelCount)} parcel{Number(o.parcelCount) === 1 ? '' : 's'}
                  </div>
                </div>
                <StatusPill status={String(o.status)} />
              </div>

              {parcels.map((p) => (
                <div key={String(p.id)} style={{ display: 'flex', gap: 10, alignItems: 'center',
                  padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
                  {p.thumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={String(p.thumbnail)} alt="" style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover' }} />
                  ) : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{String(p.sellerName)}</div>
                    <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {String(p.itemsLabel)}
                    </div>
                  </div>
                  <StatusPill status={String(p.status)} />
                </div>
              ))}

              <button className="btn btn-outline" style={{ marginTop: 10, width: '100%' }}
                onClick={() => onTrack(String(o.id))}>
                View &amp; track →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plant care guide — honest replacement for v1's "AI diagnosis" (§29)
// ---------------------------------------------------------------------------

function CareGuide({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<CareSymptom | null>(null);
  const [query, setQuery] = useState('');
  const [noMatch, setNoMatch] = useState(false);

  function lookup(e: React.FormEvent) {
    e.preventDefault();
    const match = matchSymptom(query);
    setSelected(match);
    setNoMatch(!match && query.trim().length > 0);
  }

  return (
    <div className="mov open" onClick={(e) => (e.target as HTMLElement).className.includes('mov') && onClose()}>
      <div className="mbox wide" style={{ maxWidth: 680 }}>
        <button className="close-x mclose" onClick={onClose}>✕</button>
        <h2>Plant care guide 🌿</h2>
        <p className="msub">
          Common symptoms and what to do about them. This is general guidance from our growers — not
          a diagnosis of your specific plant.
        </p>

        <form onSubmit={lookup} style={{ marginBottom: 18 }}>
          <div className="field">
            <label>Describe what you are seeing</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. the leaves are going yellow and droopy" style={{ flex: 1 }} />
              <button className="btn btn-forest" type="submit" style={{ whiteSpace: 'nowrap' }}>Look up</button>
            </div>
          </div>
        </form>

        {noMatch && (
          <div style={{ background: '#FFF8E8', border: '1px solid #F0D9A0', borderRadius: 'var(--radius-sm)',
            padding: '12px 14px', fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
            We do not have a confident match for that description. Pick the closest symptom below, or
            contact the nursery you bought from — they know their own plants best.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {CARE_SYMPTOMS.map((s) => (
            <button key={s.label} className="dc-qbtn"
              style={{ borderColor: selected?.label === s.label ? 'var(--forest)' : undefined,
                background: selected?.label === s.label ? 'var(--green-light)' : undefined }}
              onClick={() => { setSelected(s); setNoMatch(false); }}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {selected ? (
          <div className="diag-box">
            <div className="diag-tag">Most likely cause</div>
            <h3>{selected.icon} {selected.label}</h3>
            <p>{selected.likelyCause}</p>

            <div className="diag-step">
              <div className="diag-step-icon">
                <svg viewBox="0 0 12 12" fill="none"><path d="M2 6L4.5 8.5L10 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </div>
              <div><h5>Do this now</h5><p>{selected.whatToDo}</p></div>
            </div>

            <div className="diag-step">
              <div className="diag-step-icon">
                <svg viewBox="0 0 12 12" fill="none"><path d="M2 6L4.5 8.5L10 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </div>
              <div><h5>Longer term</h5><p>{selected.longerTerm}</p></div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text-muted)', fontSize: 13.5 }}>
            Pick a symptom above to see what usually causes it and what to do.
          </div>
        )}
      </div>
    </div>
  );
}
