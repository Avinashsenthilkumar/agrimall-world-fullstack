'use client';
import { useState } from 'react';

const NURSERIES = [
  { id:1,  name:'Anantapur Orchard Nursery', country:'India',        city:'Andhra Pradesh', lon:79.5, lat:14.7,  tags:['Fruit Trees'],        active:true,  orders:142, color:'#2A7D4F', region:'india' },
  { id:2,  name:'Kerala Palm Growers',        country:'India',        city:'Kerala',         lon:76.2, lat:10.8,  tags:['Indoor','Palms'],      active:true,  orders:98,  color:'#2A7D4F', region:'india' },
  { id:3,  name:'Mysore Bonsai Studio',        country:'India',        city:'Bangalore',      lon:77.6, lat:13.1,  tags:['Exotic','Bonsai'],     active:true,  orders:34,  color:'#2A7D4F', region:'india' },
  { id:4,  name:'Chiang Mai Botanicals',       country:'Thailand',    city:'Chiang Mai',     lon:98.9, lat:18.8,  tags:['Indoor','Tropical'],   active:true,  orders:87,  color:'#1B6CA8', region:'asia'  },
  { id:5,  name:'Bali Bloom Gardens',          country:'Indonesia',   city:'Bali',           lon:115.2,lat:-8.4,  tags:['Flowering'],           active:true,  orders:61,  color:'#1B6CA8', region:'asia'  },
  { id:6,  name:'Nairobi Garden Hub',          country:'Kenya',       city:'Nairobi',        lon:36.8, lat:-1.3,  tags:['Indoor'],              active:true,  orders:29,  color:'#C0862A', region:'africa'},
  { id:7,  name:'Cape Floral Partners',        country:'South Africa',city:'Cape Town',      lon:18.4, lat:-33.9, tags:['Flowering'],           active:true,  orders:18,  color:'#C0862A', region:'africa'},
  { id:8,  name:'Oaxaca Succulent Co.',        country:'Mexico',      city:'Oaxaca',         lon:-96.7,lat:17.1,  tags:['Succulents'],          active:true,  orders:44,  color:'#8A2A7D', region:'americas'},
  { id:9,  name:'Queensland Green House',      country:'Australia',   city:'Queensland',     lon:149.0,lat:-25.3, tags:['Succulents','Indoor'], active:true,  orders:22,  color:'#C0862A', region:'oceania'},
  { id:10, name:'Murcia Botanical Farms',      country:'Spain',       city:'Murcia',         lon:-1.1, lat:38.0,  tags:['Fruit Trees'],         active:true,  orders:31,  color:'#1B6CA8', region:'europe'},
  { id:11, name:'Bangalore Herb Collective',   country:'India',       city:'Bangalore',      lon:77.4, lat:12.5,  tags:['Herbs'],               active:false, orders:0,   color:'#999',    region:'india' },
  { id:12, name:'Amsterdam Exotic Growers',    country:'Netherlands', city:'Amsterdam',      lon:4.9,  lat:52.4,  tags:['Exotic'],              active:false, orders:0,   color:'#999',    region:'europe'},
];

// Equirectangular projection: x=(lon+180)*(W/360), y=(90-lat)*(H/180)
const W=1000, H=500;
function project(lon,lat){ return { x:(lon+180)*(W/360), y:(90-lat)*(H/180) }; }
NURSERIES.forEach(n => { const p=project(n.lon,n.lat); n.x=p.x; n.y=p.y; });

// India hub center for route lines
const INDIA_HUB = project(78.5, 15.0);

