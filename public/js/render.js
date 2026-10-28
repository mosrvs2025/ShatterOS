// Every screen renders the same world, shifted to its own place on the desk:
//   screenPx = (worldMm - viewport.originMm) * pxPerMm
import { net, sample, serverNow } from './net.js';
import { scale } from './scale.js';
import { drawWorld } from './art.js';
import { drawFx } from './fx.js';
import { APPS, TYPE } from './apps.js';

const INTERP_DELAY = 95;
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const HIT_RADIUS = { [TYPE.icon]: 10, [TYPE.ball]: 8, [TYPE.boulder]: 16, [TYPE.wanderer]: 12, [TYPE.key]: 9 };

export const view = { x: 0, y: 0, w: 1, h: 1, ppm: 4, dpr: 1, t: 0 };
export let bodies = [];
const overlays = [];
const trails = new Map();
const pressed = new Map();
const sprites = new Map();
let canvas, ctx, idle = true;

export function addOverlay(fn) { overlays.push(fn); }
export function setIdle(v) { idle = v; }
export function pressIcon(id) { pressed.set(id, performance.now()); }
export const toWorld = (px, py) => ({ x: view.x + px / view.ppm, y: view.y + py / view.ppm });

export function hitTest(x, y, slop = 0) {
  let best = null, bestD = Infinity;
  for (const b of bodies) {
    const r = HIT_RADIUS[b.type];
    if (!r) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < r + slop && d < bestD) { best = b; bestD = d; }
  }
  return best;
}

// --------------------------------------------------------------- sprites
function sprite(key, mm, draw) {
  if (sprites.has(key)) return sprites.get(key);
  const res = 18, c = document.createElement('canvas');
  c.width = c.height = Math.ceil(mm * res);
  const g = c.getContext('2d');
  g.scale(res, res);
  draw(g, mm);
  sprites.set(key, c);
  return c;
}

