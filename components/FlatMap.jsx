'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

const NURSERIES = [
  { id:1,  name:'Anantapur Orchard Nursery', city:'Andhra Pradesh', country:'India',        lat:14.7,  lon:79.5,  color:'#4ADE80', glow:'rgba(74,222,128,0.6)',  orders:142, active:true,  tags:'Fruit Trees'      },
  { id:2,  name:'Kerala Palm Growers',        city:'Kerala',         country:'India',        lat:10.8,  lon:76.2,  color:'#4ADE80', glow:'rgba(74,222,128,0.6)',  orders:98,  active:true,  tags:'Indoor / Palms'   },
  { id:3,  name:'Mysore Bonsai Studio',        city:'Bangalore',      country:'India',        lat:13.1,  lon:77.6,  color:'#4ADE80', glow:'rgba(74,222,128,0.6)',  orders:34,  active:true,  tags:'Exotic / Bonsai'  },
  { id:4,  name:'Chiang Mai Botanicals',       city:'Chiang Mai',     country:'Thailand',    lat:18.8,  lon:98.9,  color:'#60A5FA', glow:'rgba(96,165,250,0.6)',  orders:87,  active:true,  tags:'Indoor / Tropical' },
  { id:5,  name:'Bali Bloom Gardens',          city:'Bali',           country:'Indonesia',   lat:-8.4,  lon:115.2, color:'#60A5FA', glow:'rgba(96,165,250,0.6)',  orders:61,  active:true,  tags:'Flowering'        },
  { id:6,  name:'Nairobi Garden Hub',          city:'Nairobi',        country:'Kenya',       lat:-1.3,  lon:36.8,  color:'#FBBF24', glow:'rgba(251,191,36,0.6)',  orders:29,  active:true,  tags:'Indoor'           },
  { id:7,  name:'Cape Floral Partners',        city:'Cape Town',      country:'South Africa',lat:-33.9, lon:18.4,  color:'#FBBF24', glow:'rgba(251,191,36,0.6)',  orders:18,  active:true,  tags:'Flowering'        },
  { id:8,  name:'Oaxaca Succulent Co.',        city:'Oaxaca',         country:'Mexico',      lat:17.1,  lon:-96.7, color:'#C084FC', glow:'rgba(192,132,252,0.6)', orders:44,  active:true,  tags:'Succulents'       },
  { id:9,  name:'Queensland Green House',      city:'Queensland',     country:'Australia',   lat:-25.3, lon:149.0, color:'#FBBF24', glow:'rgba(251,191,36,0.6)',  orders:22,  active:true,  tags:'Succulents'       },
  { id:10, name:'Murcia Botanical Farms',      city:'Murcia',         country:'Spain',       lat:38.0,  lon:-1.1,  color:'#60A5FA', glow:'rgba(96,165,250,0.6)',  orders:31,  active:true,  tags:'Fruit Trees'      },
  { id:11, name:'Tokyo Zen Gardens',           city:'Tokyo',          country:'Japan',       lat:35.7,  lon:139.7, color:'#FB7185', glow:'rgba(251,113,133,0.6)', orders:15,  active:true,  tags:'Bonsai / Zen'     },
  { id:12, name:'Amsterdam Exotic Growers',    city:'Amsterdam',      country:'Netherlands', lat:52.4,  lon:4.9,   color:'#aaa',    glow:'rgba(180,180,180,0.3)', orders:0,   active:false, tags:'Exotic'           },
];

const HUB = { lat:12.5, lon:78.0 };
const MIN_ZOOM = 1, MAX_ZOOM = 9;
const MAP_URLS = [
  'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg',
  'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg',
];
const FILTERS = [['all','🌍 All'],['india','🇮🇳 India'],['sea','🌏 SE Asia'],['africa','Africa'],['europe','Europe'],['americas','Americas']];
function region(n){
  if(n.country==='India') return 'india';
  if(['Thailand','Indonesia','Japan'].includes(n.country)) return 'sea';
  if(['Kenya','South Africa'].includes(n.country)) return 'africa';
  if(['Spain','Netherlands'].includes(n.country)) return 'europe';
  return 'americas';
}
function toXY(lon,lat){ return { x:(lon+180)/360*100, y:(90-lat)/180*100 }; }

