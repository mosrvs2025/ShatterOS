// Touch, pen and mouse. One gesture at a time:
//   press an icon and release quickly → open that app
//   press any object and drag        → grab it; let go to fling it across screens
//   press empty space and pull back   → slingshot an orb (with a trajectory preview)
//   double-tap empty space            → shockwave
//   in Link mode, swipe off this screen onto another → align the two
import { net, serverNow } from './net.js';
import { view, bodies, hitTest, addOverlay, toWorld, pressIcon } from './render.js';
import { addFx } from './fx.js';
import { APPS, TYPE, GRAVITY, STEP_MS } from './apps.js';
import { buzz } from './audio.js';

let gesture = null, lastTap = { t: 0, x: 0, y: 0 }, pendingDrag = null, linkTrail = [];

const history = [];
function remember(e) {
  history.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  while (history.length > 2 && performance.now() - history[0].t > 90) history.shift();
}
function velocityPx() {
  if (history.length < 2) return { vx: 0, vy: 0 };
  const a = history[0], b = history[history.length - 1], dt = Math.max(8, b.t - a.t);
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}

function edgeOf(px, py, margin) {
  const d = { left: px, right: innerWidth - px, top: py, bottom: innerHeight - py };
  const [edge, dist] = Object.entries(d).sort((a, b) => a[1] - b[1])[0];
  return dist <= margin ? edge : null;
}
const alongOf = (edge, px, py) => (edge === 'left' || edge === 'right' ? py : px) / view.ppm;

function down(e) {
  if (!net.id || e.button > 0) return;
  e.preventDefault();
  if (gesture) return;
  e.target.setPointerCapture(e.pointerId);
  history.length = 0;
  remember(e);
  const w = toWorld(e.clientX, e.clientY), now = performance.now();

  if (net.desk.linking) {
    const margin = Math.min(48, Math.min(innerWidth, innerHeight) * 0.12);
    const edge = edgeOf(e.clientX, e.clientY, margin);
    if (edge) net.send('edge', { phase: 'enter', edge, along: alongOf(edge, e.clientX, e.clientY), t: serverNow() });
    gesture = { kind: 'link', id: e.pointerId };
    linkTrail = [{ x: e.clientX, y: e.clientY, t: now }];
    return;
  }

  const slop = e.pointerType === 'touch' ? 6 : 2;
  const body = hitTest(w.x, w.y, slop);
  if (body && body.type === TYPE.icon && body.flags & 4) {
    gesture = { kind: 'icon', id: e.pointerId, body, start: w, at: now };
    gesture.timer = setTimeout(() => startGrab(gesture), 260);
  } else if (body) {
    gesture = { kind: 'grab', id: e.pointerId, body, start: w };
    startGrab(gesture);
  } else {
    gesture = { kind: 'sling', id: e.pointerId, start: w, current: w, at: now };
  }
}

// Always grab at the original press point; the drag target then follows the pointer.
function startGrab(g) {
  if (gesture !== g) return;
  clearTimeout(g.timer);
  g.kind = 'grab';
  net.send('grab', { id: g.body.id, x: g.start.x, y: g.start.y });
  buzz(8);
}

function move(e) {
  if (!gesture || e.pointerId !== gesture.id) return;
  remember(e);
  const w = toWorld(e.clientX, e.clientY);
  if (gesture.kind === 'link') { linkTrail.push({ x: e.clientX, y: e.clientY, t: performance.now() }); return; }
  if (gesture.kind === 'icon' && Math.hypot(w.x - gesture.start.x, w.y - gesture.start.y) > 2.5) startGrab(gesture);
  if (gesture.kind === 'grab') { gesture.current = w; pendingDrag = w; }
  if (gesture.kind === 'sling') gesture.current = w;
}

