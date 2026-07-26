'use client';
import { useEffect, useRef, useState } from 'react';

const NURSERIES = [
  { id:1,  name:'Anantapur Orchard Nursery', country:'India',         city:'Andhra Pradesh', lat:14.7,  lon:79.5,  hex:'#4ADE80', active:true,  orders:142, tags:'Fruit Trees'    },
  { id:2,  name:'Kerala Palm Growers',        country:'India',         city:'Kerala',         lat:10.8,  lon:76.2,  hex:'#4ADE80', active:true,  orders:98,  tags:'Indoor / Palms' },
  { id:3,  name:'Mysore Bonsai Studio',        country:'India',         city:'Bangalore',      lat:13.1,  lon:77.6,  hex:'#4ADE80', active:true,  orders:34,  tags:'Exotic / Bonsai'},
  { id:4,  name:'Chiang Mai Botanicals',       country:'Thailand',     city:'Chiang Mai',     lat:18.8,  lon:98.9,  hex:'#60A5FA', active:true,  orders:87,  tags:'Indoor/Tropical'},
  { id:5,  name:'Bali Bloom Gardens',          country:'Indonesia',    city:'Bali',           lat:-8.4,  lon:115.2, hex:'#60A5FA', active:true,  orders:61,  tags:'Flowering'      },
  { id:6,  name:'Nairobi Garden Hub',          country:'Kenya',        city:'Nairobi',        lat:-1.3,  lon:36.8,  hex:'#FB923C', active:true,  orders:29,  tags:'Indoor'         },
  { id:7,  name:'Cape Floral Partners',        country:'South Africa', city:'Cape Town',      lat:-33.9, lon:18.4,  hex:'#FB923C', active:true,  orders:18,  tags:'Flowering'      },
  { id:8,  name:'Oaxaca Succulent Co.',        country:'Mexico',       city:'Oaxaca',         lat:17.1,  lon:-96.7, hex:'#C084FC', active:true,  orders:44,  tags:'Succulents'     },
  { id:9,  name:'Queensland Green House',      country:'Australia',    city:'Queensland',     lat:-25.3, lon:149.0, hex:'#FB923C', active:true,  orders:22,  tags:'Succulents'     },
  { id:10, name:'Murcia Botanical Farms',      country:'Spain',        city:'Murcia',         lat:38.0,  lon:-1.1,  hex:'#60A5FA', active:true,  orders:31,  tags:'Fruit Trees'    },
  { id:11, name:'Amsterdam Exotic Growers',    country:'Netherlands',  city:'Amsterdam',      lat:52.4,  lon:4.9,   hex:'#aaaaaa', active:false, orders:0,   tags:'Exotic'         },
];