export default function FlatMap() {
  const wrapRef   = useRef(null);
  const innerRef  = useRef(null);
  const pinRefs   = useRef({});

  const [zoom,   setZoom]   = useState(1);
  const [pan,    setPan]    = useState({ x:0, y:0 });
  const [hovered,setHovered]= useState(null);
  const [ttPos,  setTtPos]  = useState({ x:0, y:0, above:true });
  const [filter, setFilter] = useState('all');
  const [mapOk,  setMapOk]  = useState(false);
  const [mapSrc, setMapSrc] = useState(MAP_URLS[0]);
  const [mapIdx, setMapIdx] = useState(0);
  const [smooth, setSmooth] = useState(false);

  const drag    = useRef({ active:false, sx:0, sy:0, spx:0, spy:0 });
  const pinchD  = useRef(null);
  const pinchC  = useRef({ x:0, y:0 });

  const visible = filter==='all' ? NURSERIES : NURSERIES.filter(n=>region(n)===filter);

  /* ─── clamp pan ───────────────────────────────────────────── */
  function clamp(px, py, z, el) {
    const W = el.clientWidth, H = el.clientHeight;
    const minX = W*(1-z), minY = H*(1-z);
    return { x: Math.max(minX,Math.min(0,px)), y: Math.max(minY,Math.min(0,py)) };
  }

  /* ─── wheel zoom ──────────────────────────────────────────── */
  useEffect(()=>{
    const el = wrapRef.current; if(!el) return;
    function onWheel(e){
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.18 : 0.84;
      setSmooth(false);
      setZoom(z=>{
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z*factor));
        const ratio = nz/z;
        setPan(p=>{
          const nx = mx - ratio*(mx - p.x);
          const ny = my - ratio*(my - p.y);
          return clamp(nx, ny, nz, el);
        });
        return nz;
      });
    }
    el.addEventListener('wheel', onWheel, { passive:false });
    return ()=>el.removeEventListener('wheel', onWheel);
  }, []);

  /* ─── mouse drag ──────────────────────────────────────────── */
  function onMouseDown(e){
    drag.current = { active:true, sx:e.clientX, sy:e.clientY, spx:pan.x, spy:pan.y };
    e.currentTarget.style.cursor='grabbing';
  }
  useEffect(()=>{
    function onMove(e){
      if(!drag.current.active) return;
      const dx = e.clientX - drag.current.sx;
      const dy = e.clientY - drag.current.sy;
      const el = wrapRef.current; if(!el) return;
      setSmooth(false);
      setPan(clamp(drag.current.spx+dx, drag.current.spy+dy, zoom, el));
    }
    function onUp(){ drag.current.active=false; if(wrapRef.current) wrapRef.current.style.cursor='grab'; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return ()=>{ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
  }, [zoom]);

  /* ─── touch pinch + drag ──────────────────────────────────── */
  function onTouchStart(e){
    if(e.touches.length===2){
      drag.current.active=false;
      const [a,b]=e.touches;
      const dx=a.clientX-b.clientX, dy=a.clientY-b.clientY;
      pinchD.current=Math.sqrt(dx*dx+dy*dy);
      pinchC.current={ x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2 };
    } else {
      drag.current={ active:true, sx:e.touches[0].clientX, sy:e.touches[0].clientY, spx:pan.x, spy:pan.y };
    }
  }
  function onTouchMove(e){
    e.preventDefault();
    const el=wrapRef.current; if(!el) return;
    if(e.touches.length===2 && pinchD.current){
      const [a,b]=e.touches;
      const dx=a.clientX-b.clientX, dy=a.clientY-b.clientY;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const factor=dist/pinchD.current; pinchD.current=dist;
      const rect=el.getBoundingClientRect();
      const mx=pinchC.current.x-rect.left, my=pinchC.current.y-rect.top;
      setSmooth(false);
      setZoom(z=>{
        const nz=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,z*factor));
        const ratio=nz/z;
        setPan(p=>clamp(mx-ratio*(mx-p.x), my-ratio*(my-p.y), nz, el));
        return nz;
      });
    } else if(e.touches.length===1 && drag.current.active){
      const dx=e.touches[0].clientX-drag.current.sx;
      const dy=e.touches[0].clientY-drag.current.sy;
      setSmooth(false);
      setPan(clamp(drag.current.spx+dx, drag.current.spy+dy, zoom, el));
    }
  }
  function onTouchEnd(){ drag.current.active=false; pinchD.current=null; }

  /* ─── button zoom ─────────────────────────────────────────── */
  function zoomBy(factor){
    setSmooth(true);
    const el=wrapRef.current; if(!el) return;
    const W=el.clientWidth, H=el.clientHeight;
    const mx=W/2, my=H/2;
    setZoom(z=>{
      const nz=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,z*factor));
      const ratio=nz/z;
      setPan(p=>clamp(mx-ratio*(mx-p.x), my-ratio*(my-p.y), nz, el));
      return nz;
    });
  }
  function resetZoom(){ setSmooth(true); setZoom(1); setPan({x:0,y:0}); }

  /* ─── pin hover → tooltip in screen coords ───────────────── */
  function onPinEnter(n, e){
    const wRect=wrapRef.current?.getBoundingClientRect();
    if(!wRect) return;
    const pRect=e.currentTarget.getBoundingClientRect();
    const cx=(pRect.left+pRect.right)/2 - wRect.left;
    const cy=pRect.top - wRect.top;
    const above = cy > 80;
    setHovered(n);
    setTtPos({ x:cx, y:above?cy:cy+pRect.height, above });
  }

  /* ─── SVG route path ──────────────────────────────────────── */
  function arcD(lonA,latA,lonB,latB){
    const a=toXY(lonA,latA), b=toXY(lonB,latB);
    const mx=(a.x+b.x)/2, my=Math.min(a.y,b.y)-5;
    return `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'12px', alignItems:'center' }}>
        {FILTERS.map(([id,l])=>(
          <button key={id} onClick={()=>setFilter(id)} style={{
            padding:'6px 14px', borderRadius:'999px', fontSize:'12.5px', fontWeight:600, cursor:'pointer',
            border:'1.5px solid', transition:'.15s',
            borderColor:filter===id?'#1C3829':'#E2DDD5', background:filter===id?'#1C3829':'#fff',
            color:filter===id?'#fff':'#777',
          }}>{l}</button>
        ))}
        {/* Zoom controls */}
        <div style={{ marginLeft:'auto', display:'flex', gap:'6px', alignItems:'center' }}>
          <span style={{ fontSize:'11.5px', color:'#999', marginRight:'4px' }}>
            🔍 Scroll or pinch to zoom · Drag to pan
          </span>
          {[['−',0.7],['+',1.4],['⤢','reset']].map(([l,v])=>(
            <button key={l} onClick={()=>v==='reset'?resetZoom():zoomBy(v)} style={{
              width:32,height:32,borderRadius:'8px',border:'1.5px solid #E2DDD5',
              background:'#fff',color:'#1C3829',fontSize:l==='⤢'?14:18,fontWeight:700,
              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'.15s'
            }}>{l}</button>
          ))}
          <div style={{ fontSize:'12px',fontWeight:700,color:'#1C3829',minWidth:'36px',textAlign:'center',background:'#E8F2EC',borderRadius:'6px',padding:'4px 8px' }}>
            {Math.round(zoom*100)}%
          </div>
        </div>
      </div>

      {/* Map wrapper */}
      <div ref={wrapRef}
        style={{ position:'relative',borderRadius:'14px',overflow:'hidden',
          boxShadow:'0 16px 52px rgba(0,0,0,0.24)',border:'1px solid #ccc',
          background:'#0a2a4e', cursor:'grab', userSelect:'none',
          aspectRatio:'2/1', touchAction:'none',
        }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseLeave={()=>setHovered(null)}
      >
        {/* Transformable inner */}
        <div ref={innerRef} style={{
          position:'absolute', top:0, left:0, width:'100%', height:'100%',
          transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
          transformOrigin:'0 0',
          transition: smooth ? 'transform .35s cubic-bezier(.4,0,.2,1)' : 'none',
          willChange:'transform',
        }}>
          {/* Satellite image */}
          <img src={mapSrc} alt="World Map"
            onLoad={()=>setMapOk(true)}
            onError={()=>{ const ni=mapIdx+1; if(ni<MAP_URLS.length){setMapIdx(ni);setMapSrc(MAP_URLS[ni]);} }}
            crossOrigin="anonymous"
            draggable={false}
            style={{ width:'100%',height:'100%',objectFit:'fill',display:'block',opacity:mapOk?1:0,transition:'opacity .5s',pointerEvents:'none' }}/>

          {/* Fallback when image fails */}
          {!mapOk && <FallbackMap/>}

          {/* SVG arcs */}
          <svg viewBox="0 0 100 50" preserveAspectRatio="none"
            style={{ position:'absolute',inset:0,width:'100%',height:'100%',overflow:'visible',pointerEvents:'none' }}>
            {visible.filter(n=>n.active&&n.country!=='India').map(n=>(
              <path key={'arc'+n.id} d={arcD(HUB.lon,HUB.lat,n.lon,n.lat)}
                fill="none" stroke="rgba(74,222,128,0.3)" strokeWidth="0.15" strokeDasharray="0.55 0.45"/>
            ))}
            {/* India hub ring */}
            {(() => { const h=toXY(HUB.lon,HUB.lat); return (
              <circle cx={h.x} cy={h.y} r="0.5" fill="#1C3829" stroke="#fff" strokeWidth="0.15"/>
            );})()}
          </svg>

          {/* Pins — inside transform so they zoom with map */}
          {NURSERIES.map(n=>{
            const{x,y}=toXY(n.lon,n.lat);
            const isVis=!!visible.find(v=>v.id===n.id);
            const isHov=hovered?.id===n.id;
            return (
              <div key={n.id} style={{
                position:'absolute', left:`${x}%`, top:`${y}%`,
                transform:'translate(-50%,-50%)',
                zIndex:isHov?20:10, opacity:isVis?1:0.12, transition:'opacity .3s',
                pointerEvents:isVis?'auto':'none',
              }}
                onMouseEnter={e=>{e.stopPropagation();onPinEnter(n,e);}}
                onMouseLeave={()=>setHovered(null)}>

                {/* Outer pulse ring */}
                {n.active&&isVis&&(
                  <div style={{ position:'absolute', inset:'-10px', borderRadius:'50%',
                    border:`2px solid ${n.color}`, animation:'pinPulse 2.2s ease-in-out infinite',
                    pointerEvents:'none' }}/>
                )}
                {/* Middle ring on hover */}
                {isHov&&(
                  <div style={{ position:'absolute', inset:'-5px', borderRadius:'50%',
                    background:`${n.color}22`, border:`1.5px solid ${n.color}66`, pointerEvents:'none' }}/>
                )}
                {/* Core dot */}
                <div style={{
                  width:isHov?18:13, height:isHov?18:13, borderRadius:'50%',
                  background:n.color, border:'2.5px solid #fff',
                  boxShadow: isHov
                    ? `0 0 0 4px ${n.color}44, 0 4px 16px ${n.glow}`
                    : `0 2px 8px ${n.glow}`,
                  transition:'all .2s',
                }}/>
                {/* White core */}
                <div style={{ position:'absolute', top:'50%', left:'50%',
                  transform:'translate(-50%,-50%)', width:4, height:4,
                  borderRadius:'50%', background:'rgba(255,255,255,0.9)', pointerEvents:'none' }}/>
                {/* Order label at high zoom */}
                {n.orders>0&&isVis&&(
                  <div style={{
                    position:'absolute', bottom:'calc(100% + 6px)', left:'50%',
                    transform:'translateX(-50%)', background:n.color,
                    color:n.color==='#FBBF24'?'#000':'#fff',
                    fontSize:9, fontWeight:800, padding:'2px 6px',
                    borderRadius:'999px', whiteSpace:'nowrap',
                    boxShadow:`0 2px 6px ${n.glow}`, pointerEvents:'none',
                    opacity: zoom>=2?1:0, transition:'opacity .2s',
                  }}>{n.orders} orders</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Tooltip — OUTSIDE transform so it stays readable */}
        {hovered&&(
          <div style={{
            position:'absolute',
            left:ttPos.x, top:ttPos.above ? ttPos.y-12 : ttPos.y+12,
            transform:ttPos.above ? 'translate(-50%,-100%)' : 'translate(-50%,0)',
            background:'rgba(8,20,40,0.96)', color:'#fff',
            borderRadius:'14px', padding:'14px 18px', fontSize:'13px',
            pointerEvents:'none', whiteSpace:'nowrap', zIndex:50,
            boxShadow:`0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px ${hovered.color}44`,
            backdropFilter:'blur(14px)', animation:'ttFadeIn .18s ease',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:'9px', marginBottom:'8px' }}>
              <div style={{ width:11,height:11,borderRadius:'50%',background:hovered.color,
                boxShadow:`0 0 8px ${hovered.color}`,flexShrink:0 }}/>
              <b style={{ fontSize:'15px', letterSpacing:'-.2px' }}>{hovered.name}</b>
            </div>
            <div style={{ opacity:.72, marginBottom:'4px', fontSize:'12.5px' }}>📍 {hovered.city}, {hovered.country}</div>
            <div style={{ opacity:.62, marginBottom:'12px', fontSize:'12px' }}>🌿 {hovered.tags}</div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              paddingTop:'10px', borderTop:'1px solid rgba(255,255,255,0.1)', gap:'16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px',
                color:hovered.active?'#4ADE80':'#aaa' }}>
                <div style={{ width:7,height:7,borderRadius:'50%',background:hovered.active?'#4ADE80':'#888' }}/>
                {hovered.active?'Active Partner':'Pending'}
              </div>
              {hovered.orders>0&&(
                <div style={{ fontWeight:800, fontSize:'15px', color:'#4ADE80' }}>
                  {hovered.orders} <span style={{ fontSize:'11px', opacity:.8, fontWeight:600 }}>orders</span>
                </div>
              )}
            </div>
            {/* Caret */}
            <div style={{ position:'absolute',
              [ttPos.above?'bottom':'top']:-7, left:'50%', transform:'translateX(-50%)',
              borderLeft:'7px solid transparent', borderRight:'7px solid transparent',
              [ttPos.above?'borderTop':'borderBottom']:'7px solid rgba(8,20,40,0.96)' }}/>
          </div>
        )}

        {/* Zoom level badge */}
        <div style={{ position:'absolute',bottom:12,right:14,background:'rgba(0,0,0,0.55)',
          backdropFilter:'blur(8px)', color:'#fff',fontSize:'11px',fontWeight:700,
          padding:'4px 10px',borderRadius:'6px',letterSpacing:'.5px',pointerEvents:'none' }}>
          {Math.round(zoom*100)}%
        </div>

        {/* Legend */}
        <div style={{ position:'absolute',bottom:12,left:14,display:'flex',flexDirection:'column',
          gap:'4px',background:'rgba(0,0,0,0.55)',backdropFilter:'blur(8px)',
          padding:'8px 12px',borderRadius:'10px',pointerEvents:'none' }}>
          {[['#4ADE80','India'],['#60A5FA','Asia'],['#FBBF24','Africa / AU'],['#C084FC','Americas'],['#FB7185','Japan']].map(([c,l])=>(
            <div key={l} style={{ display:'flex',alignItems:'center',gap:'7px',fontSize:'11px',color:'rgba(255,255,255,0.8)' }}>
              <div style={{ width:8,height:8,borderRadius:'50%',background:c,boxShadow:`0 0 5px ${c}` }}/>{l}
            </div>
          ))}
        </div>

        {/* Loading state */}
        {!mapOk&&(
          <div style={{ position:'absolute',top:12,left:'50%',transform:'translateX(-50%)',
            background:'rgba(0,0,0,0.7)',color:'#fff',fontSize:'12px',padding:'6px 14px',
            borderRadius:'999px',backdropFilter:'blur(8px)' }}>
            Loading satellite map…
          </div>
        )}
      </div>

      {/* Nursery cards */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:'11px',marginTop:'16px' }}>
        {visible.filter(n=>n.active).map(n=>(
          <div key={n.id}
            onMouseEnter={()=>setHovered(n)}
            onMouseLeave={()=>setHovered(null)}
            style={{
              background:hovered?.id===n.id?'#f0faf4':'#fff',
              border:`1.5px solid ${hovered?.id===n.id?'#1C3829':'#E2DDD5'}`,
              borderRadius:'12px',padding:'13px 15px',cursor:'pointer',transition:'.2s',
            }}>
            <div style={{ display:'flex',alignItems:'center',gap:'9px',marginBottom:'5px' }}>
              <div style={{ width:10,height:10,borderRadius:'50%',background:n.color,
                boxShadow:`0 0 0 3px ${n.color}28`,flexShrink:0 }}/>
              <b style={{ fontSize:'13.5px',color:'#1C3829',lineHeight:1.3 }}>{n.name}</b>
            </div>
            <div style={{ fontSize:'12px',color:'#777',marginBottom:'7px' }}>📍 {n.city}, {n.country}</div>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
              <span style={{ background:'#E8F2EC',color:'#2A7D4F',fontSize:'10.5px',fontWeight:600,padding:'2px 9px',borderRadius:'999px' }}>{n.tags}</span>
              <b style={{ fontSize:'13px',color:'#555' }}>{n.orders} orders</b>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pinPulse{0%,100%{transform:scale(1);opacity:.5;}50%{transform:scale(2.4);opacity:0;}}
        @keyframes ttFadeIn{from{opacity:0;transform:translate(-50%,-90%)}to{opacity:1;transform:translate(-50%,-100%)}}
      `}</style>
    </div>
  );
}