function up(e) {
  if (!gesture || e.pointerId !== gesture.id) return;
  const g = gesture;
  gesture = null;
  clearTimeout(g.timer);
  const w = toWorld(e.clientX, e.clientY), now = performance.now();
  const v = velocityPx(), toStep = STEP_MS / view.ppm;

  if (g.kind === 'link') {
    const margin = Math.min(56, Math.min(innerWidth, innerHeight) * 0.14);
    const px = Math.max(0, Math.min(innerWidth, e.clientX)), py = Math.max(0, Math.min(innerHeight, e.clientY));
    const edge = edgeOf(px, py, margin);
    const outward = { left: -v.vx, right: v.vx, top: -v.vy, bottom: v.vy }[edge];
    if (edge && outward > 0.15) net.send('edge', { phase: 'exit', edge, along: alongOf(edge, px, py), t: serverNow(), speed: Math.hypot(v.vx, v.vy) / view.ppm });
    return;
  }
  if (g.kind === 'icon') {
    pressIcon(g.body.id);
    buzz(12);
    net.emitLocal('app', { id: APPS[g.body.extra].id, x: g.body.x, y: g.body.y });
    return;
  }
  if (g.kind === 'grab') {
    pendingDrag = null;
    net.send('release', { vx: v.vx * toStep, vy: v.vy * toStep });
    return;
  }
  if (g.kind === 'sling') {
    const pull = { x: g.start.x - w.x, y: g.start.y - w.y }, len = Math.hypot(pull.x, pull.y);
    if (len < 3 && now - g.at < 350) {
      addFx({ k: 'ripple', x: w.x, y: w.y, t: view.t });
      if (now - lastTap.t < 320 && Math.hypot(w.x - lastTap.x, w.y - lastTap.y) < 12) { net.send('action', { type: 'wave', x: w.x, y: w.y }); lastTap.t = 0; }
      else lastTap = { t: now, x: w.x, y: w.y };
      return;
    }
    if (len >= 3) {
      const launch = slingVelocity(pull);
      net.send('action', { type: 'orb', x: g.start.x, y: g.start.y, vx: launch.x, vy: launch.y });
      buzz(15);
    }
  }
}

function cancel(e) {
  if (gesture?.kind === 'link') return up(e);
  if (gesture?.kind === 'grab') net.send('release', {});
  if (gesture) clearTimeout(gesture.timer);
  gesture = null;
}

function slingVelocity(pull) {
  const k = 0.2, len = Math.hypot(pull.x, pull.y), max = 38, s = Math.min(1, max / (len * k));
  return { x: pull.x * k * s, y: pull.y * k * s };
}

// Send drag targets at most once per frame.
function flush() {
  requestAnimationFrame(flush);
  if (pendingDrag) { net.send('drag', pendingDrag); pendingDrag = null; }
}

function drawWorldOverlay(ctx, v) {
  if (!gesture) return;
  if (gesture.kind === 'sling' && gesture.current) {
    const { start, current } = gesture, pull = { x: start.x - current.x, y: start.y - current.y };
    if (Math.hypot(pull.x, pull.y) < 3) return;
    const me = net.me(), g = me?.gravity || { x: 0, y: 1 }, strength = GRAVITY[net.desk.gravity] ?? 2;
    const launch = slingVelocity(pull), ax = g.x * strength * 0.001 * STEP_MS * STEP_MS, ay = g.y * strength * 0.001 * STEP_MS * STEP_MS;
    let x = start.x, y = start.y, vx = launch.x, vy = launch.y;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 90; i++) {
      vx += ax; vy += ay; x += vx; y += vy;
      if (i % 3 === 0) { ctx.globalAlpha = 0.85 * (1 - i / 90); ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#c5fa75'; ctx.lineWidth = 1.2; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(current.x, current.y); ctx.stroke();
    ctx.setLineDash([]);
    const glow = ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, 10);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)'); glow.addColorStop(1, 'rgba(197,250,117,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(start.x, start.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (gesture.kind === 'grab' && gesture.current) {
    const b = bodies.find(o => o.id === gesture.body.id);
    if (!b) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(197,250,117,0.8)'; ctx.lineWidth = 0.7; ctx.setLineDash([1.5, 1.5]);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(gesture.current.x, gesture.current.y); ctx.stroke();
    ctx.fillStyle = '#c5fa75';
    ctx.beginPath(); ctx.arc(gesture.current.x, gesture.current.y, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawScreenOverlay(ctx) {
  if (!net.desk.linking) { linkTrail = []; return; }
  const now = performance.now();
  linkTrail = linkTrail.filter(p => now - p.t < 500);
  if (linkTrail.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 1; i < linkTrail.length; i++) {
    const a = linkTrail[i - 1], b = linkTrail[i], k = 1 - (now - b.t) / 500;
    ctx.strokeStyle = `rgba(197,250,117,${k})`;
    ctx.lineWidth = 14 * k + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

export function startInput(canvas) {
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  addOverlay((ctx, v, t, layer) => (layer === 'world' ? drawWorldOverlay(ctx, v) : drawScreenOverlay(ctx)));
  requestAnimationFrame(flush);
}
