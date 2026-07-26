'use client';
import{useState,useEffect}from'react';
import{useRouter}from'next/navigation';
import StatusPill from'../../components/StatusPill';
import LeafParticles from'../../components/LeafParticles';
import{toast}from'../../components/Toast';
import api from'../../lib/api';
const NEXT_ACTION={placed:'Confirm',confirmed:'Mark Packed',packed:'Dispatch',dispatched:'Ship (In Transit)',in_transit:'Out for Delivery',out_for_delivery:'Mark Delivered'};
export default function VendorPage(){
  const router=useRouter();
  const[mobMenuOpen,setMobMenuOpen]=useState(false);
  const[tab,setTab]=useState('orders');
  const[orders,setOrders]=useState([]);
  const[products,setProducts]=useState([]);
  const[busy,setBusy]=useState(null);
  async function loadOrders(){try{setOrders(await api.orders({region:'Tamil Nadu'}));}catch(e){}}
  useEffect(()=>{loadOrders();api.products().then(setProducts).catch(()=>{});const t=setInterval(loadOrders,4000);return()=>clearInterval(t);},[]);
  async function advanceOrder(id){setBusy(id);try{const d=await api.advance(id);toast('Order '+id+' → '+(d.stage?.title||'updated'));await loadOrders();}catch(e){toast(e.message);}finally{setBusy(null);}}
  const tnP=products.filter(p=>/tamil|madurai|chennai|erode|coimbatore/i.test(p.orig||''));
  const stockList=tnP.length?tnP:products;
  const rev=orders.reduce((s,o)=>s+(o.total||0),0);
  const lowC=stockList.filter(p=>p.stock<15).length;
  return(<><LeafParticles/>
    <div className="dash-shell">
      <div className="dsb">
        <div className="dsb-logo"><div className="icon">🌿</div><div className="name">Agri Mall</div></div>
        <div className="dsb-sub">Vendor · Tamil Nadu</div>
        <div className="dnav">
          {[{id:'orders',icon:'📦',l:'My Orders'},{id:'stock',icon:'🌱',l:'My Stock'},{id:'analytics',icon:'📊',l:'Analytics'}].map(n=>(
            <div key={n.id} className={`si ${tab===n.id?'on':''}`} onClick={()=>setTab(n.id)}><span>{n.icon}</span>{n.l}</div>
          ))}
        </div>
        <div className="dexit" onClick={()=>router.push('/')}>⏎ Switch role</div>
      </div>
      <div className="dmain">
        {/* Mobile dash menu overlay */}
        {mobMenuOpen&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:199}} onClick={()=>setMobMenuOpen(false)}/>}
        {mobMenuOpen&&<div style={{position:'fixed',top:0,left:0,bottom:0,width:'min(280px,85vw)',background:'var(--forest)',zIndex:200,display:'flex',flexDirection:'column',padding:'22px 16px',boxShadow:'4px 0 24px rgba(0,0,0,.3)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'24px'}}>
            <span style={{color:'#fff',fontFamily:"'Playfair Display',serif",fontSize:'18px',fontWeight:700}}>🌿 Agri Mall</span>
            <button style={{background:'rgba(255,255,255,.15)',border:'none',color:'#fff',width:30,height:30,borderRadius:'50%',fontSize:14,cursor:'pointer'}} onClick={()=>setMobMenuOpen(false)}>✕</button>
          </div>
          <div style={{fontSize:'11px',opacity:.5,color:'#fff',marginBottom:'8px',textTransform:'uppercase',letterSpacing:'1px'}}>Vendor · Tamil Nadu</div>
        </div>}
        <div className="dash-topbar">
          <div><h2>Vendor Dashboard</h2><p style={{fontSize:'12px',color:'var(--text-muted)',margin:0}}>Tamil Nadu Nursery Partner</p></div>
          <div className="dash-topbar-right">
            <button className="hamburger-btn" onClick={()=>setMobMenuOpen(true)} aria-label="Menu">
              <span/><span/><span/>
            </button><span className="rbadge">Vendor · TN</span></div>
        </div>
        <div className="dash-body">
          <div className="kpi-row" style={{marginBottom:'20px'}}>
            <div className="kpi"><div className="kpi-icon green">📦</div><div><div className="kl">My Orders</div><div className="kv">{orders.length}</div><div className="kd">Tamil Nadu region</div></div></div>
            <div className="kpi"><div className="kpi-icon orange">💰</div><div><div className="kl">My Revenue</div><div className="kv">₹{rev.toLocaleString('en-IN')}</div><div className="kd kup">live from DB</div></div></div>
            <div className="kpi"><div className="kpi-icon blue">🌿</div><div><div className="kl">Products Listed</div><div className="kv">{stockList.length}</div><div className="kd">Your nursery</div></div></div>
            <div className="kpi"><div className="kpi-icon orange">⚠️</div><div><div className="kl">Low Stock Items</div><div className="kv">{lowC}</div><div className="kd kwarn">Restock soon</div></div></div>
          </div>
          {tab==='orders'&&<div className="panel"><div className="ph"><h3>Orders for Your Nursery — Tamil Nadu</h3></div>
            <div style={{overflowX:'auto'}}><table><thead><tr><th>Order</th><th>Customer</th><th>City</th><th>Items</th><th>Status</th><th>Total</th><th>Action</th></tr></thead>
            <tbody>{orders.length===0?<tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-muted)',padding:'20px'}}>No orders in your region yet.</td></tr>:orders.map(o=><tr key={o.id}><td><b>{o.id}</b></td><td>{o.customer_name}</td><td>{o.city||'—'}</td><td>{o.itemsLabel||'—'}</td><td><StatusPill status={o.status}/></td><td>₹{(o.total||0).toLocaleString('en-IN')}</td><td>{NEXT_ACTION[o.status]?<button disabled={busy===o.id} onClick={()=>advanceOrder(o.id)} style={{background:'var(--forest)',color:'#fff',border:'none',borderRadius:'6px',padding:'5px 10px',fontSize:'11.5px',fontWeight:600,cursor:'pointer',opacity:busy===o.id?.6:1,whiteSpace:'nowrap'}}>{busy===o.id?'…':NEXT_ACTION[o.status]}</button>:<span style={{fontSize:'11.5px',color:'var(--green)',fontWeight:600}}>✓ Done</span>}</td></tr>)}</tbody>
            </table></div>
          </div>}
          {tab==='stock'&&<div className="panel"><div className="ph"><h3>Your Stock</h3></div>
            <div style={{overflowX:'auto'}}><table><thead><tr><th>Plant</th><th>Price</th><th>Stock on Hand</th><th>Status</th></tr></thead>
            <tbody>{stockList.map(p=><tr key={p.id}><td><img className="rthumb" src={p.img} alt={p.name} onError={e=>e.target.src='https://loremflickr.com/80/80/plant'}/>{p.name}</td><td>₹{p.price}</td><td><input className={`sinp ${p.stock<15?'low':''}`} type="number" value={p.stock} onChange={e=>{const v=Math.max(0,parseInt(e.target.value)||0);setProducts(ps=>ps.map(x=>x.id===p.id?{...x,stock:v}:x));}} onBlur={e=>api.updateProduct(p.id,{stock:Math.max(0,parseInt(e.target.value)||0)}).then(()=>toast('Stock saved')).catch(()=>{})}/></td><td><StatusPill status={p.stock<15?'pending':'delivered'}/></td></tr>)}</tbody>
            </table></div>
          </div>}
          {tab==='analytics'&&<div className="panel" style={{textAlign:'center',padding:'60px',color:'var(--text-muted)'}}><div style={{fontSize:'40px',marginBottom:'14px'}}>📊</div><h3 style={{color:'var(--forest)',marginBottom:'8px'}}>Analytics</h3><p>Charts and revenue analytics for your Tamil Nadu nursery would appear here in the full build.</p></div>}
        </div>
      </div>
    </div>
  </>);
}
