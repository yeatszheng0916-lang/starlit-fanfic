// 温柔的星空背景：缓慢漂移的星点 + 偶尔划过的流星
(function () {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  let w, h, stars = [], shooting = [], dpr;

  const PALETTE = ['#cdd9f0', '#aebfe0', '#8fa6d4', '#e7ecf7'];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    initStars();
  }

  function initStars() {
    const count = Math.floor((innerWidth * innerHeight) / 6500);
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.3 + 0.3) * dpr,
        a: Math.random() * 0.6 + 0.25,
        tw: Math.random() * 0.02 + 0.004,
        dir: Math.random() > 0.5 ? 1 : -1,
        vy: (Math.random() * 0.12 + 0.02) * dpr,
        c: PALETTE[(Math.random() * PALETTE.length) | 0]
      });
    }
  }

  function spawnShooting() {
    if (Math.random() < 0.004 && shooting.length < 2) {
      const x = Math.random() * w * 0.7;
      const y = Math.random() * h * 0.4;
      shooting.push({ x, y, len: (Math.random() * 120 + 80) * dpr, vx: (Math.random() * 4 + 5) * dpr, vy: (Math.random() * 2 + 1.5) * dpr, life: 1 });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.a += s.tw * s.dir;
      if (s.a > 0.85 || s.a < 0.2) s.dir *= -1;
      s.y += s.vy;
      if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.c;
      ctx.globalAlpha = s.a;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    spawnShooting();
    for (let i = shooting.length - 1; i >= 0; i--) {
      const m = shooting[i];
      m.x += m.vx; m.y += m.vy; m.life -= 0.012;
      const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.len, m.y - m.len * (m.vy / m.vx));
      grad.addColorStop(0, 'rgba(200,220,250,' + m.life + ')');
      grad.addColorStop(1, 'rgba(200,220,250,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.len, m.y - m.len * (m.vy / m.vx));
      ctx.stroke();
      if (m.life <= 0 || m.x > w) shooting.splice(i, 1);
    }
    requestAnimationFrame(draw);
  }

  addEventListener('resize', resize);
  resize();
  draw();
})();
