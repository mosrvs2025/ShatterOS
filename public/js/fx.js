// World-space effects. Server effects carry a server timestamp (and confetti a
// seed) so every screen computes the same particles at the same moment:
// a burst that starts on the laptop keeps flying across onto the phone.

const effects = [];
const LIFE = { wave: 1100, confetti: 4200, spark: 450, link: 1600, poof: 700, key: 900, win: 1600, ripple: 900, portal: 1400 };
const CONFETTI_COLORS = ['#c5fa75', '#b49cff', '#ffb86b', '#6fd8f5', '#ff7aa8', '#f7e463', '#ffffff'];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addFx(e) {
  if (e.k === 'confetti') {
    const rand = mulberry32(e.seed);
    e.parts = Array.from({ length: 110 }, () => {
      const angle = -Math.PI / 2 + (rand() - 0.5) * 2.4, speed = 0.25 + rand() * 0.75;
      return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 1.6 + rand() * 2.6, color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)], spin: (rand() - 0.5) * 0.02, phase: rand() * 6, life: 0.6 + rand() * 0.4 };
    });
  }
  if (e.k === 'spark') {
    e.parts = Array.from({ length: 6 + Math.round(e.p) }, () => {
      const a = Math.random() * Math.PI * 2, s = 0.02 + Math.random() * 0.05 * (1 + e.p / 4);
      return { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.02 };
    });
  }
  effects.push(e);
  if (effects.length > 120) effects.shift();
}

const visible = (view, x, y, pad) => x > view.x - pad && x < view.x + view.w + pad && y > view.y - pad && y < view.y + view.h + pad;

export function drawFx(ctx, view, t, devices) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i], age = t - e.t;
    if (age > (LIFE[e.k] || 1000)) { effects.splice(i, 1); continue; }
    if (age < 0) continue;
    const k = age / (LIFE[e.k] || 1000);
    ctx.save();
    switch (e.k) {
      case 'wave': case 'ripple': {
        const max = e.k === 'wave' ? 300 : 40;
        if (!visible(view, e.x, e.y, max)) break;
        ctx.globalCompositeOperation = 'lighter';
        for (let r = 0; r < 3; r++) {
          const kk = k - r * 0.12;
          if (kk <= 0) continue;
          ctx.beginPath();
          ctx.arc(e.x, e.y, max * (1 - (1 - kk) ** 3), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(120, 230, 255, ${(1 - kk) * (e.k === 'wave' ? 0.7 : 0.5)})`;
          ctx.lineWidth = (e.k === 'wave' ? 6 : 1.5) * (1 - kk) + 0.4;
          ctx.stroke();
        }
        break;
      }
      case 'confetti': {
        const kd = 0.0016, g = 0.00055, decay = 1 - Math.exp(-kd * age);
        for (const p of e.parts) {
          if (k > p.life) continue;
          const x = e.x + (p.vx * decay) / kd + Math.sin(age * 0.004 + p.phase) * 6;
          const y = e.y + (p.vy * decay) / kd + (g / kd) * (age - decay / kd);
          if (!visible(view, x, y, 6)) continue;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.phase + age * p.spin);
          ctx.scale(1, Math.cos(age * 0.01 + p.phase));
          ctx.globalAlpha = Math.min(1, (p.life - k) * 6);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        }
        break;
      }
      case 'spark': {
        if (!visible(view, e.x, e.y, 30)) break;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = e.color || '#fff6c8';
        for (const p of e.parts) {
          ctx.globalAlpha = 1 - k;
          ctx.beginPath();
          ctx.arc(e.x + p.vx * age, e.y + p.vy * age + 0.00004 * age * age, 0.9 * (1 - k) + 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'poof': case 'key': case 'win': {
        const max = e.k === 'win' ? 70 : 26;
        if (!visible(view, e.x, e.y, max)) break;
        ctx.globalCompositeOperation = 'lighter';
        const color = e.k === 'poof' ? '200,220,255' : '255,214,120';
        const r = max * (1 - (1 - k) ** 2);
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r + 1);
        g.addColorStop(0, `rgba(${color},${0.5 * (1 - k)})`);
        g.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(e.x, e.y, r + 1, 0, Math.PI * 2); ctx.fill();
        for (let j = 0; j < 10; j++) {
          const a = (j / 10) * Math.PI * 2 + e.x;
          ctx.fillStyle = `rgba(${color},${1 - k})`;
          ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, 1.1 * (1 - k) + 0.3, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'link': case 'portal': {
        const a = devices.find(d => d.id === e.a), b = devices.find(d => d.id === e.b);
        if (!a || !b) break;
        const segs = seams(a, b, e.edge);
        if (!segs) break;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        const pulse = Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.8 + 0.2 * (1 - k);
        for (const [[x0, y0, x1, y1], color] of segs) {
          for (const [c, w, alpha] of [[color, 9, 0.35], [color, 3.5, 0.9], ['#ffffff', 1, 1]]) {
            ctx.strokeStyle = c;
            ctx.globalAlpha = pulse * alpha;
            ctx.lineWidth = w;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          }
          // A spark races along the new seam.
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }
}

// The two edges that now face each other, each drawn just inside its own
// screen in the colour of the screen on the other side.
function seams(a, b, edge) {
  const inset = 1.5;
  if (edge === 'right' || edge === 'left') {
    const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
    if (y1 <= y0) return null;
    const ax = edge === 'right' ? a.x + a.w - inset : a.x + inset, bx = edge === 'right' ? b.x + inset : b.x + b.w - inset;
    return [[[ax, y0, ax, y1], b.color], [[bx, y0, bx, y1], a.color]];
  }
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  if (x1 <= x0) return null;
  const ay = edge === 'bottom' ? a.y + a.h - inset : a.y + inset, by = edge === 'bottom' ? b.y + inset : b.y + b.h - inset;
  return [[[x0, ay, x1, ay], b.color], [[x0, by, x1, by], a.color]];
}
