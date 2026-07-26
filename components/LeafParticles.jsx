'use client';
import { useEffect } from 'react';
const mkLeaf=(col,h)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60" width="${h}" height="${h*1.5}"><path d="M20 58 C20 58 2 40 2 22 C2 10 10 2 20 2 C30 2 38 10 38 22 C38 40 20 58 20 58Z" fill="${col}" opacity="0.75"/><line x1="20" y1="6" x2="20" y2="54" stroke="rgba(255,255,255,0.3)" stroke-width="1.1"/><line x1="20" y1="20" x2="11" y2="30" stroke="rgba(255,255,255,0.2)" stroke-width="0.7"/><line x1="20" y1="20" x2="29" y2="30" stroke="rgba(255,255,255,0.2)" stroke-width="0.7"/></svg>`;
const mkFlower=(col,cc,h)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="${h}" height="${h}"><ellipse cx="30" cy="12" rx="7" ry="11" fill="${col}" opacity="0.8"/><ellipse cx="30" cy="48" rx="7" ry="11" fill="${col}" opacity="0.8"/><ellipse cx="12" cy="30" rx="11" ry="7" fill="${col}" opacity="0.8"/><ellipse cx="48" cy="30" rx="11" ry="7" fill="${col}" opacity="0.8"/><ellipse cx="17" cy="17" rx="7" ry="11" fill="${col}" opacity="0.72" transform="rotate(-45 17 17)"/><ellipse cx="43" cy="17" rx="7" ry="11" fill="${col}" opacity="0.72" transform="rotate(45 43 17)"/><ellipse cx="17" cy="43" rx="7" ry="11" fill="${col}" opacity="0.72" transform="rotate(45 17 43)"/><ellipse cx="43" cy="43" rx="7" ry="11" fill="${col}" opacity="0.72" transform="rotate(-45 43 43)"/><circle cx="30" cy="30" r="9" fill="${cc}"/></svg>`;
const mkPetal=(col,h)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 50" width="${h*.6}" height="${h}"><path d="M15 48 C6 36 2 24 2 16 C2 7 8 2 15 2 C22 2 28 7 28 16 C28 24 24 36 15 48Z" fill="${col}" opacity="0.75"/></svg>`;
const SHAPES=[
  ()=>mkLeaf('#2D6A4F',12+Math.random()*12), ()=>mkLeaf('#1B3829',10+Math.random()*14),
  ()=>mkLeaf('#52b788',11+Math.random()*10), ()=>mkLeaf('#2A7D4F',14+Math.random()*10),
  ()=>mkFlower('#f4a261','#e76f51',13+Math.random()*9), ()=>mkFlower('#e9c46a','#f4a261',11+Math.random()*9),
  ()=>mkPetal('#f4a261',13+Math.random()*9), ()=>mkPetal('#e9c46a',11+Math.random()*9),
];
const ANIMS=['leaffall','leaffall2','leaffall3'];
export default function LeafParticles(){
  useEffect(()=>{
    const w=document.getElementById('ptcl'); if(!w)return; w.innerHTML='';
    for(let i=0;i<24;i++){const p=document.createElement('div');p.className='pt';p.innerHTML=SHAPES[i%SHAPES.length]();const dur=8+Math.random()*14;const delay=Math.random()*16;p.style.cssText=`left:${Math.random()*102}%;top:0;animation-name:${ANIMS[i%3]};animation-duration:${dur}s;animation-delay:${-delay}s;`;w.appendChild(p);}
    return()=>{if(w)w.innerHTML='';};
  },[]);
  return null;
}