// Proper continent SVG paths (simplified Natural Earth, equirectangular 1000x500)
const LAND = [
  // Greenland
  { id:'gl', d:'M 285,50 L 345,40 L 392,48 L 402,76 L 378,112 L 336,124 L 294,108 L 272,80 Z', fill:'#C8DDCC' },
  // Iceland
  { id:'ic', d:'M 428,72 L 450,65 L 468,74 L 464,88 L 445,95 L 428,85 Z', fill:'#C8DDCC' },
  // North America
  { id:'na', d:'M 58,92 L 105,72 L 155,65 L 200,72 L 250,85 L 280,108 L 292,138 L 272,172 L 252,195 L 228,218 L 212,238 L 195,285 L 174,315 L 144,306 L 112,278 L 84,244 L 66,208 L 56,168 L 54,128 Z', fill:'#C8DDCC' },
  // Central America / Caribbean
  { id:'ca', d:'M 220,235 L 248,228 L 260,242 L 252,258 L 232,262 L 216,252 Z', fill:'#C8DDCC' },
  // South America
  { id:'sa', d:'M 208,250 L 248,240 L 290,248 L 320,264 L 336,295 L 340,330 L 330,375 L 312,420 L 286,460 L 256,475 L 224,465 L 200,445 L 184,415 L 178,375 L 180,334 L 192,294 L 202,264 Z', fill:'#C8DDCC' },
  // UK + Ireland
  { id:'uk', d:'M 452,94 L 470,87 L 483,94 L 478,112 L 462,118 L 450,108 Z', fill:'#C8DDCC' },
  // Scandinavia
  { id:'sc', d:'M 490,66 L 522,58 L 545,66 L 548,82 L 530,98 L 510,100 L 492,88 Z', fill:'#C8DDCC' },
  // Europe mainland
  { id:'eu', d:'M 446,88 L 488,78 L 512,72 L 540,78 L 560,92 L 565,112 L 552,138 L 528,158 L 502,165 L 474,160 L 450,148 L 438,128 L 438,108 Z', fill:'#C8DDCC' },
  // Russia/Siberia
  { id:'ru', d:'M 512,68 L 605,52 L 710,44 L 825,48 L 910,58 L 952,72 L 948,90 L 908,88 L 835,74 L 758,68 L 680,70 L 600,78 L 538,90 L 524,80 Z', fill:'#C8DDCC' },
  // Africa
  { id:'af', d:'M 454,165 L 502,157 L 547,160 L 580,170 L 610,184 L 624,210 L 626,245 L 618,285 L 608,330 L 588,374 L 560,414 L 528,440 L 500,445 L 472,432 L 452,405 L 440,370 L 437,325 L 440,280 L 446,235 L 450,198 Z', fill:'#C8DDCC' },
  // Madagascar
  { id:'mg', d:'M 590,328 L 600,316 L 613,326 L 616,355 L 608,377 L 594,380 L 583,360 L 582,338 Z', fill:'#C8DDCC' },
  // Arabia
  { id:'ar', d:'M 558,170 L 590,162 L 614,172 L 618,200 L 600,220 L 578,225 L 558,210 L 548,190 Z', fill:'#C8DDCC' },
  // Asia mainland (with India peninsula)
  { id:'as', d:'M 535,88 L 605,78 L 682,70 L 762,66 L 842,70 L 905,82 L 945,105 L 960,135 L 952,168 L 926,195 L 882,216 L 840,230 L 798,238 L 768,245 L 746,258 L 730,272 L 718,282 L 704,278 L 692,260 L 696,238 L 708,218 L 722,202 L 718,184 L 702,176 L 686,186 L 676,204 L 670,226 L 660,244 L 646,252 L 628,246 L 610,234 L 592,220 L 574,206 L 556,192 L 543,174 L 534,154 L 530,124 Z', fill:'#C8DDCC' },
  // Japan
  { id:'jp', d:'M 872,132 L 895,126 L 912,138 L 908,162 L 888,172 L 870,158 Z', fill:'#C8DDCC' },
  // Sri Lanka
  { id:'sl', d:'M 720,228 L 726,224 L 730,232 L 724,238 L 718,234 Z', fill:'#C8DDCC' },
  // Malay Peninsula + Sumatra
  { id:'se', d:'M 742,258 L 772,246 L 788,256 L 785,274 L 762,282 L 740,272 Z', fill:'#C8DDCC' },
  // Borneo
  { id:'bo', d:'M 790,258 L 820,248 L 838,262 L 836,285 L 814,295 L 792,286 L 782,270 Z', fill:'#C8DDCC' },
  // Java + Bali
  { id:'jv', d:'M 790,282 L 830,272 L 845,282 L 840,294 L 808,298 Z', fill:'#C8DDCC' },
  // Australia
  { id:'au', d:'M 756,318 L 820,305 L 882,305 L 932,315 L 958,340 L 962,380 L 946,415 L 910,436 L 856,448 L 806,440 L 764,420 L 748,394 L 746,358 Z', fill:'#C8DDCC' },
  // New Zealand
  { id:'nz1', d:'M 966,386 L 978,376 L 984,390 L 978,406 L 964,402 Z', fill:'#C8DDCC' },
  { id:'nz2', d:'M 970,408 L 980,402 L 985,420 L 972,430 L 960,422 Z', fill:'#C8DDCC' },
];