/* ─── Canvas Earth Texture ──────────────────────────────────── */
function buildEarthCanvas() {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');

  function px(lon, lat) { return [(lon + 180) / 360 * W, (90 - lat) / 180 * H]; }
  function poly(pts, fill) {
    cx.beginPath();
    cx.moveTo(...px(pts[0][0], pts[0][1]));
    pts.slice(1).forEach(p => cx.lineTo(...px(p[0], p[1])));
    cx.closePath();
    cx.fillStyle = fill; cx.fill();
  }

  // Ocean
  const og = cx.createLinearGradient(0, 0, 0, H);
  og.addColorStop(0,   '#05203a');
  og.addColorStop(0.3, '#0a3060');
  og.addColorStop(0.5, '#0d4080');
  og.addColorStop(0.8, '#0a3060');
  og.addColorStop(1,   '#05203a');
  cx.fillStyle = og; cx.fillRect(0, 0, W, H);

  // Ocean shimmer
  for (let i = 0; i < 1800; i++) {
    cx.fillStyle = `rgba(80,160,255,${Math.random() * 0.04})`;
    cx.fillRect(Math.random() * W, Math.random() * H, Math.random() * 60 + 4, 1);
  }

  const land1 = '#3a7a28'; const land2 = '#4e8f35'; const land3 = '#6a9a3a';
  const dry1  = '#8a7a30'; const dry2  = '#a08830';
  const trop  = '#2a7a20';

  // Russia / Siberia (top band)
  poly([[28,50],[190,50],[190,72],[28,72]], '#3a7a28');
  poly([[-180,50],[-160,50],[-160,72],[-180,72]], '#3a7a28');

  // North America
  poly([[-168,72],[-140,68],[-100,70],[-60,47],[-55,47],[-65,44],[-75,40],[-80,25],[-85,15],[-90,15],[-100,18],[-110,22],[-118,30],[-125,48],[-142,60],[-158,60],[-168,64]], land2);

  // Greenland
  poly([[-18,76],[-10,74],[0,72],[-5,64],[-20,60],[-40,64],[-50,70],[-40,76]], '#b0d8e8');

  // Central America / Caribbean
  poly([[-90,15],[-75,15],[-70,10],[-80,8],[-85,10]], land3);

  // South America
  poly([[-80,12],[-60,12],[-48,2],[-44,-10],[-40,-20],[-48,-35],[-65,-55],[-72,-48],[-78,-35],[-76,-15],[-78,0]], trop);

  // Europe
  poly([[-10,36],[35,36],[30,46],[20,47],[15,50],[8,58],[0,58],[-5,52],[-8,44],[-10,38]], land2);
  // Scandinavia
  poly([[5,58],[10,56],[30,56],[28,72],[15,71],[5,62]], land1);
  // UK
  poly([[-5,50],[2,50],[0,58],[-6,58]], land2);

  // Africa
  poly([[-18,15],[0,15],[18,15],[36,15],[42,10],[42,-5],[36,-18],[20,-35],[18,-34],[8,-20],[0,-5],[-5,5],[-18,10]], dry1);
  // North Africa (lighter/desert)
  poly([[-18,15],[36,15],[36,30],[-18,30]], dry2);

  // Arabia
  poly([[36,30],[56,22],[56,12],[44,12],[36,22]], dry2);

  // Asia main body
  poly([[26,36],[36,30],[56,22],[68,22],[80,25],[88,22],[100,20],[120,20],[145,36],[140,42],[130,50],[120,55],[100,55],[80,60],[55,42],[40,36]], land1);

  // India peninsula
  poly([[68,22],[88,22],[82,8],[72,8],[68,20]], trop);

  // SE Asia
  poly([[100,20],[120,20],[118,2],[108,2],[100,12]], trop);
  // Sumatra
  poly([[96,5],[106,5],[106,-4],[96,-2]], trop);
  // Borneo
  poly([[110,7],[118,7],[118,-4],[110,-2]], trop);
  // Java
  poly([[107,-6],[115,-6],[115,-8],[107,-8]], trop);

  // Japan
  poly([[130,32],[132,35],[140,44],[140,46],[132,42],[130,35]], land2);

  // Australia
  poly([[114,-22],[154,-22],[152,-30],[148,-38],[136,-38],[128,-34],[114,-30]], dry1);
  // Coastal green strip
  poly([[150,-22],[155,-24],[155,-30],[148,-38],[148,-30],[150,-24]], land3);

  // New Zealand
  poly([[172,-34],[178,-36],[178,-46],[174,-46],[172,-40]], land3);

  // Madagascar
  poly([[44,-12],[50,-16],[50,-25],[44,-26],[44,-18]], land3);

  // Sri Lanka
  poly([[80,10],[82,10],[82,7],[80,8]], trop);

  // Polar ice
  const npg = cx.createLinearGradient(0, 0, 0, 90);
  npg.addColorStop(0, 'rgba(240,250,255,0.98)');
  npg.addColorStop(1, 'rgba(240,250,255,0)');
  cx.fillStyle = npg; cx.fillRect(0, 0, W, 90);

  const spg = cx.createLinearGradient(0, H - 70, 0, H);
  spg.addColorStop(0, 'rgba(240,250,255,0)');
  spg.addColorStop(1, 'rgba(240,250,255,0.98)');
  cx.fillStyle = spg; cx.fillRect(0, H - 70, W, 70);

  // Cloud wisps
  cx.globalAlpha = 0.12;
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * W, y = 100 + Math.random() * (H - 200);
    const cg = cx.createRadialGradient(x, y, 0, x, y, 80 + Math.random() * 120);
    cg.addColorStop(0, 'rgba(255,255,255,1)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = cg; cx.fillRect(x - 150, y - 60, 300, 120);
  }
  cx.globalAlpha = 1;

  return cv;
}

