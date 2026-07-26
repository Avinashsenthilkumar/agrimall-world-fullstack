'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/AppContext';
import { DEMO_SELLERS } from '../../../lib/data';
import StatusPill from '../../../components/StatusPill';
import LeafParticles from '../../../components/LeafParticles';
import { toast } from '../../../components/Toast';
import api from '../../../lib/api';

const NEXT_ACTION={placed:'Confirm',confirmed:'Mark Packed',packed:'Dispatch',dispatched:'Ship',in_transit:'Out for Delivery',out_for_delivery:'Delivered'};

export default function SellerDashboard() {
  const router = useRouter();
  const { state } = useApp();
  const [tab, setTab] = useState('listings');
  const [seller, setSeller] = useState(null);
  const [listings, setListings] = useState([]);
  const [orders, setOrders] = useState([]);
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [stockMap, setStockMap] = useState({});
  const allSellers = [...DEMO_SELLERS, ...state.sellers];
  const [busy, setBusy] = useState(null);

  // Pull the seller's real listings + orders from the backend.
  async function loadSeller(email, pass, greet) {
    try {
      const d = await api.login(email, pass);
      setSeller({ ...d.seller, email, pass });
      setListings(d.listings);
      setOrders(d.orders);
      const sm = {}; d.listings.forEach((l, i) => { sm[i] = l.stock; }); setStockMap(sm);
      setShowLogin(false);
      if (typeof window !== 'undefined') window.__sellerSession = { ...d.seller, email, pass };
      if (greet) toast('Welcome, ' + (d.seller.owner_name || d.seller.biz_name) + '! 👋');
    } catch (e) {
      alert('Sign in failed: ' + e.message);
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__sellerSession) {
      const s = window.__sellerSession;
      loadSeller(s.email, s.pass, false);
    } else {
      setShowLogin(true);
    }
  }, []);

  function signIn(s) { loadSeller(s.email, s.pass, true); }
  function doLogin() {
    if (!loginEmail || !loginPass) { alert('Enter email and password.'); return; }
    loadSeller(loginEmail, loginPass, true);
  }

  async function reloadSeller() { if (seller) await loadSeller(seller.email, seller.pass, false); }

  async function addProduct(p) {
    try {
      await api.addProduct({ ...p, seller_id: seller?.id });
      setShowAddProduct(false);
      toast(p.name + ' listed on Agri Mall! 🌱');
      await reloadSeller();
    } catch (e) { alert('Could not add product: ' + e.message); }
  }

  async function deleteProduct(i) {
    const prod = listings[i];
    try { if (prod?.id) await fetch('/api/products/' + prod.id, { method: 'DELETE' }); } catch (e) {}
    setListings(prev => prev.filter((_, idx) => idx !== i));
    toast('Product removed 🗑');
  }

  async function advanceOrder(id) {
    setBusy(id);
    try { const d = await api.advance(id); toast('Order ' + id + ' → ' + (d.stage?.title || 'updated')); await reloadSeller(); }
    catch (e) { toast(e.message); } finally { setBusy(null); }
  }

  const revenue = orders.reduce((s,o) => s + (o.total||0), 0);
  const ordCount = orders.length;
  const lowCount = listings.filter((_,i) => (stockMap[i]||0) < 15).length;

  const navItems = [
    {id:'listings', label:'🌿 My Listings'},
    {id:'stock',    label:'📦 Stock Manager'},
    {id:'orders',   label:'🛒 Orders'},
    {id:'earnings', label:'💰 Earnings'},
    {id:'profile',  label:'👤 Profile'},
  ];

  return (
    <>
      <LeafParticles />

      {/* SELLER LOGIN OVERLAY */}
      {showLogin && (
        <div className="slov open" onClick={e => e.target.className.includes('slov') && router.push('/')}>
          <div className="slbox">
            <h2 style={{color:'var(--forest)',marginBottom:4}}>Seller Sign In</h2>
            <p style={{fontSize:'13px',color:'#8a7d6f',marginBottom:'16px'}}>Use credentials from your KYC registration, or click a demo account.</p>
            <p style={{fontSize:'12px',fontWeight:700,color:'#6b5e51',marginBottom:'8px',textTransform:'uppercase',letterSpacing:'.3px'}}>Demo Accounts</p>
            {DEMO_SELLERS.map((s,i) => (
              <div className="dacc" key={i} onClick={() => signIn(s)}>
                <div style={{fontSize:'22px'}}>🏪</div>
                <div>
                  <div className="dan">{s.bizName}</div>
                  <div className="das">{s.bizState} · {s.listings.length} products · {s.email}</div>
                </div>
                <div style={{marginLeft:'auto',fontSize:'13px',color:'var(--terracotta)',fontWeight:700}}>→</div>
              </div>
            ))}
            {state.sellers.length > 0 && state.sellers.map((s,i) => (
              <div className="dacc" key={'new'+i} onClick={() => signIn(s)}>
                <div style={{fontSize:'22px'}}>🌱</div>
                <div>
                  <div className="dan">{s.bizName}</div>
                  <div className="das">{s.bizState} · New registration · {s.email}</div>
                </div>
                <div style={{marginLeft:'auto',fontSize:'13px',color:'var(--terracotta)',fontWeight:700}}>→</div>
              </div>
            ))}
            <hr style={{border:'none',borderTop:'1px solid var(--line)',margin:'16px 0'}}/>
            <p style={{fontSize:'12px',fontWeight:700,color:'#6b5e51',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:'10px'}}>Or sign in manually</p>
            <div className="field"><label>Email</label><input value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="you@nursery.com" /></div>
            <div className="field"><label>Password</label><input type="password" value={loginPass} onChange={e=>setLoginPass(e.target.value)} placeholder="Your password" /></div>
            <button className="cta-full" onClick={doLogin}>Sign In</button>
            <p style={{textAlign:'center',fontSize:'12px',color:'#8a7d6f',marginTop:'12px'}}>
              New here? <span style={{color:'var(--terracotta)',cursor:'pointer',fontWeight:600}} onClick={() => router.push('/seller/onboard')}>Register & KYC →</span>
            </p>
          </div>
        </div>
      )}

      {/* ADD PRODUCT MODAL */}
      {showAddProduct && <AddProductModal onClose={() => setShowAddProduct(false)} onAdd={addProduct} />}

      <div className="dash-shell">
        <div className="dsb">
          <div className="logo" style={{color:'#fff',fontFamily:"'Fraunces',serif",fontWeight:600,fontSize:17}}>
            🌿 {seller?.bizName || 'Agri Mall'}
          </div>
          <div className="dnav">
            {navItems.map(n => <div key={n.id} className={`si ${tab===n.id?'on':''}`} onClick={() => setTab(n.id)}>{n.label}</div>)}
          </div>
          <div className="dexit" onClick={() => router.push('/')}>⏎ Switch role</div>
        </div>

        <div className="dmain">
          <div className="dtop">
            <div>
              <h2>Seller Dashboard</h2>
              <div className="dsub">{seller?.bizName || '—'} &middot; {seller?.bizState || '—'}</div>
            </div>
            <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
              {(tab==='listings'||tab==='stock') && <button className="add-p-btn" onClick={() => setShowAddProduct(true)}>+ Add Product</button>}
              <span className="rbadge">Seller</span>
            </div>
          </div>

          {/* KPIs */}
          <div className="kpi-row">
            <div className="kpi"><div className="kl">Live Products</div><div className="kv">{listings.length}</div><div className="kd">On marketplace</div></div>
            <div className="kpi"><div className="kl">Total Orders</div><div className="kv">{ordCount}</div><div className="kd kup">This month</div></div>
            <div className="kpi"><div className="kl">Revenue</div><div className="kv">₹{revenue.toLocaleString('en-IN')}</div><div className="kd kup">live from DB</div></div>
            <div className="kpi"><div className="kl">Low Stock</div><div className="kv">{lowCount}</div><div className="kd kwarn">Restock soon</div></div>
          </div>

          {tab === 'listings' && (
            <div className="panel">
              <div className="ph"><h3>My Listings</h3></div>
              {listings.length === 0
                ? <div className="empty-cart">🌱<br/>No products yet.<br/>Click &ldquo;+ Add Product&rdquo; to list your first plant.</div>
                : <div className="grid">
                    {listings.map((p, i) => (
                      <div className="lcard" key={i}>
                        <div className="lci">
                          <img src={p.img || 'https://loremflickr.com/400/300/plant'} alt={p.name} onError={e=>e.target.src='https://loremflickr.com/400/300/plant'} />
                          <div className="llive">Live</div>
                          {(stockMap[i]||p.stock) < 15 && <div className="llow">Low</div>}
                          <div className="ldel" onClick={() => deleteProduct(i)}>🗑</div>
                        </div>
                        <div className="lcb">
                          <div className="lcn">{p.name}</div>
                          <div className="lcp">${p.price}</div>
                          <div className="lcs">📦 {stockMap[i]||p.stock} units</div>
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          )}

          {tab === 'stock' && (
            <div className="panel">
              <div className="ph"><h3>Stock Manager</h3></div>
              {listings.length === 0
                ? <div className="empty-cart">No products yet.</div>
                : <table>
                    <thead><tr><th>Plant</th><th>Category</th><th>Price</th><th>Stock on Hand</th><th>Status</th></tr></thead>
                    <tbody>
                      {listings.map((p,i) => (
                        <tr key={i}>
                          <td><img className="rthumb" src={p.img||'https://loremflickr.com/80/80/plant'} alt={p.name} onError={e=>e.target.src='https://loremflickr.com/80/80/plant'} />{p.name}</td>
                          <td style={{textTransform:'capitalize'}}>{p.cat}</td>
                          <td>${p.price}</td>
                          <td>
                            <input className={`sinp ${(stockMap[i]||0)<15?'low':''}`} type="number" min="0" value={stockMap[i]??p.stock}
                              onChange={e => { const v=Math.max(0,parseInt(e.target.value)||0); setStockMap(s=>({...s,[i]:v})); }}
                              onBlur={e => { const v=Math.max(0,parseInt(e.target.value)||0); if(p.id) api.updateProduct(p.id,{stock:v}).then(()=>toast('Stock saved ✓')).catch(()=>{}); }} />
                          </td>
                          <td><StatusPill status={(stockMap[i]||p.stock)<15?'pending':'delivered'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              }
            </div>
          )}

          {tab === 'orders' && (
            <div className="panel">
              <div className="ph"><h3>Orders for Your Products</h3></div>
              <div style={{overflowX:'auto'}}><table>
                <thead><tr><th>Order</th><th>Buyer</th><th>Items</th><th>Status</th><th>Amount</th><th>Action</th></tr></thead>
                <tbody>
                  {orders.length === 0
                    ? <tr><td colSpan={6} style={{textAlign:'center',padding:'28px',color:'#8a7d6f'}}>No orders yet. When a customer buys one of your listed products, it appears here for you to confirm & fulfil.</td></tr>
                    : orders.map((o) => (
                    <tr key={o.id}>
                      <td><b>{o.id}</b></td>
                      <td>{o.customer_name}</td>
                      <td>{o.itemsLabel || '—'}</td>
                      <td><StatusPill status={o.status} /></td>
                      <td>₹{(o.total||0).toLocaleString('en-IN')}</td>
                      <td>{NEXT_ACTION[o.status]
                        ? <button disabled={busy===o.id} onClick={()=>advanceOrder(o.id)} style={{background:'var(--forest,#1C3829)',color:'#fff',border:'none',borderRadius:'6px',padding:'5px 10px',fontSize:'11.5px',fontWeight:600,cursor:'pointer',opacity:busy===o.id?.6:1,whiteSpace:'nowrap'}}>{busy===o.id?'…':NEXT_ACTION[o.status]}</button>
                        : <span style={{fontSize:'11.5px',color:'#2A7D4F',fontWeight:600}}>✓ Done</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {tab === 'earnings' && (
            <div>
              <div className="kpi-row">
                <div className="kpi"><div className="kl">This Month</div><div className="kv">${revenue}</div><div className="kd kup">▲ 14%</div></div>
                <div className="kpi"><div className="kl">All Time</div><div className="kv">${revenue*3}</div></div>
                <div className="kpi"><div className="kl">Pending Payout</div><div className="kv">${Math.round(revenue*.4)}</div><div className="kd kwarn">Processing</div></div>
                <div className="kpi"><div className="kl">Fee Rate</div><div className="kv">8%</div><div className="kd">Per sale</div></div>
              </div>
              <div className="panel">
                <div className="ph"><h3>Payout History</h3></div>
                <table>
                  <thead><tr><th>Period</th><th>Orders</th><th>Gross</th><th>Fee (8%)</th><th>Net Payout</th><th>Status</th></tr></thead>
                  <tbody>
                    {listings.length > 0 ? [['June 2025',4,revenue,Math.round(revenue*.08)],['May 2025',6,revenue+40,Math.round((revenue+40)*.08)]].map(([pd,o,gr,fe],i) => (
                      <tr key={i}><td>{pd}</td><td>{o}</td><td>${gr}</td><td style={{color:'#bb4444'}}>-${fe}</td><td><b>${gr-fe}</b></td><td><StatusPill status="delivered" /></td></tr>
                    )) : <tr><td colSpan={6} style={{textAlign:'center',padding:'28px',color:'#8a7d6f'}}>No payouts yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'profile' && seller && (
            <div className="panel">
              <div className="ph"><h3>Profile &amp; Store</h3></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',fontSize:'13.5px'}}>
                {[['Business Name', seller.bizName],['Owner', seller.ownerName],['Email', seller.email],['Phone', seller.bizPhone||'—'],['State', seller.bizState],['KYC Status','✅ Verified']].map(([k,v],i)=>(
                  <div key={i}><b>{k}</b><br/><span style={{color:'#8a7d6f'}}>{v}</span></div>
                ))}
              </div>
              <div className="cred-box" style={{marginTop:'18px'}}>
                <b>Your seller login credentials</b><br/>
                Email: {seller.email}<br/>
                Use these to sign in next time as <em>Returning Seller</em>.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function AddProductModal({ onClose, onAdd }) {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [cat, setCat] = useState('indoor');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [img, setImg] = useState('');
  const [desc, setDesc] = useState('');

  function submit() {
    if (!name.trim()) { alert('Please enter a plant name.'); return; }
    onAdd({
      name, lat, cat,
      price: parseInt(price)||10,
      stock: parseInt(stock)||50,
      img: img || `https://loremflickr.com/400/300/${encodeURIComponent(name.toLowerCase())},plant`,
      desc,
    });
  }

  return (
    <div className="mov open" onClick={e => e.target.className.includes('mov') && onClose()}>
      <div className="mbox">
        <button className="close-x mclose" onClick={onClose}>✕</button>
        <h2>Add New Product</h2>
        <p className="msub">List a new plant on the Agri Mall marketplace</p>
        {img && <img src={img} alt="preview" style={{width:'100%',height:'140px',objectFit:'cover',borderRadius:'10px',marginBottom:'12px'}} onError={e=>e.target.style.display='none'} />}
        <div className="field"><label>Plant Name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Curry Leaf Plant" /></div>
        <div className="field"><label>Latin / Scientific Name</label><input value={lat} onChange={e=>setLat(e.target.value)} placeholder="e.g. Murraya koenigii" /></div>
        <div className="frow">
          <div className="field"><label>Category</label>
            <select value={cat} onChange={e=>setCat(e.target.value)}>
              <option value="indoor">Indoor</option><option value="flowering">Flowering</option>
              <option value="fruit">Fruit Trees</option><option value="succulent">Succulents</option>
            </select>
          </div>
          <div className="field"><label>Price ($)</label><input type="number" value={price} onChange={e=>setPrice(e.target.value)} placeholder="12" /></div>
          <div className="field"><label>Stock Units</label><input type="number" value={stock} onChange={e=>setStock(e.target.value)} placeholder="50" /></div>
        </div>
        <div className="field"><label>Image URL (optional)</label><input value={img} onChange={e=>setImg(e.target.value)} placeholder="https://..." /></div>
        <div className="field"><label>Description</label><input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Short plant description…" /></div>
        <button className="cta-full" onClick={submit}>List Product on Agri Mall 🌱</button>
      </div>
    </div>
  );
}