const FILTER_TABS = [
  ['all','🌍 All'],['india','🇮🇳 India'],['asia','🌏 SE Asia'],['africa','🌍 Africa'],['americas','🌎 Americas'],['europe','🌍 Europe'],
];

export default function WorldMap() {
  const [hovered, setHovered] = useState(null);
  const [tooltip, setTooltip] = useState({ x:0, y:0 });
  const [filter, setFilter]   = useState('all');

  const visible = filter==='all' ? NURSERIES : NURSERIES.filter(n=>n.region===filter);

  function handleEnter(n, e) {
    const wrap = e.currentTarget.closest('.wmap-wrap');
    const rect  = wrap.getBoundingClientRect();
    const svg   = e.currentTarget.closest('svg');
    const svgR  = svg.getBoundingClientRect();
    const sx = svgR.width  / W;
    const sy = svgR.height / H;
    setHovered(n);
    setTooltip({ x: n.x*sx + (svgR.left - rect.left), y: n.y*sy + (svgR.top - rect.top) });
  }

  return (
    <div>
      {/* Filters */}
      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'14px'}}>
        {FILTER_TABS.map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)} style={{
            padding:'6px 15px',borderRadius:'999px',fontSize:'12.5px',fontWeight:600,cursor:'pointer',
            border:'1.5px solid',borderColor:filter===v?'var(--forest)':'var(--border)',
            background:filter===v?'var(--forest)':'#fff',
            color:filter===v?'#fff':'var(--text-muted)',transition:'.18s'
          }}>{l}</button>
        ))}
        <div style={{marginLeft:'auto',fontSize:'12px',color:'var(--text-muted)',display:'flex',alignItems:'center',gap:'6px'}}>
          <span style={{width:8,height:8,borderRadius:'50%',background:'#4ADE80',display:'inline-block'}}/>
          {visible.filter(n=>n.active).length} active nurseries
        </div>
      </div>

      {/* Map */}
      <div className="wmap-wrap" style={{position:'relative',background:'#A8C8E0',borderRadius:'12px',overflow:'hidden',boxShadow:'inset 0 2px 8px rgba(0,0,0,0.06)'}}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block'}}>
          {/* Ocean texture */}
          <defs>
            <pattern id="oceanGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width={W} height={H} fill="#A8C8E0"/>
          <rect width={W} height={H} fill="url(#oceanGrid)"/>

          {/* Equator */}
          <line x1="0" y1="250" x2={W} y2="250" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" strokeDasharray="6 5"/>
          <text x="6" y="247" fill="rgba(255,255,255,0.45)" fontSize="8" fontFamily="Inter,sans-serif" letterSpacing="1">EQUATOR</text>
          {/* Tropic of Cancer */}
          <line x1="0" y1="201" x2={W} y2="201" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" strokeDasharray="4 5"/>
          {/* Tropic of Capricorn */}
          <line x1="0" y1="299" x2={W} y2="299" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" strokeDasharray="4 5"/>

          {/* Land masses */}
          {LAND.map(c=>(
            <path key={c.id} d={c.d} fill={c.fill} stroke="#9BBFAA" strokeWidth="1.2" opacity="0.95"/>
          ))}

          {/* Region labels */}
          {[['N.America',155,195],['S.America',255,370],['Europe',495,132],['Africa',530,320],['Asia',740,165],['Australia',855,385],['Russia / Siberia',720,58]].map(([l,x,y])=>(
            <text key={l} x={x} y={y} textAnchor="middle" fill="#5E8070" fontSize="10" fontFamily="Inter,sans-serif" fontWeight="600" opacity="0.75">{l}</text>
          ))}

          {/* Route lines from India hub to international partners */}
          {NURSERIES.filter(n=>n.active && n.region!=='india').map(n=>(
            <path key={'r'+n.id}
              d={`M ${INDIA_HUB.x} ${INDIA_HUB.y} Q ${(INDIA_HUB.x+n.x)/2} ${Math.min(INDIA_HUB.y,n.y)-55} ${n.x} ${n.y}`}
              fill="none" stroke="rgba(42,125,79,0.22)" strokeWidth="1.3" strokeDasharray="5 4"/>
          ))}

          {/* Nursery pins */}
          {NURSERIES.map(n=>{
            const isVis   = !!visible.find(f=>f.id===n.id);
            const isHov   = hovered?.id===n.id;
            const opacity = isVis ? 1 : 0.15;
            const r       = isHov ? 11 : 7.5;
            return (
              <g key={n.id} style={{cursor:'pointer',opacity,transition:'opacity .3s'}}
                onMouseEnter={e=>handleEnter(n,e)}
                onMouseLeave={()=>setHovered(null)}>
                {/* Pulse */}
                {n.active && isVis && (
                  <circle cx={n.x} cy={n.y} r="16" fill="none" stroke={n.color}
                    strokeWidth="1.8" opacity="0.35" style={{animation:'pinPulse 2.2s ease-in-out infinite'}}/>
                )}
                {/* Glow on hover */}
                {isHov && <circle cx={n.x} cy={n.y} r="18" fill={n.color} opacity="0.15"/>}
                {/* Main dot */}
                <circle cx={n.x} cy={n.y} r={r}
                  fill={n.active?n.color:'#bbb'} stroke="#fff" strokeWidth="2.2"
                  style={{transition:'r .2s',filter:n.active?`drop-shadow(0 2px 6px ${n.color}99)`:'none'}}/>
                {/* Live dot */}
                {n.active && <circle cx={n.x+6} cy={n.y-6} r="3.2" fill="#4ADE80" stroke="#fff" strokeWidth="1.5"/>}
                {/* Order badge for high-volume */}
                {n.orders>60 && isVis && (
                  <g>
                    <rect x={n.x-17} y={n.y-30} width="34" height="14" rx="7" fill={n.color} opacity="0.92"/>
                    <text x={n.x} y={n.y-19} textAnchor="middle" fill="#fff" fontSize="8.5" fontFamily="Inter,sans-serif" fontWeight="700">{n.orders} ord</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* India Hub label */}
          <rect x={INDIA_HUB.x-28} y={INDIA_HUB.y+12} width="56" height="16" rx="8" fill="rgba(28,56,41,0.82)"/>
          <text x={INDIA_HUB.x} y={INDIA_HUB.y+23} textAnchor="middle" fill="#fff" fontSize="8.5" fontFamily="Inter,sans-serif" fontWeight="700">India Hub</text>
        </svg>

        {/* Floating tooltip */}
        {hovered && (
          <div style={{
            position:'absolute', left:tooltip.x, top:tooltip.y,
            transform:'translate(-50%,-108%)',
            background:'var(--forest)',color:'#fff',
            borderRadius:'10px',padding:'11px 15px',
            fontSize:'12.5px',pointerEvents:'none',whiteSpace:'nowrap',
            zIndex:20,boxShadow:'0 6px 20px rgba(0,0,0,0.28)'
          }}>
            <div style={{fontWeight:700,fontSize:'13.5px',marginBottom:'3px'}}>{hovered.name}</div>
            <div style={{opacity:.78,marginBottom:'4px'}}>📍 {hovered.city}, {hovered.country}</div>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <span style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11.5px'}}>
                <span style={{width:7,height:7,borderRadius:'50%',background:hovered.active?'#4ADE80':'#999',display:'inline-block'}}/>
                {hovered.active?'Active':'Pending'}
              </span>
              {hovered.active && <span style={{fontSize:'11.5px',fontWeight:700,color:'#A8E8C0'}}>{hovered.orders} orders</span>}
              <span style={{fontSize:'11px',opacity:.65}}>{hovered.tags.join(', ')}</span>
            </div>
            <div style={{position:'absolute',bottom:-6,left:'50%',transform:'translateX(-50%)',
              borderLeft:'7px solid transparent',borderRight:'7px solid transparent',
              borderTop:'7px solid var(--forest)'}}/>
          </div>
        )}

        {/* Legend */}
        <div style={{background:'rgba(255,255,255,0.92)',borderTop:'1px solid var(--border)',padding:'10px 16px',display:'flex',gap:'18px',flexWrap:'wrap',alignItems:'center'}}>
          {[['#2A7D4F','India Partners'],['#1B6CA8','Asia / Europe'],['#C0862A','Africa / Oceania'],['#8A2A7D','Americas'],['#bbb','Pending Approval']].map(([c,l])=>(
            <div key={l} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-muted)'}}>
              <div style={{width:9,height:9,borderRadius:'50%',background:c}}/>
              {l}
            </div>
          ))}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-muted)'}}>
            <div style={{width:9,height:9,borderRadius:'50%',background:'#4ADE80'}}/>Active Nursery
          </div>
        </div>
      </div>

      {/* Nursery cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(270px,1fr))',gap:'12px',marginTop:'16px'}}>
        {visible.filter(n=>n.active).map(n=>(
          <div key={n.id}
            onMouseEnter={()=>setHovered(n)}
            onMouseLeave={()=>setHovered(null)}
            style={{background:hovered?.id===n.id?'var(--green-light)':'#fff',
              border:`1.5px solid ${hovered?.id===n.id?'var(--forest)':'var(--border)'}`,
              borderRadius:'var(--radius-md)',padding:'14px 16px',cursor:'pointer',transition:'.2s'}}>
            <div style={{display:'flex',alignItems:'center',gap:'9px',marginBottom:'6px'}}>
              <div style={{width:10,height:10,borderRadius:'50%',background:n.color,flexShrink:0,
                boxShadow:`0 0 0 3px ${n.color}28`}}/>
              <b style={{fontSize:'13.5px',color:'var(--forest)'}}>{n.name}</b>
            </div>
            <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'7px'}}>📍 {n.city}, {n.country}</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',gap:'5px',flexWrap:'wrap'}}>
                {n.tags.map(t=><span key={t} style={{background:'var(--green-light)',color:'var(--green)',fontSize:'10px',fontWeight:600,padding:'2px 8px',borderRadius:'999px'}}>{t}</span>)}
              </div>
              <span style={{fontSize:'12.5px',fontWeight:700,color:'var(--text-muted)'}}>{n.orders} orders</span>
            </div>
          </div>
        ))}
      </div>
      <style>{`@keyframes pinPulse{0%,100%{opacity:.35;transform:scale(1);}50%{opacity:0;transform:scale(2.1);}}`}</style>
    </div>
  );
}