/* ─── Globe component ───────────────────────────────────────── */
export default function Globe3D() {
  const mountRef = useRef(null);
  const stRef    = useRef({ drag:false, px:0, py:0, vx:0, vy:0 });
  const earthRef = useRef(null);
  const rafRef   = useRef(null);
  const rendRef  = useRef(null);
  const [sel, setSel]         = useState(null);
  const [ttPos, setTtPos]     = useState({ x:0, y:0 });
  const [phase, setPhase]     = useState('loading'); // loading | ready | error

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const cleanup = [];

    // ── Load Three.js from CDN ──────────────────────────────
    function loadThree() {
      if (window.THREE) return Promise.resolve(window.THREE);
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
        s.onload = () => res(window.THREE);
        s.onerror = () => rej(new Error('THREE load failed'));
        document.head.appendChild(s);
        cleanup.push(() => { try { document.head.removeChild(s); } catch(_){} });
      });
    }

    loadThree().then(T => {
      const W = el.clientWidth || 900;
      const H = Math.round(W * 0.62);

      // Renderer
      const renderer = new T.WebGLRenderer({ antialias:true, alpha:true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(W, H);
      renderer.domElement.style.cssText = 'display:block;cursor:grab;width:100%;';
      el.appendChild(renderer.domElement);
      rendRef.current = renderer;
      cleanup.push(() => { try { el.removeChild(renderer.domElement); } catch(_){} renderer.dispose(); });

      // Scene
      const scene  = new T.Scene();
      const camera = new T.PerspectiveCamera(42, W / H, 0.1, 1000);
      camera.position.z = 5.5;

      // Stars
      const spos = new Float32Array(3000 * 3);
      for (let i = 0; i < spos.length; i++) spos[i] = (Math.random() - 0.5) * 700;
      const sg = new T.BufferGeometry();
      sg.setAttribute('position', new T.BufferAttribute(spos, 3));
      scene.add(new T.Points(sg, new T.PointsMaterial({ color:0xffffff, size:0.35, transparent:true, opacity:0.88 })));

      // Lighting
      scene.add(new T.AmbientLight(0x223344, 1.0));
      const sun = new T.DirectionalLight(0xfff5ee, 3.2);
      sun.position.set(6, 2, 4);
      scene.add(sun);
      const fill = new T.DirectionalLight(0x334466, 0.6);
      fill.position.set(-5, -2, -4);
      scene.add(fill);

      // Earth texture from canvas
      const earthCanvas = buildEarthCanvas();
      const earthTex    = new T.CanvasTexture(earthCanvas);

      // Try loading real photo texture over it
      const photoLoader = new T.TextureLoader();
      photoLoader.setCrossOrigin('anonymous');
      const PHOTO_URLS = [
        'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg',
        'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg',
      ];
      function tryPhoto(i) {
        if (i >= PHOTO_URLS.length) return;
        photoLoader.load(PHOTO_URLS[i], tex => {
          if (earthRef.current) { earthRef.current.material.map = tex; earthRef.current.material.needsUpdate = true; }
        }, undefined, () => tryPhoto(i + 1));
      }
      tryPhoto(0);

      // Earth sphere
      const earthGeo = new T.SphereGeometry(2, 80, 80);
      const earthMat = new T.MeshPhongMaterial({ map:earthTex, shininess:20, specular:new T.Color(0x113355) });
      const earth    = new T.Mesh(earthGeo, earthMat);
      // Start with India (~lon 78) facing camera (+Z)
      earth.rotation.y = (-78) * Math.PI / 180;
      scene.add(earth);
      earthRef.current = earth;

      // Atmosphere
      scene.add(new T.Mesh(
        new T.SphereGeometry(2.08, 40, 40),
        new T.MeshPhongMaterial({ color:0x4488cc, transparent:true, opacity:0.13, side:T.FrontSide })
      ));
      // Outer glow ring
      scene.add(new T.Mesh(
        new T.SphereGeometry(2.38, 32, 32),
        new T.MeshBasicMaterial({ color:0x1155cc, transparent:true, opacity:0.06, side:T.BackSide })
      ));

      // Helper: lat/lon → 3D
      function ll3(lat, lon, r) {
        const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
        return new T.Vector3(r*Math.cos(la)*Math.cos(lo), r*Math.sin(la), r*Math.cos(la)*Math.sin(lo));
      }

      // India Hub center
      const HUB = ll3(12.5, 78.0, 2.08);

      // Nursery pins
      const pinMeshes = [];
      NURSERIES.forEach(n => {
        const pos = ll3(n.lat, n.lon, 2.07);
        const col = new T.Color(n.hex);

        // Outer glow sphere
        if (n.active) {
          const gm = new T.Mesh(
            new T.SphereGeometry(0.065, 16, 16),
            new T.MeshBasicMaterial({ color:col, transparent:true, opacity:0.3 })
          );
          gm.position.copy(pos); earth.add(gm);
        }

        // Main pin
        const pm = new T.Mesh(
          new T.SphereGeometry(n.active ? 0.038 : 0.022, 16, 16),
          new T.MeshBasicMaterial({ color: n.active ? col : new T.Color(0x888888) })
        );
        pm.position.copy(pos);
        pm.userData = n;
        earth.add(pm);
        pinMeshes.push(pm);

        // White core
        if (n.active) {
          const wc = new T.Mesh(new T.SphereGeometry(0.016, 8, 8), new T.MeshBasicMaterial({ color:0xffffff }));
          wc.position.copy(pos); earth.add(wc);
        }

        // Pulsing ring (flat disc)
        if (n.active) {
          const ring = new T.Mesh(
            new T.RingGeometry(0.055, 0.1, 28),
            new T.MeshBasicMaterial({ color:col, side:T.DoubleSide, transparent:true, opacity:0.6 })
          );
          ring.position.copy(pos);
          ring.quaternion.setFromUnitVectors(new T.Vector3(0,0,1), pos.clone().normalize());
          ring.userData = { isPulse:true, phase: Math.random()*Math.PI*2 };
          earth.add(ring);
        }

        // Arc line to India Hub
        if (n.active && n.country !== 'India') {
          const hubV = HUB.clone();
          const pinV = pos.clone();
          const pts  = [];
          for (let t = 0; t <= 36; t++) {
            const v = new T.Vector3().lerpVectors(hubV, pinV, t/36).normalize().multiplyScalar(2.14);
            pts.push(v);
          }
          const arc = new T.Line(
            new T.BufferGeometry().setFromPoints(pts),
            new T.LineBasicMaterial({ color:0x4ade80, transparent:true, opacity:0.3 })
          );
          earth.add(arc);
        }
      });

      // Raycaster for clicks
      const ray   = new T.Raycaster();
      const mouse = new T.Vector2();
      let clickStart = { x:0, y:0 };
      const domEl = renderer.domElement;

      domEl.addEventListener('mousedown', e => { clickStart = { x:e.clientX, y:e.clientY }; });
      domEl.addEventListener('click', e => {
        if (Math.abs(e.clientX-clickStart.x)+Math.abs(e.clientY-clickStart.y) > 5) return;
        const r = domEl.getBoundingClientRect();
        mouse.x =  ((e.clientX-r.left)/r.width)*2-1;
        mouse.y = -((e.clientY-r.top )/r.height)*2+1;
        ray.setFromCamera(mouse, camera);
        const hits = ray.intersectObjects(pinMeshes);
        if (hits.length) {
          const n = hits[0].object.userData;
          setSel(n);
          setTtPos({ x: e.clientX - el.getBoundingClientRect().left, y: e.clientY - el.getBoundingClientRect().top });
        } else { setSel(null); }
      });
      cleanup.push(()=>domEl.removeEventListener('click',()=>{}));

      // Drag
      const st = stRef.current;
      const onDown = e => {
        st.drag=true; st.vx=0; st.vy=0;
        const p=e.touches?.[0]||e; st.px=p.clientX; st.py=p.clientY;
        domEl.style.cursor='grabbing';
      };
      const onMove = e => {
        if (!st.drag) return;
        const p=e.touches?.[0]||e;
        const dx=p.clientX-st.px, dy=p.clientY-st.py;
        st.vy=dx*0.006; st.vx=dy*0.006;
        earth.rotation.y+=st.vy; earth.rotation.x+=st.vx;
        earth.rotation.x=Math.max(-1.1,Math.min(1.1,earth.rotation.x));
        st.px=p.clientX; st.py=p.clientY;
      };
      const onUp = ()=>{ st.drag=false; domEl.style.cursor='grab'; };
      domEl.addEventListener('mousedown',onDown);
      window.addEventListener('mousemove',onMove);
      window.addEventListener('mouseup',onUp);
      domEl.addEventListener('touchstart',onDown,{passive:true});
      window.addEventListener('touchmove',onMove,{passive:true});
      window.addEventListener('touchend',onUp);
      cleanup.push(()=>{
        domEl.removeEventListener('mousedown',onDown);
        window.removeEventListener('mousemove',onMove);
        window.removeEventListener('mouseup',onUp);
      });

      // Resize
      const onResize = () => {
        const W2=el.clientWidth, H2=Math.round(W2*0.62);
        camera.aspect=W2/H2; camera.updateProjectionMatrix(); renderer.setSize(W2,H2);
      };
      window.addEventListener('resize',onResize);
      cleanup.push(()=>window.removeEventListener('resize',onResize));

      setPhase('ready');

      // Animation loop
      let t0=0;
      function animate(t){
        rafRef.current=requestAnimationFrame(animate);
        const dt=Math.min((t-t0)/1000,0.05); t0=t;
        if (!st.drag) {
          earth.rotation.y+=st.vy; earth.rotation.x+=st.vx;
          earth.rotation.x=Math.max(-1.1,Math.min(1.1,earth.rotation.x));
          st.vy*=0.94; st.vx*=0.94;
          if (Math.abs(st.vy)<0.0003) earth.rotation.y+=0.0018; // auto-rotate
        }
        // Pulse rings
        earth.children.forEach(ch=>{
          if (ch.userData?.isPulse){
            ch.userData.phase+=dt*2.4;
            ch.material.opacity=0.1+0.55*Math.abs(Math.sin(ch.userData.phase));
            ch.scale.setScalar(1+0.45*Math.abs(Math.sin(ch.userData.phase*0.65)));
          }
        });
        renderer.render(scene, camera);
      }
      rafRef.current=requestAnimationFrame(animate);
      cleanup.push(()=>cancelAnimationFrame(rafRef.current));

    }).catch(err => { console.error('Globe error:', err); setPhase('error'); });

    return () => cleanup.forEach(f => { try { f(); } catch(_){} });
  }, []);

  return (
    <div style={{position:'relative',background:'#000814',borderRadius:'16px',overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,0.6)'}}>
      {/* Canvas mount point */}
      <div ref={mountRef} style={{width:'100%',minHeight:'360px'}}/>

      {/* Loading overlay */}
      {phase==='loading' && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#000814',color:'#fff',gap:'16px'}}>
          <div style={{fontSize:'52px',animation:'globeSpin 2s linear infinite'}}>🌍</div>
          <div style={{fontSize:'13px',opacity:.6,letterSpacing:'1.5px',textTransform:'uppercase'}}>Initialising 3D Globe…</div>
          <div style={{width:'120px',height:'3px',background:'rgba(255,255,255,0.1)',borderRadius:'999px',overflow:'hidden'}}>
            <div style={{height:'100%',background:'#4ADE80',borderRadius:'999px',animation:'loadBar 1.5s ease-in-out infinite'}}/>
          </div>
        </div>
      )}

      {/* Error */}
      {phase==='error' && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#000814',color:'#fff',fontSize:'14px',flexDirection:'column',gap:'10px'}}>
          <div style={{fontSize:'32px'}}>⚠️</div>
          <div>Globe requires an internet connection to load</div>
        </div>
      )}

      {/* Nursery info panel on click */}
      {sel && (
        <div style={{position:'absolute',top:16,right:16,background:'rgba(0,16,36,0.92)',backdropFilter:'blur(16px)',color:'#fff',borderRadius:'14px',padding:'18px 20px',maxWidth:'230px',border:'1px solid rgba(74,222,128,0.4)',boxShadow:'0 8px 32px rgba(0,0,0,0.6)',animation:'fadeIn .25s ease'}}>
          <button onClick={()=>setSel(null)} style={{position:'absolute',top:10,right:12,background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:'17px',cursor:'pointer',lineHeight:1}}>✕</button>
          <div style={{display:'flex',alignItems:'center',gap:'9px',marginBottom:'10px'}}>
            <div style={{width:11,height:11,borderRadius:'50%',background:sel.hex,boxShadow:`0 0 8px ${sel.hex}`,flexShrink:0}}/>
            <b style={{fontSize:'13.5px',lineHeight:1.3}}>{sel.name}</b>
          </div>
          <div style={{fontSize:'12px',opacity:.72,marginBottom:'5px'}}>📍 {sel.city}, {sel.country}</div>
          <div style={{fontSize:'12px',opacity:.65,marginBottom:'12px'}}>🌿 {sel.tags}</div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:'10px',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
            <span style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'12px',color:'#4ADE80'}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:'#4ADE80',display:'inline-block'}}/>
              {sel.active?'Active':'Pending'}
            </span>
            {sel.orders>0&&<span style={{fontSize:'14px',fontWeight:800,color:'#4ADE80'}}>{sel.orders} orders</span>}
          </div>
        </div>
      )}

      {/* Controls hint */}
      <div style={{position:'absolute',bottom:14,left:'50%',transform:'translateX(-50%)',background:'rgba(255,255,255,0.07)',backdropFilter:'blur(8px)',color:'rgba(255,255,255,0.55)',fontSize:'11.5px',padding:'6px 16px',borderRadius:'999px',pointerEvents:'none',letterSpacing:'.3px',whiteSpace:'nowrap'}}>
        🖱 Drag to rotate · Click a pin to view nursery details
      </div>

      {/* Legend */}
      <div style={{position:'absolute',bottom:14,left:14,display:'flex',flexDirection:'column',gap:'5px'}}>
        {[['#4ADE80','India'],['#60A5FA','Asia / Europe'],['#FB923C','Africa / Oceania'],['#C084FC','Americas']].map(([c,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'11px',color:'rgba(255,255,255,0.6)'}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:c,boxShadow:`0 0 5px ${c}`}}/>
            {l}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes globeSpin{to{transform:rotate(360deg);}}
        @keyframes loadBar{0%{width:0%;margin-left:0;}50%{width:60%;margin-left:20%;}100%{width:0%;margin-left:100%;}}
        @keyframes fadeIn{from{opacity:0;transform:scale(.92);}to{opacity:1;transform:scale(1);}}
      `}</style>
    </div>
  );
}