function iconSprite(app) {
  const a = APPS[app];
  return sprite('icon' + app, 22, (g) => {
    g.translate(11, 11);
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 1.6; g.shadowOffsetY = 0.8;
    const grad = g.createLinearGradient(0, -8, 0, 8);
    grad.addColorStop(0, `hsl(${a.hue} 85% 66%)`);
    grad.addColorStop(1, `hsl(${(a.hue + 28) % 360} 75% 42%)`);
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(-8, -8, 16, 16, 4.2); g.fill();
    g.shadowColor = 'transparent';
    const gloss = g.createLinearGradient(0, -8, 0, 1);
    gloss.addColorStop(0, 'rgba(255,255,255,0.38)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gloss;
    g.beginPath(); g.roundRect(-7.4, -7.4, 14.8, 8, [3.6, 3.6, 1, 1]); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.25;
    g.beginPath(); g.roundRect(-7.85, -7.85, 15.7, 15.7, 4.1); g.stroke();
    g.font = `9px ${EMOJI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 0.8; g.shadowOffsetY = 0.4;
    g.fillText(a.glyph, 0, 0.7);
  });
}

function boulderSprite() {
  return sprite('boulder', 34, g => {
    g.translate(17, 17);
    const grad = g.createRadialGradient(-5, -6, 2, 0, 0, 16);
    grad.addColorStop(0, '#9b8e86'); grad.addColorStop(0.6, '#5b4f4b'); grad.addColorStop(1, '#2a2124');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, r = 15 + Math.sin(i * 2.7) * 0.9; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (const [x, y, r] of [[5, 4, 3], [-6, 6, 2], [2, -7, 1.8], [-3, -1, 1.4]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  });
}

function keySprite() {
  return sprite('key', 18, g => {
    g.translate(9, 9);
    const grad = g.createLinearGradient(-6, -4, 6, 4);
    grad.addColorStop(0, '#fff2b0'); grad.addColorStop(0.5, '#ffc94a'); grad.addColorStop(1, '#c9871d');
    g.strokeStyle = grad; g.fillStyle = grad; g.lineWidth = 1.5;
    g.beginPath(); g.arc(-3.5, 0, 2.6, 0, Math.PI * 2); g.stroke();
    g.fillRect(-1, -0.7, 8, 1.4);
    g.fillRect(4, 0.5, 1.2, 2); g.fillRect(6, 0.5, 1.1, 1.6);
  });
}

// ------------------------------------------------------------------ bodies
function drawIcon(b, t) {
  const app = APPS[b.extra];
  if (!app) return;
  const held = b.flags & 1, parked = b.flags & 4;
  const since = performance.now() - (pressed.get(b.id) || -1e9);
  const bounce = since < 500 ? 1 + Math.sin((since / 500) * Math.PI) * 0.18 * (1 - since / 500) : 1;
  const s = (held ? 1.12 : 1) * bounce;
  ctx.save();
  ctx.translate(b.x, b.y);
  if (held) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(1.5, 4, 9, 9, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.rotate(b.a);
  ctx.scale(s, s);
  if (b.flags & 2) { ctx.shadowColor = `hsl(${app.hue} 90% 65%)`; ctx.shadowBlur = 14 * view.ppm * view.dpr / 4; }
  ctx.drawImage(iconSprite(b.extra), -11, -11, 22, 22);
  ctx.restore();
  if (parked) {
    ctx.save();
    ctx.font = `500 ${Math.max(2.6, 10.5 / view.ppm)}px "DM Sans", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    ctx.fillText(app.label, b.x, b.y + 11.8);
    ctx.restore();
  }
}

function drawOrb(b) {
  const hue = b.extra, r = 6;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(b.x, b.y, r * 0.3, b.x, b.y, r * 3);
  glow.addColorStop(0, `hsla(${hue}, 100%, 70%, 0.55)`); glow.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(b.x, b.y, r * 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  const core = ctx.createRadialGradient(b.x - 2, b.y - 2, 0.5, b.x, b.y, r);
  core.addColorStop(0, '#ffffff'); core.addColorStop(0.35, `hsl(${hue} 100% 78%)`); core.addColorStop(1, `hsl(${hue} 85% 48%)`);
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
}

function drawBoulder(b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.a);
  ctx.drawImage(boulderSprite(), -17, -17, 34, 34);
  ctx.restore();
}

function drawKey(b, t) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.6 + 0.4 * Math.sin(t / 260);
  const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 16);
  glow.addColorStop(0, `rgba(255,210,90,${0.45 * pulse})`); glow.addColorStop(1, 'rgba(255,210,90,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.rotate(b.a);
  ctx.drawImage(keySprite(), -9, -9, 18, 18);
  ctx.restore();
}

function drawDoor(b, t) {
  const open = b.extra & 1;
  ctx.save();
  ctx.translate(b.x, b.y);
  const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
  glow.addColorStop(0, `rgba(255,200,110,${open ? 0.5 : 0.18})`); glow.addColorStop(1, 'rgba(255,200,110,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
  const arch = () => { ctx.beginPath(); ctx.moveTo(-8, 14); ctx.lineTo(-8, -6); ctx.arc(0, -6, 8, Math.PI, 0); ctx.lineTo(8, 14); ctx.closePath(); };
  arch();
  const inner = ctx.createLinearGradient(0, -14, 0, 14);
  inner.addColorStop(0, open ? '#fff1c4' : '#2a1838'); inner.addColorStop(1, open ? '#ff9a5a' : '#0f0918');
  ctx.fillStyle = inner;
  ctx.fill();
  if (open) {
    ctx.save(); arch(); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.25 - i * 0.05})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 3 + i * 3 + ((t / 120) % 3), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  arch();
  ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.fillStyle = '#ffd27a';
  ctx.beginPath(); ctx.arc(4.5, 3, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// A silhouette traveller. The walk cycle is a function of world x, so the
// stride stays in step as they pass from one screen to the next.
function drawWanderer(b, t) {
  const dir = b.extra & 1 ? 1 : -1, hasKey = b.extra & 2;
  const phase = (b.x / 7.5) * Math.PI;
  const airborne = Math.abs(b.vy) > 1.2;
  const swing = airborne ? 0.55 : Math.sin(phase) * 0.55;
  const bob = airborne ? 0 : Math.abs(Math.cos(phase)) * 0.6;
  ctx.save();
  ctx.translate(b.x, b.y - bob);
  ctx.scale(dir, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255, 200, 140, 0.55)'; ctx.shadowBlur = 6 * view.ppm * view.dpr / 4;
  ctx.strokeStyle = ctx.fillStyle = '#0a0812';
  const limb = (x, y, angle, len, width) => {
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(angle) * len, y + Math.cos(angle) * len); ctx.stroke();
  };
  limb(0, 2.6, swing, 8.4, 2.3);
  limb(0, 2.6, -swing, 8.4, 2.3);
  ctx.beginPath(); ctx.moveTo(-2.6, 3.4); ctx.lineTo(-1.8, -4.8); ctx.lineTo(1.8, -4.8); ctx.lineTo(2.9, 3.4); ctx.closePath(); ctx.fill();
  limb(0, -4, -swing * 0.9, 6.8, 1.7);
  limb(0, -4, airborne ? 2.6 : swing * 0.9 + 0.1, 6.8, 1.7);
  ctx.beginPath(); ctx.arc(0.3, -8, 2.9, 0, Math.PI * 2); ctx.fill();
  const sway = Math.sin(phase * 0.5 + t / 400) * 0.6;
  ctx.beginPath(); ctx.moveTo(-1.8, -9.5); ctx.quadraticCurveTo(-5.5, -9 + sway, -5 + sway, -5.2); ctx.lineWidth = 1.4; ctx.stroke();
  ctx.restore();
  if (hasKey) {
    ctx.save();
    ctx.translate(b.x + dir * 6.5, b.y + 1 - bob);
    ctx.rotate(dir * 0.5);
    ctx.drawImage(keySprite(), -6, -6, 12, 12);
    ctx.restore();
  }
}

function drawTrails(now) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (const [id, trail] of trails) {
    while (trail.length && now - trail[0].t > 240) trail.shift();
    if (trail.length < 2) { if (!trail.length) trails.delete(id); continue; }
    for (let i = 1; i < trail.length; i++) {
      const p = trail[i - 1], q = trail[i], k = i / trail.length;
      ctx.strokeStyle = q.color;
      ctx.globalAlpha = k * 0.5;
      ctx.lineWidth = q.r * 1.6 * k;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
  }
  ctx.restore();
}

function track(b, now) {
  const fast = Math.hypot(b.vx, b.vy) > 1.4 || b.flags & 3;
  if (!fast || b.type === TYPE.wanderer || b.type === TYPE.door) return;
  const color = b.type === TYPE.ball ? `hsl(${b.extra} 100% 65%)` : b.type === TYPE.icon ? `hsl(${APPS[b.extra]?.hue ?? 0} 90% 65%)` : 'rgba(255,200,160,0.6)';
  const r = b.type === TYPE.boulder ? 12 : b.type === TYPE.ball ? 6 : 7;
  if (!trails.has(b.id)) trails.set(b.id, []);
  trails.get(b.id).push({ x: b.x, y: b.y, t: now, color, r });
}

// --------------------------------------------------------- screen chrome
function drawPortals(me, t) {
  const list = net.desk.portals?.[me.id] || [];
  for (const p of list) {
    const other = net.device(p.id);
    if (!other) continue;
    const vertical = p.edge === 'left' || p.edge === 'right';
    const depth = 7;
    let x, y, w, h, gx0, gy0, gx1, gy1;
    if (p.edge === 'right') { x = me.x + view.w - depth; y = p.from; w = depth; h = p.to - p.from; gx0 = x + depth; gx1 = x; gy0 = gy1 = 0; }
    if (p.edge === 'left') { x = me.x; y = p.from; w = depth; h = p.to - p.from; gx0 = x; gx1 = x + depth; gy0 = gy1 = 0; }
    if (p.edge === 'bottom') { x = p.from; y = me.y + view.h - depth; w = p.to - p.from; h = depth; gy0 = y + depth; gy1 = y; gx0 = gx1 = 0; }
    if (p.edge === 'top') { x = p.from; y = me.y; w = p.to - p.from; h = depth; gy0 = y; gy1 = y + depth; gx0 = gx1 = 0; }
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    const pulse = 0.55 + 0.25 * Math.sin(t / 700);
    g.addColorStop(0, hexA(other.color, 0.55 * pulse)); g.addColorStop(1, hexA(other.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = hexA(other.color, 0.9);
    const line = 0.6;
    if (vertical) ctx.fillRect(p.edge === 'right' ? me.x + view.w - line : me.x, y, line, h);
    else ctx.fillRect(x, p.edge === 'bottom' ? me.y + view.h - line : me.y, w, line);
    // Flowing dashes show the seam is open.
    ctx.save();
    ctx.strokeStyle = hexA(other.color, 0.55);
    ctx.lineWidth = 1.2 / view.ppm;
    ctx.setLineDash([6 / view.ppm, 10 / view.ppm]);
    ctx.lineDashOffset = -t / 40 / view.ppm;
    ctx.beginPath();
    if (vertical) { const lx = p.edge === 'right' ? me.x + view.w - 2.5 : me.x + 2.5; ctx.moveTo(lx, y + 2); ctx.lineTo(lx, y + h - 2); }
    else { const ly = p.edge === 'bottom' ? me.y + view.h - 2.5 : me.y + 2.5; ctx.moveTo(x + 2, ly); ctx.lineTo(x + w - 2, ly); }
    ctx.stroke();
    ctx.restore();
    const size = 10 / view.ppm;
    if (h > size * 8 || w > size * 8) {
      ctx.save();
      ctx.font = `600 ${size}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = hexA(other.color, 0.9);
      ctx.textAlign = 'center';
      const label = `${other.name} ${p.gap > 0 ? '· ' + Math.round(p.gap) + 'mm' : ''}`;
      if (vertical) { ctx.translate(p.edge === 'right' ? me.x + view.w - depth - size * 0.4 : me.x + depth + size * 0.4, y + h / 2); ctx.rotate(p.edge === 'right' ? -Math.PI / 2 : Math.PI / 2); ctx.fillText(label, 0, 0); }
      else ctx.fillText(label, x + w / 2, p.edge === 'bottom' ? me.y + view.h - depth - size * 0.3 : me.y + depth + size);
      ctx.restore();
    }
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// Glowing hints for things flying just beyond this screen's edges.
function drawOffscreen(me) {
  const pad = 220, w = innerWidth, h = innerHeight;
  for (const b of bodies) {
    if (b.flags & 4 || b.type === TYPE.door) continue;
    const lx = b.x - view.x, ly = b.y - view.y;
    if (lx >= 0 && lx <= view.w && ly >= 0 && ly <= view.h) continue;
    const cx = Math.max(0, Math.min(view.w, lx)), cy = Math.max(0, Math.min(view.h, ly)), dist = Math.hypot(lx - cx, ly - cy);
    if (dist > pad) continue;
    const k = 1 - dist / pad, px = cx * view.ppm, py = cy * view.ppm;
    const color = b.type === TYPE.ball ? `hsla(${b.extra},100%,70%,` : b.type === TYPE.wanderer ? 'rgba(255,214,150,' : b.type === TYPE.icon ? `hsla(${APPS[b.extra]?.hue ?? 0},90%,70%,` : 'rgba(255,255,255,';
    const g = ctx.createRadialGradient(px, py, 0, px, py, 26 * k + 6);
    g.addColorStop(0, color + (0.75 * k) + ')'); g.addColorStop(1, color + '0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, 26 * k + 6, 0, Math.PI * 2); ctx.fill();
    if (b.type === TYPE.wanderer && k > 0.2) {
      ctx.font = '600 11px "Space Grotesk", sans-serif';
      ctx.fillStyle = `rgba(255,230,190,${k})`;
      ctx.textAlign = px < 40 ? 'left' : px > w - 40 ? 'right' : 'center';
      ctx.fillText('wanderer incoming', Math.max(8, Math.min(w - 8, px)), Math.max(16, Math.min(h - 10, py + (py < 40 ? 22 : -14))));
    }
  }
}

// ------------------------------------------------------------------- loop
function frame() {
  requestAnimationFrame(frame);
  const dpr = Math.min(devicePixelRatio || 1, 2.5), cw = innerWidth, ch = innerHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const t = serverNow() - INTERP_DELAY, now = performance.now();
  const me = idle ? null : net.me();
  view.dpr = dpr;
  view.t = t;
  if (me) {
    view.ppm = scale.pxPerMm;
    view.x = me.x; view.y = me.y;
  } else {
    // Boot: a slow cinematic drift across the wallpaper.
    view.ppm = Math.max(cw / 900, ch / 520);
    view.x = 1240 - cw / view.ppm / 2 + Math.sin(Date.now() / 14000) * 160;
    view.y = 1175 - ch / view.ppm;
  }
  view.w = cw / view.ppm;
  view.h = ch / view.ppm;

  ctx.setTransform(dpr * view.ppm, 0, 0, dpr * view.ppm, -view.x * dpr * view.ppm, -view.y * dpr * view.ppm);
  drawWorld(ctx, view, net.world, idle ? Date.now() : t, { grid: !idle && (net.desk.linking || net.desk.identify) });
  if (!me) return;

  bodies = sample(t);
  drawPortals(me, t);
  for (const b of bodies) track(b, now);
  drawTrails(now);
  const order = [TYPE.door, TYPE.icon, TYPE.key, TYPE.boulder, TYPE.wanderer, TYPE.ball];
  const pad = 40;
  for (const type of order) for (const b of bodies) {
    if (b.type !== type || b.x < view.x - pad || b.x > view.x + view.w + pad || b.y < view.y - pad || b.y > view.y + view.h + pad) continue;
    if (type === TYPE.icon) drawIcon(b, t);
    else if (type === TYPE.ball) drawOrb(b);
    else if (type === TYPE.boulder) drawBoulder(b);
    else if (type === TYPE.wanderer) drawWanderer(b, t);
    else if (type === TYPE.key) drawKey(b, t);
    else if (type === TYPE.door) drawDoor(b, t);
  }
  drawFx(ctx, view, t, net.desk.devices);
  for (const fn of overlays) fn(ctx, view, t, 'world');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawOffscreen(me);
  for (const fn of overlays) fn(ctx, view, t, 'screen');
}

export function startRenderer(el) {
  canvas = el;
  ctx = canvas.getContext('2d', { alpha: false });
  requestAnimationFrame(frame);
}
