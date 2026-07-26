'use client';
import{useState,useEffect}from'react';
import FlatMap from'../../components/FlatMap';
import{useRouter}from'next/navigation';
import{VENDORS_LIST}from'../../lib/data';
import StatusPill from'../../components/StatusPill';
import LeafParticles from'../../components/LeafParticles';
import{toast}from'../../components/Toast';
import api from'../../lib/api';

// Human label for the button that advances an order to its NEXT stage.
const NEXT_ACTION={placed:'Confirm',confirmed:'Mark Packed',packed:'Dispatch',dispatched:'Ship (In Transit)',in_transit:'Out for Delivery',out_for_delivery:'Mark Delivered'};
const PROG={placed:8,confirmed:22,packed:40,dispatched:58,in_transit:76,out_for_delivery:92,delivered:100,cancelled:0};

export default function AdminPage(){
  const router=useRouter();
  const[mobMenuOpen,setMobMenuOpen]=useState(false);
  const[tab,setTab]=useState('logistics');
  const[oQ,setOQ]=useState('');
  const[sQ,setSQ]=useState('');
  const[orders,setOrders]=useState([]);
  const[products,setProducts]=useState([]);
  const[busy,setBusy]=useState(null);

  async function loadOrders(){try{setOrders(await api.orders());}catch(e){}}
  async function loadProducts(){try{setProducts(await api.products());}catch(e){}}
  useEffect(()=>{loadOrders();loadProducts();const t=setInterval(loadOrders,4000);return()=>clearInterval(t);},[]);

  // Advance an order one stage (writes a real tracking event the customer sees live).
  async function advanceOrder(id){
    setBusy(id);
    try{const d=await api.advance(id);toast('Order '+id+' → '+(d.stage?.title||'updated'));await loadOrders();}
    catch(e){toast(e.message);}finally{setBusy(null);}
  }

  const filtered=orders.filter(o=>!oQ||o.id.toLowerCase().includes(oQ.toLowerCase())||(o.customer_name||'').toLowerCase().includes(oQ.toLowerCase()));
  const fstock=products.filter(p=>!sQ||p.name.toLowerCase().includes(sQ.toLowerCase()));
  const revenue=orders.reduce((s,o)=>s+(o.total||0),0);
  const active=orders.filter(o=>o.status!=='delivered'&&o.status!=='cancelled');

  const navItems=[{id:'dashboard',icon:'⊞',l:'Dashboard'},{id:'inventory',icon:'🌿',l:'Inventory'},{id:'logistics',icon:'🚚',l:'Logistics'},{id:'analytics',icon:'📊',l:'Analytics'},{id:'settings',icon:'⚙️',l:'Settings'}];

  return(<>
    <LeafParticles/>
    <div className="dash-shell">
      <div className="dsb">
        <div className="dsb-logo"><div className="icon">🌿</div><div className="name">Agri Mall</div></div>
        <div className="dsb-sub">Logistics Kerala-AP</div>
        <div className="dnav">
          {navItems.map(n=><div key={n.id} className={`si ${tab===n.id?'on':''}`} onClick={()=>setTab(n.id)}><span>{n.icon}</span>{n.l}</div>)}
        </div>
        <div style={{marginTop:'auto',padding:'16px 13px',borderTop:'1px solid rgba(255,255,255,.1)'}}>
          <button className="btn btn-green" style={{width:'100%',justifyContent:'center',gap:'8px',fontSize:'13px'}} onClick={()=>{}}>
            🩺 Diagnose Plant
          </button>
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
          <div style={{fontSize:'11px',opacity:.5,color:'#fff',marginBottom:'8px',textTransform:'uppercase',letterSpacing:'1px'}}>Admin · Full Access</div>
        </div>}
        <div className="dash-topbar">
          <div>
            <h2>{{dashboard:'Dashboard',inventory:'Inventory',logistics:'Logistics & Fulfillment',analytics:'Analytics',settings:'Settings'}[tab]||'Dashboard'}</h2>
            {tab==='logistics'&&<p style={{fontSize:'12px',color:'var(--text-muted)',margin:0}}>Real-time transit monitoring across Southern Hubs</p>}
          </div>
          <div className="dash-topbar-right">
            <button className="hamburger-btn" onClick={()=>setMobMenuOpen(true)} aria-label="Menu">
              <span/><span/><span/>
            </button>
            <div className="dash-search">🔍 Search waybill or SKU…</div>
            <button className="icon-btn" style={{fontSize:'18px'}}>🔔</button>
            <div style={{width:36,height:36,borderRadius:'50%',background:'var(--cream)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>👤</div>
          </div>
        </div>

        <div className="dash-body">

          {tab==='logistics'&&<>
            <div className="kpi-row">
              <div className="kpi"><div className="kpi-icon green">🛒</div><div><div className="kl">Orders Today</div><div className="kv">1,284</div><div className="kd kup">+12.5%</div></div></div>
              <div className="kpi"><div className="kpi-icon orange">🚚</div><div><div className="kl">Transit Volume</div><div className="kv">4.2 Tons</div><div className="kd">8 Routes Active</div></div></div>
              <div className="kpi"><div className="kpi-icon blue">🌿</div><div><div className="kl">Nursery Stock Levels</div><div className="kv">92% Healthy</div><div className="kd kwarn">Low: Jasmine</div></div></div>
            </div>
            <div className="panel" style={{margin:'0 0 20px'}}>
              <div className="ph" style={{marginBottom:'16px'}}>
                <h3>🌍 Global Nursery Network — Satellite View</h3>
                <div style={{display:'flex',gap:'14px',fontSize:'12.5px',fontWeight:600}}>
                  <span style={{color:'var(--green)'}}>● Transit Speed: High</span>
                  <span style={{color:'var(--green)'}}>● Fulfillment: 99.2%</span>
                  <span style={{color:'var(--text-muted)'}}>● Capacity: 98%</span>
                </div>
              </div>
              <FlatMap/>
            </div>
            <div className="panel" style={{margin:0}}>
              <div className="ph"><h3>Active Shipments</h3><div style={{display:'flex',gap:'10px'}}><button style={{background:'var(--cream)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',padding:'7px 14px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>⊞ Filter</button><button style={{background:'var(--cream)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',padding:'7px 14px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>↓ Export CSV</button></div></div>
              <div style={{overflowX:'auto'}}>
                <table><thead><tr><th>Order ID</th><th>Items</th><th>Destination</th><th>Current Hub Status</th><th>Progress</th><th>Action</th></tr></thead>
                <tbody>{active.length===0?<tr><td colSpan={6} style={{textAlign:'center',color:'var(--text-muted)',padding:'20px'}}>No active shipments — all orders delivered.</td></tr>:active.map(o=>(
                  <tr key={o.id}>
                    <td><b>{o.id}</b><br/><span style={{fontSize:'11px',color:'var(--text-muted)'}}>{o.customer_name}</span></td>
                    <td>{o.itemsLabel||'—'}</td>
                    <td>{o.city?o.city+', ':''}{o.region}<br/><span style={{fontSize:'11px',color:'var(--text-muted)'}}>ETA: {o.eta?new Date(o.eta).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'—'}</span></td>
                    <td><StatusPill status={o.status}/></td>
                    <td><div className="prog-bar"><div className="prog-bar-fill" style={{width:(PROG[o.status]||0)+'%'}}/></div></td>
                    <td>{NEXT_ACTION[o.status]?<button disabled={busy===o.id} onClick={()=>advanceOrder(o.id)} style={{background:'var(--forest)',color:'#fff',border:'none',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:600,cursor:'pointer',opacity:busy===o.id?.6:1,whiteSpace:'nowrap'}}>{busy===o.id?'…':NEXT_ACTION[o.status]}</button>:<span style={{fontSize:'12px',color:'var(--green)',fontWeight:600}}>✓ Done</span>}</td>
                  </tr>
                ))}</tbody></table>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'16px',fontSize:'13px',color:'var(--text-muted)'}}>
                <span>Showing {active.length} active shipment{active.length!==1?'s':''} · click the action button to advance a parcel (writes a live tracking event)</span>
                <div style={{display:'flex',gap:'6px'}}>
                  {['‹','1','2','›'].map(b=><button key={b} style={{width:'32px',height:'32px',borderRadius:'6px',border:'1px solid var(--border)',background:b==='1'?'var(--forest)':'#fff',color:b==='1'?'#fff':'var(--text-mid)',cursor:'pointer',fontWeight:600}}>{b}</button>)}
                </div>
              </div>
            </div>
          </>}

          {tab==='dashboard'&&<>
            <div className="kpi-row">
              <div className="kpi"><div className="kpi-icon green">📦</div><div><div className="kl">Total Orders</div><div className="kv">{orders.length}</div><div className="kd kup">{active.length} active</div></div></div>
              <div className="kpi"><div className="kpi-icon orange">💰</div><div><div className="kl">Revenue</div><div className="kv">₹{revenue.toLocaleString('en-IN')}</div><div className="kd kup">live from DB</div></div></div>
              <div className="kpi"><div className="kpi-icon blue">🏬</div><div><div className="kl">Active Vendors</div><div className="kv">{VENDORS_LIST.length}</div><div className="kd">8 countries</div></div></div>
            </div>
            <div className="panel"><div className="ph"><h3>Recent Orders</h3><input className="srch" placeholder="Search order / customer…" value={oQ} onChange={e=>setOQ(e.target.value)}/></div>
              <div style={{overflowX:'auto'}}><table><thead><tr><th>Order</th><th>Customer</th><th>Region</th><th>Items</th><th>Status</th><th>Total</th><th>Action</th></tr></thead>
              <tbody>{filtered.length===0?<tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-muted)',padding:'20px'}}>No orders yet.</td></tr>:filtered.slice(0,12).map(o=><tr key={o.id}><td><b>{o.id}</b></td><td>{o.customer_name}</td><td>{o.region}</td><td>{o.itemsLabel||'—'}</td><td><StatusPill status={o.status}/></td><td>₹{(o.total||0).toLocaleString('en-IN')}</td><td>{NEXT_ACTION[o.status]?<button disabled={busy===o.id} onClick={()=>advanceOrder(o.id)} style={{background:'var(--forest)',color:'#fff',border:'none',borderRadius:'6px',padding:'5px 10px',fontSize:'11.5px',fontWeight:600,cursor:'pointer',opacity:busy===o.id?.6:1,whiteSpace:'nowrap'}}>{busy===o.id?'…':NEXT_ACTION[o.status]}</button>:<span style={{fontSize:'11.5px',color:'var(--green)',fontWeight:600}}>✓</span>}</td></tr>)}</tbody></table></div>
            </div>
          </>}

          {tab==='inventory'&&<div className="panel">
            <div className="ph"><h3>Global Stock — All Nurseries</h3><input className="srch" placeholder="Search plant…" value={sQ} onChange={e=>setSQ(e.target.value)}/></div>
            <div style={{overflowX:'auto'}}><table><thead><tr><th>Plant</th><th>Origin</th><th>Price</th><th>Rating</th><th>Stock (editable)</th></tr></thead>
            <tbody>{fstock.map(p=><tr key={p.id}><td><img className="rthumb" src={p.img} alt={p.name} onError={e=>e.target.src='https://loremflickr.com/80/80/plant'}/>{p.name}</td><td>{p.orig}</td><td>₹{p.price}</td><td>⭐ {p.rating}</td><td><input className={`sinp ${p.stock<15?'low':''}`} type="number" value={p.stock} onChange={e=>{const v=Math.max(0,parseInt(e.target.value)||0);setProducts(ps=>ps.map(x=>x.id===p.id?{...x,stock:v}:x));}} onBlur={e=>api.updateProduct(p.id,{stock:Math.max(0,parseInt(e.target.value)||0)}).then(()=>toast('Stock saved')).catch(()=>{})}/></td></tr>)}</tbody>
            </table></div>
          </div>}

          {(tab==='analytics'||tab==='settings')&&<div className="panel" style={{textAlign:'center',padding:'60px',color:'var(--text-muted)'}}><div style={{fontSize:'40px',marginBottom:'14px'}}>{tab==='analytics'?'📊':'⚙️'}</div><h3 style={{color:'var(--forest)',marginBottom:'8px'}}>{tab==='analytics'?'Analytics':'Settings'}</h3><p>This section would contain {tab==='analytics'?'charts, revenue graphs and conversion funnels':'account settings, notification preferences and API keys'} in the full build.</p></div>}
        </div>
      </div>
    </div>
  </>);
}
