'use client';
import{useState,useEffect,useRef}from'react';
import{useRouter}from'next/navigation';
import{useApp}from'../../lib/AppContext';
import{PRODUCTS,CATEGORIES,NURSERIES,DOCTOR_TIPS}from'../../lib/data';
import LeafParticles from'../../components/LeafParticles';
import{toast}from'../../components/Toast';
import api from'../../lib/api';

const STARS=n=>'★'.repeat(Math.floor(n))+'☆'.repeat(5-Math.floor(n));
const TRACKING_STEPS=[
  {t:'Order Confirmed',d:'Payment received via Agri Mall',icon:'✅',pct:5},
  {t:'Routed to Nursery',d:'Assigned to nearest verified nursery partner',icon:'🌱',pct:25},
  {t:'Packed for Transit',d:'Plant boxed with moisture & phytosanitary care',icon:'📦',pct:45},
  {t:'Dispatched',d:'Handed to courier partner',icon:'🚚',pct:65},
  {t:'In Transit',d:'On the way to your state hub',icon:'✈️',pct:82},
  {t:'Out for Delivery',d:'Arriving at your address today',icon:'🚛',pct:96},
  {t:'Delivered',d:'Your plant has arrived — healthy and ready to grow!',icon:'🌿',pct:100},
];

export default function CustomerPage(){
  const router=useRouter();
  const{state,dispatch}=useApp();
  const[cat,setCat]=useState('all');
  const[cartOpen,setCartOpen]=useState(false);
  const[productModal,setProductModal]=useState(null);
  const[pdQty,setPdQty]=useState(1);
  const[checkoutOpen,setCheckoutOpen]=useState(false);
  const[payOpen,setPayOpen]=useState(false);
  const[trackOpen,setTrackOpen]=useState(false);
  const[doctorOpen,setDoctorOpen]=useState(false);
  const[payTab,setPayTab]=useState('card');
  const[payPhase,setPayPhase]=useState('form');
  const[cardNum,setCardNum]=useState('');
  const[cardName,setCardName]=useState('');
  const[cardExp,setCardExp]=useState('');
  const[trackStep,setTrackStep]=useState(-1);
  const[trackPct,setTrackPct]=useState(0);
  const[trackIcon,setTrackIcon]=useState('📦');
  const[doctorSel,setDoctorSel]=useState(null);
  const[chatMsgs,setChatMsgs]=useState([{role:'bot',text:'Hi! I\'m here to help. Tell me what\'s happening with your plant, or pick a symptom below.'}]);
  const[chatInput,setChatInput]=useState('');
  const[ckName,setCkName]=useState('');
  const[ckPhone,setCkPhone]=useState('');
  const[ckPin,setCkPin]=useState('');
  const[ckAddr,setCkAddr]=useState('');
  const[ckCountry,setCkCountry]=useState('Kerala, India');
  const trackTimers=useRef([]);
  const orderId=useRef('');
  const[wished,setWished]=useState({});
  const[menuOpen,setMenuOpen]=useState(false);
  const[searchOpen,setSearchOpen]=useState(false);
  const[searchQ,setSearchQ]=useState('');
  const[recentViewed,setRecentViewed]=useState([]);
  const[flashTime,setFlashTime]=useState({h:5,m:59,s:42});
  const[trackData,setTrackData]=useState(null); // live order from backend
  const[placing,setPlacing]=useState(false);
  const[trackLookup,setTrackLookup]=useState('');
  const[trackLookupOpen,setTrackLookupOpen]=useState(false);
  const pollTimer=useRef(null);

  const items=cat==='all'?PRODUCTS:PRODUCTS.filter(p=>p.cat===cat);
  const cartIds=Object.keys(state.cart);
  const cartCount=cartIds.reduce((s,id)=>s+state.cart[id],0);
  const subtotal=cartIds.reduce((s,id)=>{const p=PRODUCTS.find(p=>p.id==id);return s+(p?.price||0)*state.cart[id];},0);
  const shipping=subtotal>2000?0:149;

  function addToCart(id,qty=1){
    dispatch({type:'ADD',id,qty});
    const btn=document.getElementById('cartBtn');
    if(btn){btn.style.transform='scale(1.2)';setTimeout(()=>btn.style.transform='',300);}
    toast(PRODUCTS.find(p=>p.id==id)?.name+' added to cart 🌱');
  }
  async function processPayment(){
    // Build the order payload from the real cart.
    const orderItems=cartIds.map(id=>{
      const p=PRODUCTS.find(p=>p.id==id);
      return{product_id:Number(id),name:p?.name||'Plant',qty:state.cart[id],price:p?.price||0,img:p?.img||''};
    });
    if(orderItems.length===0){toast('Your cart is empty');return;}
    setPayPhase('processing');
    setPlacing(true);
    try{
      // Persist a REAL order in the backend database.
      const order=await api.placeOrder({
        customerName:ckName||'Guest',phone:ckPhone,address:ckAddr,pincode:ckPin,
        region:ckCountry,city:(ckAddr.split(',')[1]||'').trim(),payment:payTab,items:orderItems,
      });
      orderId.current=order.id;
      setPayPhase('success');
      setTimeout(()=>{
        setPayOpen(false);setPayPhase('form');dispatch({type:'CLEAR_CART'});
        openTracking(order.id);
      },1200);
    }catch(err){
      setPayPhase('form');
      toast('Could not place order: '+err.message);
    }finally{setPlacing(false);}
  }
  // Open live tracking for a real order and poll the backend for updates.
  function openTracking(id){
    orderId.current=id;
    setTrackOpen(true);setTrackData(null);
    pollOrder(id);
    if(pollTimer.current)clearInterval(pollTimer.current);
    pollTimer.current=setInterval(()=>pollOrder(id),3000);
  }
  async function pollOrder(id){
    try{const d=await api.order(id);setTrackData(d);
      if(d.currentStage==='delivered'&&pollTimer.current){clearInterval(pollTimer.current);pollTimer.current=null;}
    }catch(e){/* keep last known state */}
  }
  async function lookupOrder(){
    const id=trackLookup.trim().toUpperCase();
    if(!id)return;
    try{await api.order(id);openTracking(id);}
    catch(e){toast('Order '+id+' not found');}
  }
  function closeAll(){setCartOpen(false);setProductModal(null);setCheckoutOpen(false);setPayOpen(false);setTrackOpen(false);setDoctorOpen(false);if(pollTimer.current){clearInterval(pollTimer.current);pollTimer.current=null;}}
  function scrollTo(id){const el=document.getElementById(id);if(!el)return;const top=el.getBoundingClientRect().top+window.pageYOffset-70;window.scrollTo({top,behavior:'smooth'});}
  function formatCard(v){const raw=v.replace(/\D/g,'').slice(0,16);setCardNum(raw.replace(/(.{4})/g,'$1 ').trim());}
  function sendChat(msg){
    const m=msg||chatInput; if(!m.trim())return;
    setChatMsgs(prev=>[...prev,{role:'user',text:m}]);
    setChatInput('');
    setTimeout(()=>{
      const tip=DOCTOR_TIPS.find(t=>t.label.toLowerCase().includes(m.toLowerCase().split(' ')[0]))||DOCTOR_TIPS[0];
      setChatMsgs(prev=>[...prev,{role:'bot',text:`Diagnosis: ${tip.diag} — ${tip.advice}`}]);
    },900);
  }
  function openProduct(p){setPdQty(1);setProductModal(p);setRecentViewed(prev=>{const next=[p,...prev.filter(x=>x.id!==p.id)];return next.slice(0,4);});}
  const dispCard=cardNum?cardNum.padEnd(19,'•').slice(0,19):'•••• •••• •••• ••••';

  useEffect(()=>{
    const els=document.querySelectorAll('.reveal');
    if(!('IntersectionObserver'in window)){els.forEach(e=>e.classList.add('in'));return;}
    const io=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.1});
    els.forEach(el=>io.observe(el));
    return()=>io.disconnect();
  },[]);

  useEffect(()=>{
    document.body.classList.add('has-mob-nav');
    return()=>document.body.classList.remove('has-mob-nav');
  },[]);

  // Flash sale countdown
  useEffect(()=>{
    const t=setInterval(()=>setFlashTime(prev=>{
      let{h,m,s}=prev;
      s--; if(s<0){s=59;m--;} if(m<0){m=59;h--;} if(h<0){h=5;m=59;s=59;}
      return{h,m,s};
    }),1000);
    return()=>clearInterval(t);
  },[]);

  return(<>
    <LeafParticles/>
    {/* MOBILE BOTTOM NAV */}
    <div className="mob-nav">
      <div className="mob-nav-inner">
        {[['🏠','Home',()=>{}],['🔍','Search',()=>setSearchOpen(true)],['🛒','Cart',()=>setCartOpen(true)],['🩺','Doctor',()=>setDoctorOpen(true)],['👤','Account',()=>router.push('/')]].map(([ic,l,fn])=>(
          <div key={l} className="mob-nav-item" onClick={fn}><span>{ic}</span>{l}</div>
        ))}
      </div>
    </div>

    {/* TOPBAR */}
    <div className="topbar">
      <div className="topbar-logo">Agri Mall</div>
      <div className="topbar-nav">
        <span onClick={()=>scrollTo('shop')} className="active">Shop</span>
        <span onClick={()=>setDoctorOpen(true)}>Plant Doctor</span>
        <span onClick={()=>scrollTo('nurseries')}>Nurseries</span>
        <span onClick={()=>setTrackLookupOpen(true)}>Track Order</span>
        <span onClick={()=>scrollTo('how')}>How It Works</span>
      </div>
      <div className="topbar-right">
        <div className="topbar-search" style={{cursor:'pointer'}} onClick={()=>setSearchOpen(true)}>🔍 Search plants, seeds, tools…</div>
        <button id="cartBtn" className="icon-btn" onClick={()=>setCartOpen(true)}>
          🛒{cartCount>0&&<span className="cart-badge">{cartCount}</span>}
        </button>
        <button className="icon-btn" onClick={()=>router.push('/')}>👤</button>
        <button className="hamburger-btn" onClick={()=>setMenuOpen(true)} aria-label="Open menu">
          <span/><span/><span/>
        </button>
      </div>
    </div>

    {/* FLASH SALE BANNER */}
    <div style={{background:'linear-gradient(90deg,#1C3829,#2A7D4F,#1C3829)',color:'#fff',padding:'10px 24px',display:'flex',alignItems:'center',justifyContent:'center',gap:'20px',fontSize:'13.5px',fontWeight:600,position:'relative',zIndex:1}}>
      <span style={{background:'#E53E3E',color:'#fff',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:800,textTransform:'uppercase',letterSpacing:'1px'}}>⚡ Flash Sale</span>
      <span>Up to 40% off on Indoor Plants — Today Only!</span>
      <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
        <span style={{opacity:.8,fontSize:'12px'}}>Ends in:</span>
        {['h','m','s'].map((u,i)=>(
          <div key={u} style={{background:'rgba(0,0,0,0.4)',borderRadius:'6px',padding:'4px 9px',fontFamily:'monospace',fontSize:'16px',minWidth:'38px',textAlign:'center'}}>
            {String([flashTime.h,flashTime.m,flashTime.s][i]).padStart(2,'0')}<div style={{fontSize:'8px',opacity:.7,letterSpacing:'1px',textTransform:'uppercase'}}>{u}</div>
          </div>
        ))}
      </div>
      <button onClick={()=>setCat('indoor')} style={{background:'#fff',color:'var(--forest)',padding:'6px 14px',borderRadius:'6px',fontSize:'12px',fontWeight:700,border:'none',cursor:'pointer',flexShrink:0}}>Shop Now →</button>
    </div>

    {/* HERO */}
    <div className="hero-banner">
      <img src="https://loremflickr.com/1400/500/indoor,plants,livingroom,modern" alt="plants" onError={e=>{e.target.style.background='#2D6A4F';e.target.style.height='100%';}}/>
      <div className="hero-overlay">
        <div className="hero-content">
          <div className="hero-badge">🌿 Seasonal Picks</div>
          <h1>Bestselling<br/>Indoor Plants</h1>
          <p>Transform your living space with our hand-picked selection of low-maintenance, air-purifying greenery. Delivered fresh from nurseries to your door.</p>
          <div className="hero-btns">
            <button className="btn btn-forest" onClick={()=>scrollTo('shop')}>Shop Best Sellers →</button>
            <button className="btn btn-ghost" onClick={()=>setDoctorOpen(true)}>View Care Guides</button>
          </div>
        </div>
      </div>
    </div>

    {/* CATEGORIES */}
    <div className="section" id="shop">
      <div className="section-head reveal"><h2>Shop by Category</h2><span className="see-all">See All Categories →</span></div>
      <div className="cat-grid reveal">
        {CATEGORIES.map(c=>(
          <div className="cat-tile" key={c.id} onClick={()=>setCat(c.id)}>
            <img src={c.img} alt={c.label} onError={e=>e.target.src='https://loremflickr.com/300/200/plants,garden'}/>
            <div className="cat-tile-label">{c.label}</div>
          </div>
        ))}
      </div>
    </div>

    {/* PLANT DOCTOR BANNER */}
    <div className="section" style={{paddingTop:0}}>
      <div className="pd-banner reveal">
        <div className="pd-banner-icon">🩺</div>
        <div className="pd-banner-text">
          <h3>Plant Doctor Diagnostic</h3>
          <p>Is your plant looking a bit yellow? Chat with our AI-powered plant doctor for an instant diagnosis.</p>
        </div>
        <button className="btn btn-forest" onClick={()=>setDoctorOpen(true)}>Diagnose My Plant</button>
      </div>
    </div>

    {/* PRODUCTS */}
    <div className="section">
      <div className="sort-bar reveal">
        <h2>Top Sellers in Kerala</h2>
        <div className="sort-select">
          Sort by: <select defaultValue="popular"><option value="popular">Popular</option><option value="price">Price</option><option value="rating">Rating</option></select>
        </div>
      </div>
      {/* filter pills */}
      <div style={{display:'flex',gap:'9px',flexWrap:'wrap',marginBottom:'20px'}}>
        {['all','indoor','flowering','fruit','succulent','exotic'].map(c=>(
          <div key={c} onClick={()=>setCat(c)} style={{padding:'7px 16px',borderRadius:'999px',cursor:'pointer',fontSize:'13px',fontWeight:500,border:'1.5px solid',borderColor:cat===c?'var(--forest)':'var(--border)',background:cat===c?'var(--forest)':'#fff',color:cat===c?'#fff':'var(--text-muted)',transition:'.18s'}}>
            {c.charAt(0).toUpperCase()+c.slice(1)}
          </div>
        ))}
      </div>
      <div className="products-grid">
        {items.map((p,i)=>(
          <div className="pcard reveal" key={p.id} style={{transitionDelay:`${(i%4)*.07}s`}} onClick={()=>openProduct(p)}>
            <div className="pcard-img">
              <div className="pcard-badge">Kerala Fast Shipping</div>
              <div className="pcard-wish" onClick={e=>{e.stopPropagation();setWished(w=>({...w,[p.id]:!w[p.id]}));}}>
                {wished[p.id]?'❤️':'🤍'}
              </div>
              <img src={p.img} alt={p.name} loading="lazy" onError={e=>e.target.src='https://loremflickr.com/600/600/plant,nursery'}/>
            </div>
            <div className="pcard-body">
              <div className="pcard-stars">
                <span className="stars">{STARS(p.rating)}</span>
                <span className="star-count">({p.reviews})</span>
              </div>
              <div className="pcard-name">{p.name}</div>
              <div className="pcard-lat">{p.lat}</div>
              <div className="pcard-foot">
                <div className="pcard-price">₹{p.price.toLocaleString('en-IN')}<s>₹{p.mrp.toLocaleString('en-IN')}</s></div>
                <div className="cart-circle" onClick={e=>{e.stopPropagation();addToCart(p.id);}}>🛒</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* TRUST BAR */}
    <div className="trust-bar reveal">
      {[['🚚','Eco-Friendly Shipping','Carbon-neutral delivery in recycled fiber packaging.'],['🛡️','30-Day Guarantee','Not happy? We\'ll replace your plant or refund your money.'],['💬','Expert Support','Chat with our horticulturalists 24/7 for expert advice.'],['🪴','Pre-Potted Ease','Most plants arrive in designer pots ready for display.']].map(([ic,h,p])=>(
        <div className="trust-item" key={h}>
          <div className="trust-icon">{ic}</div>
          <div><h4>{h}</h4><p>{p}</p></div>
        </div>
      ))}
    </div>

    {/* HOW IT WORKS */}
    <div id="how" style={{background:'var(--forest)',position:'relative',zIndex:1}}>
      <div className="section">
        <div className="section-head reveal" style={{color:'#fff'}}><h2 style={{color:'#fff'}}>How Agri Mall Works</h2></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'18px'}}>
          {[['01','Order Online','Browse 500+ plant varieties and order in minutes from app or web.'],['02','Nursery Routes','We route to the nearest verified AP or Kerala nursery automatically.'],['03','Fresh Packing','Plants packed same day with phytosanitary care for transit.'],['04','Kerala Delivery','Delivered to your door in 3–5 days. Healthy, guaranteed.']].map(([n,t,d])=>(
            <div key={n} className="reveal" style={{background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.12)',borderRadius:'var(--radius-lg)',padding:'22px'}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:'28px',color:'var(--gold)',fontWeight:700,marginBottom:'10px'}}>{n}</div>
              <h4 style={{color:'#fff',marginBottom:'7px',fontSize:'16px'}}>{t}</h4>
              <p style={{fontSize:'13px',opacity:.72,lineHeight:1.55,margin:0,color:'#fff'}}>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* NURSERIES */}
    <div className="section" id="nurseries">
      <div className="section-head reveal"><h2>Our Global Nursery Network</h2><span className="see-all">View All Partners →</span></div>
      <p style={{color:'var(--text-muted)',fontSize:'14px',marginBottom:'24px',marginTop:'-16px'}}>Every plant sourced from a verified, hand-picked nursery partner</p>
      <div className="products-grid">
        {NURSERIES.map((n,i)=>(
          <div key={i} className="pcard reveal" style={{transitionDelay:`${(i%4)*.07}s`,cursor:'default'}}>
            <div className="pcard-img">
              <img src={n.img} alt={n.name} loading="lazy" onError={e=>e.target.src='https://loremflickr.com/600/400/nursery,plants'}/>
            </div>
            <div className="pcard-body">
              <div className="pcard-name">{n.name}</div>
              <div className="pcard-lat">📍 {n.loc}</div>
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'8px'}}>
                {n.tags.map(t=><span key={t} style={{background:'var(--green-light)',color:'var(--green)',fontSize:'10.5px',fontWeight:600,padding:'3px 9px',borderRadius:'999px'}}>{t}</span>)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* RECENTLY VIEWED */}
    {recentViewed.length>0&&(
      <div className="section" style={{paddingTop:0}}>
        <div className="section-head reveal"><h2>Recently Viewed</h2></div>
        <div className="products-grid">
          {recentViewed.map((p,i)=>(
            <div className="pcard reveal" key={p.id} style={{transitionDelay:`${i*.07}s`}} onClick={()=>openProduct(p)}>
              <div className="pcard-img">
                <div className="pcard-badge">Viewed</div>
                <img src={p.img} alt={p.name} loading="lazy" onError={e=>e.target.src='https://loremflickr.com/600/600/plant'}/>
              </div>
              <div className="pcard-body">
                <div className="pcard-stars"><span className="stars">{'★'.repeat(Math.floor(p.rating))}{'☆'.repeat(5-Math.floor(p.rating))}</span><span className="star-count">({p.reviews})</span></div>
                <div className="pcard-name">{p.name}</div>
                <div className="pcard-foot">
                  <div className="pcard-price">₹{p.price.toLocaleString('en-IN')}<s>₹{p.mrp.toLocaleString('en-IN')}</s></div>
                  <div className="cart-circle" onClick={e=>{e.stopPropagation();addToCart(p.id);}}>🛒</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* DEAL OF THE DAY */}
    <div className="section" style={{paddingTop:0}}>
      <div style={{background:'linear-gradient(135deg,#1C3829 0%,#2A7D4F 100%)',borderRadius:'var(--radius-lg)',padding:'30px 36px',display:'flex',alignItems:'center',gap:'32px',flexWrap:'wrap'}}>
        <div style={{flex:'0 0 180px',height:'180px',borderRadius:'12px',overflow:'hidden'}}>
          <img src="https://loremflickr.com/400/400/monstera,plant,luxury" alt="Deal" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.src='https://loremflickr.com/400/400/plant,green'}/>
        </div>
        <div style={{flex:1,color:'#fff'}}>
          <div style={{background:'#E53E3E',display:'inline-block',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:800,textTransform:'uppercase',letterSpacing:'1px',marginBottom:'12px'}}>🔥 Deal of the Day</div>
          <h2 style={{color:'#fff',fontSize:'28px',marginBottom:'6px'}}>Monstera Deliciosa</h2>
          <p style={{opacity:.8,fontSize:'13.5px',marginBottom:'14px'}}>The iconic split-leaf Monstera — limited stock, exclusive price today only. Sourced from our Chiang Mai partner nursery.</p>
          <div style={{display:'flex',alignItems:'baseline',gap:'12px',marginBottom:'18px'}}>
            <span style={{fontSize:'32px',fontWeight:700}}>₹1,299</span>
            <span style={{fontSize:'18px',opacity:.6,textDecoration:'line-through'}}>₹2,499</span>
            <span style={{background:'#E53E3E',color:'#fff',padding:'3px 9px',borderRadius:'5px',fontSize:'13px',fontWeight:700}}>48% OFF</span>
          </div>
          <button className="btn btn-forest" style={{background:'#fff',color:'var(--forest)'}} onClick={()=>addToCart(5)}>Add to Cart 🛒</button>
        </div>
      </div>
    </div>

    {/* SEARCH MODAL */}
    {searchOpen&&(
      <div className="mov open" onClick={e=>e.target.className.includes('mov')&&(setSearchOpen(false),setSearchQ(''))}>
        <div className="mbox" style={{maxWidth:'600px'}}>
          <h2 style={{marginBottom:'14px'}}>Search Plants</h2>
          <input autoFocus value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search by plant name, type…" style={{width:'100%',padding:'14px 16px',border:'1.5px solid var(--border)',borderRadius:'var(--radius-sm)',fontSize:'15px',fontFamily:"'Inter',sans-serif",marginBottom:'16px',outline:'none'}} onKeyDown={e=>e.key==='Escape'&&setSearchOpen(false)}/>
          {searchQ.trim()&&(()=>{
            const res=PRODUCTS.filter(p=>p.name.toLowerCase().includes(searchQ.toLowerCase())||p.cat.toLowerCase().includes(searchQ.toLowerCase())||p.orig.toLowerCase().includes(searchQ.toLowerCase()));
            return res.length===0
              ?<div style={{textAlign:'center',padding:'28px',color:'var(--text-muted)'}}>No results for &ldquo;{searchQ}&rdquo;</div>
              :<div style={{display:'flex',flexDirection:'column',gap:'10px',maxHeight:'380px',overflowY:'auto'}}>
                {res.map(p=>(
                  <div key={p.id} style={{display:'flex',gap:'12px',alignItems:'center',padding:'12px',borderRadius:'var(--radius-sm)',cursor:'pointer',transition:'.18s',border:'1px solid var(--border)'}} onClick={()=>{setSearchOpen(false);setSearchQ('');openProduct(p);}}>
                    <img src={p.img} alt={p.name} style={{width:'54px',height:'54px',borderRadius:'8px',objectFit:'cover'}} onError={e=>e.target.src='https://loremflickr.com/80/80/plant'}/>
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:'14px'}}>{p.name}</div><div style={{fontSize:'12px',color:'var(--text-muted)'}}>{p.lat} · {p.orig}</div></div>
                    <div style={{fontSize:'16px',fontWeight:700,color:'var(--forest)'}}>₹{p.price}</div>
                  </div>
                ))}
              </div>;
          })()}
          {!searchQ.trim()&&<div style={{color:'var(--text-muted)',fontSize:'13.5px',textAlign:'center',padding:'20px 0'}}>Start typing to search 500+ plants…</div>}
        </div>
      </div>
    )}

    {/* FOOTER */}
    <div className="footer">
      <div className="footer-grid">
        <div className="footer-brand"><h3>Agri Mall</h3><p>Bridging the gap between heritage nurseries and modern homes across India. Fresh plants, verified sourcing, nationwide delivery.</p></div>
        <div className="footer-col"><h4>Platform</h4><ul><li>Shop Plants</li><li>Plant Doctor AI</li><li>Vendor Portal</li><li>Bulk Procurement</li></ul></div>
        <div className="footer-col"><h4>Support</h4><ul><li>Shipping Policy</li><li>Refund Guarantee</li><li>Care Guides</li><li>Contact Us</li></ul></div>
        <div className="footer-col"><h4>Newsletter</h4><p style={{fontSize:'13px',marginBottom:'12px',opacity:.7}}>Get weekly growth tips and exclusive offers.</p><div className="footer-newsletter"><input placeholder="Email address"/><button>Join</button></div></div>
      </div>
      <div className="footer-bottom">© 2025 Agri Mall · Also known as Plant Doctor · Website + Android App</div>
    </div>

    {/* MOBILE NAV DRAWER */}
    <div className={`mob-drawer-ov ${menuOpen?'open':''}`} onClick={()=>setMenuOpen(false)}/>
    <div className={`mob-drawer ${menuOpen?'open':''}`}>
      <div className="mob-drawer-head">
        <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:'19px',color:'var(--forest)'}}>🌿 Agri Mall</div>
        <button className="close-x" onClick={()=>setMenuOpen(false)}>✕</button>
      </div>
      <div className="mob-drawer-body">
        <div className="mob-search-bar" onClick={()=>{setMenuOpen(false);setSearchOpen(true);}}>
          <span>🔍</span><span>Search plants, seeds, tools…</span>
        </div>
        {[['🏪','Shop',()=>{setMenuOpen(false);smoothScroll('shop');}],
          ['🩺','Plant Doctor',()=>{setMenuOpen(false);setDoctorOpen(true);}],
          ['🌍','Global Nurseries',()=>{setMenuOpen(false);smoothScroll('nurseries');}],
          ['📦','How It Works',()=>{setMenuOpen(false);smoothScroll('how');}],
          ['🛒',`Cart (${cartCount})`,()=>{setMenuOpen(false);setCartOpen(true);}],
          ['👤','Switch Role / Account',()=>router.push('/')],
        ].map(([ic,l,fn])=>(
          <div key={l} className="mob-menu-item" onClick={fn}>
            <span className="mob-menu-ic">{ic}</span>
            <span className="mob-menu-label">{l}</span>
            <span className="mob-menu-arr">›</span>
          </div>
        ))}
        <div style={{marginTop:'auto',padding:'18px 0 0',borderTop:'1px solid var(--border)',fontSize:'11.5px',color:'var(--text-muted)',textAlign:'center'}}>
          Agri Mall · Global Plant Marketplace
        </div>
      </div>
    </div>

    {/* OVERLAY */}
    <div className={`overlay ${cartOpen||productModal||checkoutOpen||payOpen||trackOpen||doctorOpen?'open':''}`} onClick={closeAll}/>

    {/* CART */}
    <div className={`drawer ${cartOpen?'open':''}`}>
      <div className="drawer-head"><h3>Your Cart</h3><button className="close-x" onClick={()=>setCartOpen(false)}>✕</button></div>
      <div className="drawer-body">
        {cartIds.length===0?<div className="empty-cart">🌱<br/>Your cart is empty.<br/>Add some plants to get started.</div>
        :cartIds.map(id=>{const p=PRODUCTS.find(p=>p.id==id);if(!p)return null;return(
          <div className="cart-item" key={id}>
            <div className="cart-thumb"><img src={p.img} alt={p.name} onError={e=>e.target.src='https://loremflickr.com/80/80/plant'}/></div>
            <div className="cart-info" style={{flex:1}}>
              <div className="cn">{p.name}</div>
              <div className="cp">{p.orig} · ₹{p.price}</div>
              <div className="qty-ctrl">
                <button onClick={()=>dispatch({type:'SET_QTY',id:parseInt(id),qty:state.cart[id]-1})}>−</button>
                <span>{state.cart[id]}</span>
                <button onClick={()=>dispatch({type:'ADD',id:parseInt(id)})}>+</button>
                <button className="rm-btn" onClick={()=>dispatch({type:'REMOVE',id:parseInt(id)})}>Remove</button>
              </div>
            </div>
          </div>
        );})}
      </div>
      {cartIds.length>0&&<div className="drawer-foot">
        <div className="sum-row"><span>Subtotal</span><span>₹{subtotal.toLocaleString('en-IN')}</span></div>
        <div className="sum-row"><span>Shipping</span><span>{shipping===0?'Free':'₹'+shipping}</span></div>
        <div className="sum-row total"><span>Total</span><span>₹{(subtotal+shipping).toLocaleString('en-IN')}</span></div>
        <button className="cta-full" onClick={()=>{setCartOpen(false);setCheckoutOpen(true);}}>Proceed to Checkout</button>
      </div>}
    </div>

    {/* PRODUCT DETAIL MODAL */}
    {productModal&&<div className="mov open" onClick={e=>e.target.className.includes('mov')&&setProductModal(null)}>
      <div className="mbox wide">
        <button className="close-x mclose" onClick={()=>setProductModal(null)}>✕</button>
        <div style={{display:'flex',gap:'24px',flexWrap:'wrap'}}>
          <div style={{flex:'0 0 280px'}}>
            <div style={{borderRadius:'var(--radius-lg)',overflow:'hidden',height:'300px',background:'var(--cream)',marginBottom:'10px'}}>
              <img src={productModal.img} alt={productModal.name} style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.src='https://loremflickr.com/600/600/plant'}/>
            </div>
          </div>
          <div style={{flex:1,minWidth:'260px'}}>
            <div style={{display:'inline-flex',alignItems:'center',gap:'6px',background:'var(--green-light)',color:'var(--green)',fontSize:'12px',fontWeight:700,padding:'4px 12px',borderRadius:'999px',marginBottom:'10px'}}>⭐ Premium Selection</div>
            <h2 style={{margin:'0 0 3px',fontSize:'28px'}}>{productModal.name}</h2>
            <div style={{fontStyle:'italic',color:'var(--text-muted)',fontSize:'14px',marginBottom:'12px'}}>{productModal.lat}</div>
            <div style={{display:'flex',alignItems:'baseline',gap:'10px',marginBottom:'10px'}}>
              <span style={{fontSize:'28px',fontWeight:700,color:'var(--forest)'}}>₹{productModal.price.toLocaleString('en-IN')}</span>
              <span style={{fontSize:'15px',color:'#aaa',textDecoration:'line-through'}}>₹{productModal.mrp.toLocaleString('en-IN')}</span>
              <span style={{background:'#FFF0E8',color:'var(--orange)',fontSize:'12px',fontWeight:700,padding:'2px 8px',borderRadius:'5px'}}>{Math.round((1-productModal.price/productModal.mrp)*100)}% OFF</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'13px',marginBottom:'14px',paddingBottom:'14px',borderBottom:'1px solid var(--border)'}}>
              <span style={{color:'var(--gold)'}}>{STARS(productModal.rating)}</span>
              <span style={{color:'var(--text-muted)'}}>{productModal.rating} ({productModal.reviews} Reviews)</span>
              <span style={{color:'var(--text-muted)'}}>📍 {productModal.orig}</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px',marginBottom:'14px'}}>
              {[['☀️','Light',productModal.light],['💧','Water',productModal.water],['🌡️','Temp',productModal.temp],['🐾','Safety',productModal.safety]].map(([ic,l,v])=>(
                <div key={l} style={{background:'var(--cream)',borderRadius:'var(--radius-sm)',padding:'10px',textAlign:'center'}}>
                  <div style={{fontSize:'16px',marginBottom:'4px'}}>{ic}</div>
                  <div style={{fontSize:'9.5px',textTransform:'uppercase',color:'var(--text-muted)',fontWeight:600,marginBottom:'2px'}}>{l}</div>
                  <div style={{fontSize:'11.5px',fontWeight:600}}>{v}</div>
                </div>
              ))}
            </div>
            <p style={{fontSize:'13.5px',color:'var(--text-muted)',lineHeight:1.65,marginBottom:'14px'}}>{productModal.desc}</p>
            <div style={{background:'var(--cream)',borderRadius:'var(--radius-sm)',padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
              <div><b style={{fontSize:'13.5px'}}>Delivery to Kerala</b><div style={{fontSize:'12px',color:'var(--text-muted)'}}>Standard Shipping (3–5 Days)</div></div>
              <div style={{textAlign:'right'}}><div style={{color:'var(--green)',fontWeight:700,fontSize:'13.5px'}}>Free Delivery</div><div style={{fontSize:'11.5px',color:'var(--text-muted)'}}>Est. within 5 days</div></div>
            </div>
            <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
              <div style={{display:'flex',border:'1.5px solid var(--border)',borderRadius:'var(--radius-sm)',overflow:'hidden'}}>
                <button style={{width:'38px',height:'42px',background:'var(--cream)',fontSize:'16px',fontWeight:700,border:'none',cursor:'pointer'}} onClick={()=>setPdQty(q=>Math.max(1,q-1))}>−</button>
                <span style={{width:'42px',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600}}>{pdQty}</span>
                <button style={{width:'38px',height:'42px',background:'var(--cream)',fontSize:'16px',fontWeight:700,border:'none',cursor:'pointer'}} onClick={()=>setPdQty(q=>q+1)}>+</button>
              </div>
              <button style={{flex:1,background:'var(--forest)',color:'#fff',padding:'12px',borderRadius:'var(--radius-sm)',fontWeight:600,fontSize:'14.5px',border:'none',cursor:'pointer',transition:'.18s'}} onClick={()=>{addToCart(productModal.id,pdQty);setProductModal(null);}}>🛒 Add to Cart</button>
            </div>
            {/* Reviews */}
            <div style={{marginTop:'22px',borderTop:'1px solid var(--border)',paddingTop:'18px'}}>
              <h4 style={{fontFamily:"'Inter',sans-serif",fontSize:'15px',fontWeight:700,marginBottom:'14px',color:'var(--forest)'}}>Customer Reviews</h4>
              {[{n:'Priya M.',r:5,t:'Arrived in perfect condition! The leaves were fresh and healthy.',d:'2 days ago'},{n:'Rahul K.',r:4,t:'Great quality plant. Packaging was excellent, stem intact.',d:'1 week ago'},{n:'Aisha T.',r:5,t:'Exactly what I ordered. Very happy with the purchase!',d:'2 weeks ago'}].map((rv,i)=>(
                <div key={i} style={{borderBottom:'1px solid var(--border)',paddingBottom:'12px',marginBottom:'12px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}>
                    <span style={{fontWeight:600,fontSize:'13.5px'}}>{rv.n}</span>
                    <span style={{fontSize:'11.5px',color:'var(--text-muted)'}}>{rv.d}</span>
                  </div>
                  <div style={{color:'var(--gold)',fontSize:'12px',marginBottom:'4px'}}>{'★'.repeat(rv.r)}{'☆'.repeat(5-rv.r)}</div>
                  <p style={{fontSize:'13px',color:'var(--text-muted)',margin:0}}>{rv.t}</p>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:'10px',alignItems:'center',marginTop:'0'}}>
            </div>
          </div>
        </div>
      </div>
    </div>}

    {/* CHECKOUT */}
    {checkoutOpen&&<div className="mov open" onClick={e=>e.target.className.includes('mov')&&setCheckoutOpen(false)}>
      <div className="mbox">
        <button className="close-x mclose" onClick={()=>setCheckoutOpen(false)}>✕</button>
        <h2>Checkout</h2><p className="msub">Delivery address</p>
        <div className="field"><label>Full Name</label><input value={ckName} onChange={e=>setCkName(e.target.value)} placeholder="e.g. Anjali Menon"/></div>
        <div className="frow">
          <div className="field"><label>Phone</label><input value={ckPhone} onChange={e=>setCkPhone(e.target.value)} placeholder="+91 98xx xxxxxx"/></div>
          <div className="field"><label>PIN Code</label><input value={ckPin} onChange={e=>setCkPin(e.target.value)} placeholder="682001"/></div>
        </div>
        <div className="field"><label>Address</label><input value={ckAddr} onChange={e=>setCkAddr(e.target.value)} placeholder="Street, City"/></div>
        <div className="field"><label>State / Country</label>
          <select value={ckCountry} onChange={e=>setCkCountry(e.target.value)}>
            {['Kerala, India','Tamil Nadu, India','Andhra Pradesh, India','Karnataka, India','Maharashtra, India','Other India State','Germany','United States','UAE','Singapore'].map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="cta-full" onClick={()=>{if(!ckName.trim()){alert('Please enter your name.');return;}setCheckoutOpen(false);setPayOpen(true);}}>Continue to Payment →</button>
      </div>
    </div>}

    {/* PAYMENT */}
    {payOpen&&<div className="mov open" onClick={e=>e.target.className.includes('mov')&&setPayOpen(false)}>
      <div className="mbox">
        <button className="close-x mclose" onClick={()=>setPayOpen(false)}>✕</button>
        {payPhase==='form'&&<>
          <h2>Payment</h2><p className="msub">Demo gateway · no real charges made</p>
          <div className="pay-tabs">
            {[['card','💳 Card'],['upi','📱 UPI'],['cod','💵 Cash on Delivery']].map(([id,l])=>(
              <div key={id} className={`pay-tab ${payTab===id?'on':''}`} onClick={()=>setPayTab(id)}>{l}</div>
            ))}
          </div>
          {payTab==='card'&&<>
            <div className="card-preview">
              <div className="chip"/>
              <div className="cpnum">{dispCard}</div>
              <div className="cpbot"><span>{cardName||'YOUR NAME'}</span><span>{cardExp||'MM/YY'}</span></div>
            </div>
            <div className="field"><label>Card Number</label><input value={cardNum} onChange={e=>formatCard(e.target.value)} placeholder="4242 4242 4242 4242" maxLength={19}/></div>
            <div className="frow">
              <div className="field"><label>Name on Card</label><input value={cardName} onChange={e=>setCardName(e.target.value)} placeholder="Full name"/></div>
              <div className="field"><label>Expiry</label><input value={cardExp} onChange={e=>setCardExp(e.target.value)} placeholder="MM/YY" maxLength={5}/></div>
              <div className="field"><label>CVV</label><input type="password" maxLength={3} placeholder="123"/></div>
            </div>
          </>}
          {payTab==='upi'&&<div className="field"><label>UPI ID</label><input placeholder="yourname@upi"/></div>}
          {payTab==='cod'&&<p style={{fontSize:'13.5px',color:'var(--text-muted)',padding:'12px 0'}}>Pay in cash when your plant is delivered to your doorstep.</p>}
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'15px',fontWeight:600,color:'var(--text)',margin:'16px 0',padding:'14px',background:'var(--cream)',borderRadius:'var(--radius-sm)'}}>
            <span>Total Due</span><span>₹{(subtotal+shipping).toLocaleString('en-IN')}</span>
          </div>
          <button className="cta-full" onClick={processPayment}>Pay Now</button>
        </>}
        {payPhase==='processing'&&<div className="pay-processing"><div className="spinner"/><p style={{fontWeight:600,color:'var(--forest)'}}>Processing your payment…</p><p style={{fontSize:'12.5px',color:'var(--text-muted)'}}>Please don&apos;t close this window</p></div>}
        {payPhase==='success'&&<div className="pay-success"><div className="check-circle"><svg viewBox="0 0 24 24" fill="none" width="34" height="34"><path d="M4 12.5L9.5 18L20 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div><h3 style={{color:'var(--forest)',margin:'0 0 6px'}}>Payment Successful!</h3><p style={{fontSize:'13px',color:'var(--text-muted)'}}>Redirecting to your live order tracking…</p></div>}
      </div>
    </div>}

    {/* LIVE TRACKING — reads the real order + tracking events from the backend */}
    {trackOpen&&<div className="mov open" onClick={e=>e.target.className.includes('mov')&&(setTrackOpen(false),pollTimer.current&&clearInterval(pollTimer.current))}>
      <div className="mbox">
        <button className="close-x mclose" onClick={()=>{setTrackOpen(false);pollTimer.current&&clearInterval(pollTimer.current);}}>✕</button>
        {(()=>{
          const pct=trackData?.progress??0;
          const stage=trackData?.currentTitle||'Order Placed';
          const ladder=trackData?.ladder||[];
          const events=trackData?.order?.tracking||[];
          const eta=trackData?.eta;
          const etaTxt=eta?new Date(eta).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'}):'—';
          const delivered=trackData?.currentStage==='delivered';
          const stageIcon={placed:'📝',confirmed:'✅',packed:'📦',dispatched:'🚚',in_transit:'✈️',out_for_delivery:'🛻',delivered:'🌿'}[trackData?.currentStage]||'📦';
          return(<>
            <h2>{delivered?'Delivered 🌿':'Order Confirmed 🌿'}</h2>
            <p className="msub">Order #{orderId.current} · Live tracking {!delivered&&<span style={{color:'var(--green)'}}>● updating</span>}</p>
            {!trackData&&<div style={{textAlign:'center',padding:'30px',color:'var(--text-muted)'}}><div className="spinner" style={{margin:'0 auto 12px'}}/>Loading live status…</div>}
            {trackData&&<>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--cream)',borderRadius:'var(--radius-sm)',padding:'12px 14px',marginBottom:'6px'}}>
                <div><div style={{fontSize:'11px',textTransform:'uppercase',color:'var(--text-muted)',fontWeight:600,letterSpacing:'.5px'}}>Current status</div><div style={{fontWeight:700,color:'var(--forest)',fontSize:'15px'}}>{stageIcon} {stage}</div></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:'11px',textTransform:'uppercase',color:'var(--text-muted)',fontWeight:600,letterSpacing:'.5px'}}>{delivered?'Delivered on':'Expected arrival'}</div><div style={{fontWeight:700,color:'var(--forest)',fontSize:'15px'}}>{etaTxt}</div></div>
              </div>
              <div className="track-map">
                <svg viewBox="0 0 360 130" style={{width:'100%',height:'140px'}}>
                  <path d="M30 105 C 100 30, 250 30, 330 25" className="track-path-bg"/>
                  <path d="M30 105 C 100 30, 250 30, 330 25" className="track-path-fill" style={{strokeDasharray:340,strokeDashoffset:340-(340*pct/100)}}/>
                  <circle cx="30" cy="105" r="5" fill="var(--forest)"/>
                  <circle cx="330" cy="25" r="5" fill="var(--green)"/>
                  <text x={30+(300*pct/100)-10} y={105-(80*pct/100)-8} fontSize="18">{stageIcon}</text>
                </svg>
                <div className="track-lbl"><span>Nursery · AP/Kerala</span><span>You · {trackData?.order?.region||ckCountry}</span></div>
                <div className="track-pct">{pct}% on the way</div>
              </div>
              {trackData?.currentStage==='placed'&&<div style={{fontSize:'12.5px',color:'var(--text-muted)',textAlign:'center',padding:'8px 0'}}>⏳ Waiting for the seller to confirm your order. Tracking advances as the nursery & courier update it.</div>}
              <div className="track-line">
                {ladder.map((s,i)=>{
                  const ev=events.find(e=>e.stage===s.key);
                  return(
                    <div key={i} className={`ti ${s.done||s.current?'on':''} ${s.current?'cur':''}`}>
                      <h4>{s.icon} {s.title}</h4><p>{s.note}</p>
                      <div className="ttime">{ev?new Date(ev.at).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+(ev.location?' · '+ev.location:''):(s.current?'in progress':'pending')}</div>
                    </div>
                  );
                })}
              </div>
            </>}
          </>);
        })()}
      </div>
    </div>}

    {/* TRACK ORDER LOOKUP */}
    {trackLookupOpen&&<div className="mov open" onClick={e=>e.target.className.includes('mov')&&setTrackLookupOpen(false)}>
      <div className="mbox" style={{maxWidth:'440px'}}>
        <button className="close-x mclose" onClick={()=>setTrackLookupOpen(false)}>✕</button>
        <h2>Track Your Order</h2>
        <p className="msub">Enter your order ID (e.g. AGM-4821) to see live status.</p>
        <div className="field"><label>Order ID</label><input value={trackLookup} onChange={e=>setTrackLookup(e.target.value)} placeholder="AGM-XXXX" onKeyDown={e=>e.key==='Enter'&&(setTrackLookupOpen(false),lookupOrder())}/></div>
        <button className="cta-full" onClick={()=>{setTrackLookupOpen(false);lookupOrder();}}>Track →</button>
      </div>
    </div>}

    {/* PLANT DOCTOR CHAT */}
    {doctorOpen&&<div className="mov open" onClick={e=>e.target.className.includes('mov')&&setDoctorOpen(false)}>
      <div className="mbox wide">
        <button className="close-x mclose" onClick={()=>setDoctorOpen(false)}>✕</button>
        <h2>Plant Doctor 🩺</h2>
        <p className="msub">Upload a photo or describe your plant&apos;s symptoms for an instant AI diagnosis.</p>
        <div className="doc-page">
          <div>
            <div className="doc-upload">
              <div className="doc-upload-icon">📷</div>
              <h3 style={{color:'var(--forest)',marginBottom:'6px'}}>Diagnose Now</h3>
              <p style={{fontSize:'13px',color:'var(--text-muted)',marginBottom:'16px'}}>Drag and drop or click to upload high-res photos</p>
              <button className="btn btn-forest">Select Images</button>
            </div>
            <div className="doc-chat">
              <div className="dc-head">
                <h4><span className="dc-dot"/>Diagnostic Assistant</h4>
              </div>
              <div className="dc-msgs">
                {chatMsgs.map((m,i)=>(
                  <div key={i} className={m.role==='bot'?'dc-bot':'dc-user'}>
                    <div className={m.role==='bot'?'dc-bot-bubble':'dc-user-bubble'}>{m.text}</div>
                  </div>
                ))}
              </div>
              {!doctorSel&&<div className="dc-quick">
                {DOCTOR_TIPS.map((t,i)=><button key={i} className="dc-qbtn" onClick={()=>{setDoctorSel(i);sendChat(t.label);}}>{t.label}</button>)}
              </div>}
              <div className="dc-input">
                <span style={{fontSize:'18px'}}>📎</span>
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="Describe the symptoms…" onKeyDown={e=>e.key==='Enter'&&sendChat()}/>
                <button className="dc-send" onClick={()=>sendChat()}>➤</button>
              </div>
            </div>
          </div>
          <div className="doc-right">
            <div className="diag-box">
              <div className="diag-tag">✅ Probable Diagnosis</div>
              {doctorSel!==null?<>
                <h3>🔬 {DOCTOR_TIPS[doctorSel].diag.split('.')[0]}</h3>
                <p>{DOCTOR_TIPS[doctorSel].diag}</p>
                <div className="diag-step"><div className="diag-step-icon"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L4.5 8.5L10 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg></div><div><h5>Immediate Treatment</h5><p>{DOCTOR_TIPS[doctorSel].advice.split('.')[0]}.</p></div></div>
                <div className="diag-step"><div className="diag-step-icon"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L4.5 8.5L10 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg></div><div><h5>Long-term Care</h5><p>{DOCTOR_TIPS[doctorSel].advice.split('.')[1]||'Monitor the plant and adjust care routine accordingly.'}.</p></div></div>
              </>:<><h3>Waiting for symptoms…</h3><p>Select a symptom on the left or describe your plant&apos;s condition to get a diagnosis.</p></>}
            </div>
            <div className="diag-box">
              <div className="diag-tag" style={{marginBottom:'14px'}}>Recommended Products</div>
              <div className="rec-grid">
                {[{n:'Organic Neem Shield',d:'Prevents leaf spot & pests',p:'₹450',img:'https://loremflickr.com/80/80/neem,oil,organic'},{n:'Digital Moisture Meter',d:'Avoid overwatering issues',p:'₹899',img:'https://loremflickr.com/80/80/moisture,meter,garden'}].map((r,i)=>(
                  <div className="rec-card" key={i}>
                    <img src={r.img} alt={r.n} onError={e=>e.target.src='https://loremflickr.com/80/80/plant,product'}/>
                    <div style={{flex:1}}><h5>{r.n}</h5><p>{r.d}</p><div className="rcp">{r.p}</div></div>
                    <button className="rec-add">Add</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="diag-progress">
              <h4>Diagnostic Progress</h4>
              <div className="dprog-steps">
                {['Upload','Scan','Diagnose','Treat'].map((s,i)=>(
                  <>
                    {i>0&&<div key={'l'+i} className={`dprog-line ${doctorSel!==null&&i<=2?'done':''}`}/>}
                    <div key={s} className="dprog-step">
                      <div className={`dprog-dot ${doctorSel!==null&&i<2?'done':i===2&&doctorSel!==null?'active':''}`}/>
                      <span className={`dprog-label ${i===2&&doctorSel!==null?'active':''}`}>{s}</span>
                    </div>
                  </>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>}
    <style>{`@keyframes dashmove{to{stroke-dashoffset:-26;}}@keyframes spin{to{transform:rotate(360deg);}}`}</style>
  </>);
}
