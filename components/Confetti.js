export function launchConfetti() {
  const c = document.getElementById('cfv');
  if (!c) return;
  c.style.display = 'block';
  const ctx = c.getContext('2d');
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  const ps = Array.from({ length: 90 }, () => ({
    x: Math.random() * c.width, y: -10,
    r: 4 + Math.random() * 6,
    color: `hsl(${[120,40,45,180,30][Math.floor(Math.random()*5)]},60%,55%)`,
    vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 3,
    tilt: Math.random() * 10 - 5, ts: 0.1 + Math.random() * .1,
  }));
  let f = 0;
  function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => {
      p.y += p.vy; p.x += p.vx; p.tilt += p.ts;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.tilt * Math.PI / 180);
      ctx.fillStyle = p.color; ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r); ctx.restore();
    });
    f++;
    if (f < 90) requestAnimationFrame(draw);
    else { ctx.clearRect(0, 0, c.width, c.height); c.style.display = 'none'; }
  }
  draw();
}
