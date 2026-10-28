// The wallpaper is painted in *world* millimetres, not per screen, so a sun,
// a mountain range or an aurora lines up across bezels. When the art lines
// up, people instantly see their screens are one world.

const HORIZON = 1150;
let sky = null, skyCtx = null;

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function ridge(x, seed, amp) {
  return amp * (0.5 * Math.sin(x * 0.004 + seed) + 0.28 * Math.sin(x * 0.0113 + seed * 2.1) + 0.14 * Math.sin(x * 0.031 + seed * 3.7) + 0.08 * Math.sin(x * 0.07 + seed));
}

function skyGradient(ctx, world) {
  if (sky && skyCtx === ctx) return sky;
  sky = ctx.createLinearGradient(0, 0, 0, world.h);
  sky.addColorStop(0, '#04050b');
  sky.addColorStop(0.3, '#0a0d26');
  sky.addColorStop(0.55, '#1d1240');
  sky.addColorStop(0.72, '#4a1c5a');
  sky.addColorStop(0.8, '#9a3a6b');
  sky.addColorStop(0.835, '#ef7a5c');
  sky.addColorStop(0.86, '#ffb36e');
  sky.addColorStop(0.9, '#2a1030');
  sky.addColorStop(1, '#0c0716');
  skyCtx = ctx;
  return sky;
}

export function drawWorld(ctx, view, world, t, { grid = false } = {}) {
  const x0 = view.x - 4, x1 = view.x + view.w + 4, y0 = view.y - 4, y1 = view.y + view.h + 4;

  ctx.fillStyle = skyGradient(ctx, world);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  // Stars, twinkling in sync on every screen.
  const cell = 34;
  for (let cx = Math.floor(x0 / cell); cx <= x1 / cell; cx++) for (let cy = Math.floor(y0 / cell); cy <= y1 / cell; cy++) {
    if (cy * cell > HORIZON - 120) continue;
    const r = hash(cx, cy);
    if (r < 0.35) continue;
    const sx = (cx + hash(cx + 7, cy)) * cell, sy = (cy + hash(cx, cy + 11)) * cell;
    const fade = Math.min(1, (HORIZON - 160 - sy) / 400);
    const tw = 0.55 + 0.45 * Math.sin(t / (700 + r * 900) + r * 40);
    ctx.globalAlpha = Math.max(0, fade * tw * (0.35 + r * 0.65));
    ctx.fillStyle = r > 0.93 ? '#ffd9f0' : '#e8ecff';
    const size = 0.35 + r * 0.9;
    ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
  }
  ctx.globalAlpha = 1;

  // Aurora ribbons drifting across the whole desk.
  if (y0 < 900) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [base, hue, amp, speed, width] of [[560, 160, 70, 9000, 70], [430, 280, 50, 13000, 50], [680, 200, 40, 7000, 30]]) {
      ctx.beginPath();
      for (let x = x0; x <= x1 + 8; x += 8) {
        const y = base + Math.sin(x * 0.003 + t / speed) * amp + Math.sin(x * 0.011 - t / (speed * 0.7)) * amp * 0.3;
        x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.07)`;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.strokeStyle = `hsla(${hue}, 95%, 70%, 0.08)`;
      ctx.lineWidth = width * 0.3;
      ctx.stroke();
    }
    ctx.restore();
  }

  // A great striped sun sitting on the horizon, far wider than any one screen.
  const sun = { x: world.w / 2 + 6, y: HORIZON - 30, r: 200 };
  if (x1 > sun.x - sun.r && x0 < sun.x + sun.r && y1 > sun.y - sun.r && y0 < sun.y + sun.r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createLinearGradient(0, sun.y - sun.r, 0, sun.y + sun.r * 0.4);
    g.addColorStop(0, '#fff3a8');
    g.addColorStop(0.45, '#ffb36b');
    g.addColorStop(1, '#ff4f8b');
    ctx.fillStyle = g;
    ctx.fillRect(sun.x - sun.r, sun.y - sun.r, sun.r * 2, sun.r * 2);
    ctx.fillStyle = skyGradient(ctx, world);
    const drift = (t / 90) % 26;
    for (let i = 0; i < 12; i++) {
      const y = sun.y - 30 + i * 26 - drift, h = 2 + i * 1.6;
      if (y > sun.y - sun.r * 0.3) ctx.fillRect(sun.x - sun.r, y, sun.r * 2, h);
    }
    ctx.restore();
    const glow = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.8, sun.x, sun.y, sun.r * 1.9);
    glow.addColorStop(0, 'rgba(255,120,140,0.18)');
    glow.addColorStop(1, 'rgba(255,120,140,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  // Mountain ranges in two depths.
  for (const [seed, amp, lift, color] of [[1.3, 70, 12, '#2b1440'], [4.1, 34, 0, '#140a22']]) {
    if (y1 < HORIZON - lift - amp * 1.2) continue;
    ctx.beginPath();
    ctx.moveTo(x0, world.h);
    for (let x = x0; x <= x1 + 6; x += 6) ctx.lineTo(x, HORIZON - lift - Math.abs(ridge(x, seed, amp)) - amp * 0.2);
    ctx.lineTo(x1 + 6, world.h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Retro ground grid below the desk line.
  if (y1 > HORIZON) {
    ctx.strokeStyle = 'rgba(255,90,170,0.22)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 1; i < 14; i++) {
      const y = HORIZON + i * i * 1.6;
      if (y < y0 || y > y1) continue;
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    }
    const vx = world.w / 2;
    for (let i = -60; i <= 60; i++) {
      const xb = vx + i * 70;
      ctx.moveTo(vx + i * 6, HORIZON);
      ctx.lineTo(xb, world.h);
    }
    ctx.stroke();
  }

  if (grid) drawGrid(ctx, x0, y0, x1, y1);
}

// A millimetre grid shown while aligning screens: lines must continue across bezels.
function drawGrid(ctx, x0, y0, x1, y1) {
  ctx.save();
  for (const [step, alpha, width] of [[10, 0.08, 0.25], [50, 0.22, 0.45]]) {
    ctx.strokeStyle = `rgba(197,250,117,${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  }
  ctx.restore();
}