/* Fallback canvas (shown while satellite img loads) */
function FallbackMap(){
  const ref=useRef(null);
  useEffect(()=>{
    const cv=ref.current; if(!cv) return;
    const cx=cv.getContext('2d'),W=cv.width,H=cv.height;
    function px(lon,lat){return[(lon+180)/360*W,(90-lat)/180*H];}
    function poly(pts,fill){cx.beginPath();cx.moveTo(...px(pts[0][0],pts[0][1]));pts.slice(1).forEach(p=>cx.lineTo(...px(p[0],p[1])));cx.closePath();cx.fillStyle=fill;cx.fill();}
    const og=cx.createLinearGradient(0,0,0,H);og.addColorStop(0,'#04203e');og.addColorStop(.45,'#0b3a6e');og.addColorStop(.55,'#0d4a80');og.addColorStop(1,'#04203e');
    cx.fillStyle=og;cx.fillRect(0,0,W,H);
    for(let i=0;i<1500;i++){cx.fillStyle=`rgba(80,160,255,${Math.random()*.04})`;cx.fillRect(Math.random()*W,Math.random()*H,Math.random()*50+4,1);}
    poly([[-168,72],[-140,68],[-100,70],[-60,47],[-65,44],[-75,40],[-80,25],[-88,15],[-100,18],[-118,30],[-125,48],[-142,60],[-160,62]],'#3a7a28');
    poly([[-80,12],[-60,12],[-48,2],[-44,-10],[-40,-20],[-48,-35],[-65,-55],[-72,-48],[-78,-35],[-76,-15],[-78,0]],'#2a7820');
    poly([[-10,36],[35,36],[30,46],[15,50],[8,58],[0,58],[-5,52],[-8,44],[-10,38]],'#4a8a35');
    poly([[5,58],[10,56],[30,56],[28,72],[15,71],[5,62]],'#3a7228');
    poly([[-18,15],[36,15],[42,10],[42,-5],[36,-18],[20,-35],[8,-20],[0,-5],[-18,10]],'#8a7830');
    poly([[-18,24],[36,24],[36,36],[-18,36]],'#a08830');
    poly([[36,22],[56,22],[56,12],[44,12],[36,22]],'#c0a040');
    poly([[26,36],[145,36],[140,42],[130,50],[100,55],[55,42],[40,36]],'#3a7228');
    poly([[68,22],[88,22],[82,8],[72,8]],'#2a7820');
    poly([[100,20],[120,20],[118,2],[108,2],[100,12]],'#2a7820');
    poly([[130,32],[140,44],[140,46],[132,42]],'#3a7228');
    poly([[114,-22],[154,-22],[152,-30],[148,-38],[128,-34],[114,-30]],'#8a7830');
    poly([[28,50],[180,50],[180,72],[28,72]],'#3a7228');
    poly([[-180,50],[-160,50],[-160,72],[-180,72]],'#3a7228');
    const ng=cx.createLinearGradient(0,0,0,80);ng.addColorStop(0,'rgba(240,250,255,.98)');ng.addColorStop(1,'rgba(240,250,255,0)');cx.fillStyle=ng;cx.fillRect(0,0,W,80);
    const sg=cx.createLinearGradient(0,H-60,0,H);sg.addColorStop(0,'rgba(240,250,255,0)');sg.addColorStop(1,'rgba(240,250,255,.98)');cx.fillStyle=sg;cx.fillRect(0,H-60,W,60);
  },[]);
  return <canvas ref={ref} width={2048} height={1024} style={{width:'100%',height:'100%',display:'block',objectFit:'fill'}}/>;
}
