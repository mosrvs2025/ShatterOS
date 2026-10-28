// The ShatterOS shell: boot, menubar, dock, sheets, shared overlays and the
// watch remote. Everything spatial is delegated to the shared world.
import { net, connect, serverNow, updateJoinParams } from './net.js';
import { scale, detectKind, guessName, deviceKey, KIND_ICON, KIND_LABEL } from './scale.js';
import { view, bodies, setIdle } from './render.js';
import { addFx } from './fx.js';
import { APPS, TYPE, GRAVITY_LABEL } from './apps.js';
import { sfx, unlockAudio, buzz } from './audio.js';
import { sensors } from './sensors.js';

const $ = id => document.getElementById(id);
const body = document.body;
const INTERP_DELAY = 95;
const store = {
  get(k) { try { return localStorage.getItem('shatteros.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('shatteros.' + k, v); } catch {} },
};
const params = new URL(location.href).searchParams;
const coarse = matchMedia('(pointer: coarse)').matches;
let kind = store.get('kind') || detectKind();
let createdWorld = false;

// ------------------------------------------------------------------ toasts
export function toast(html, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  $('toasts').append(el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// -------------------------------------------------------------------- boot
function setKind(k) {
  kind = k;
  for (const b of document.querySelectorAll('.kind')) b.setAttribute('aria-checked', String(b.dataset.kind === k));
  const name = $('name');
  if (!name.dataset.touched) name.value = store.get('name') || guessName(k);
}

function initBoot() {
  for (const b of document.querySelectorAll('.kind')) b.onclick = () => { setKind(b.dataset.kind); store.set('kind', b.dataset.kind); };
  $('name').oninput = () => { $('name').dataset.touched = '1'; };
  setKind(kind);
  const invited = (params.get('room') || '').toUpperCase();
  if (invited) {
    $('invite').hidden = false;
    $('inviteRoom').textContent = invited;
    $('enter').textContent = 'Enter the world →';
    $('joinCode').hidden = true;
  }
  $('enter').onclick = () => enter(invited || newCode(), !invited);
  $('joinBtn').onclick = () => { const code = $('room').value.trim().toUpperCase(); if (code) enter(code, false); else $('room').focus(); };
  $('room').onkeydown = e => { if (e.key === 'Enter') $('joinBtn').click(); };
}

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), n => chars[n % chars.length]).join('');
}

async function enter(room, created) {
  $('bootError').textContent = '';
  if (!/^[A-Z0-9-]{3,24}$/.test(room)) { $('bootError').textContent = 'Room codes use 3–24 letters, numbers or hyphens.'; return; }
  unlockAudio();
  if (coarse && kind !== 'desktop') fullscreen(true);
  if ((kind === 'phone' || kind === 'tablet') && sensors.available() && isSecureContext) { try { await sensors.enable(); } catch {} }
  const name = $('name').value.trim() || guessName(kind);
  store.set('name', name);
  store.set('kind', kind);
  scale.init(kind);
  $('enter').disabled = true;
  const result = await connect({ room, name, kind, key: deviceKey(), ...scale.size() });
  $('enter').disabled = false;
  if (result.error) { $('bootError').textContent = result.error; net.socket.disconnect(); return; }
  createdWorld = created;
  const url = new URL(location.href);
  url.searchParams.set('room', result.room);
  history.replaceState(null, '', url);
  body.classList.add('entering');
  body.classList.toggle('watch', kind === 'watch');
  setTimeout(() => { body.classList.remove('booting', 'entering'); setIdle(false); afterEnter(); }, 650);
  wakeLock();
}

function afterEnter() {
  sfx.join();
  const me = net.me();
  if (me) addFx({ k: 'wave', x: me.x + view.w / 2, y: me.y + view.h / 2, t: view.t });
  showDock();
  if (kind === 'watch') return initRemote();
  const others = net.desk.devices.length - 1;
  toast(others ? `Joined <i>${esc(net.room)}</i> · ${others} other screen${others > 1 ? 's' : ''} here` : `World <i>${esc(net.room)}</i> is live`);
  if (!others && createdWorld) setTimeout(() => { if (net.desk.devices.length < 2) openSheet('add'); }, 1400);
  else if (!scale.calibrated) setTimeout(() => toast('Tip: ◈ menu → <i>Calibrate physical size</i> for true scale', 4200), 2500);
}

// ----------------------------------------------------------------- actions
function myPortals() { return net.desk.portals?.[net.id] || []; }

export function runApp(id, at) {
  const me = net.me();
  if (!me) return;
  const target = kind === 'watch' ? net.host() || me : me;
  const tw = target === me ? view.w : target.w, th = target === me ? view.h : target.h;
  const centre = at || { x: target.x + tw / 2, y: target.y + th / 2 };
  const edges = new Set(myPortals().map(p => p.edge));
  const dir = edges.has('right') ? 1 : edges.has('left') ? -1 : 1;
  const send = (type, extra = {}) => net.send('action', { type, ...extra });
  switch (id) {
    case 'orb':
      if (at) send('orb', { x: at.x, y: at.y - 14, vx: dir * 9, vy: -9 });
      else send('orb', { x: dir > 0 ? target.x + 18 : target.x + tw - 18, y: target.y + 30, vx: dir * 13, vy: -5 });
      break;
    case 'boulder': send('boulder', { x: at ? at.x : target.x + tw / 2, y: at ? at.y - 24 : target.y + 26, vx: dir * 3, vy: 0 }); break;
    case 'wanderer': send('wanderer', { x: target.x + Math.min(22, tw / 3), y: target.y + th - 16, vx: dir }); break;
    case 'wave': send('wave', centre); break;
    case 'confetti': send('confetti', { x: centre.x, y: at ? at.y : target.y + th * 0.65 }); break;
    case 'magnet': case 'gravity': case 'showtime': case 'quest': case 'reset': send(id); break;
    case 'link': setLinking(true); break;
    case 'map': openSheet('map'); break;
    case 'add': openSheet('add'); break;
  }
}

function setLinking(on) {
  net.send('linkmode', { on });
}

// -------------------------------------------------------------------- dock
const DOCK = ['orb', 'boulder', 'wanderer', 'wave', 'magnet', 'gravity', 'confetti', 'showtime', '|', 'quest', 'link', 'map', 'add'];
let dockTimer = 0;

function buildDock() {
  const dock = $('dock');
  for (const id of DOCK) {
    if (id === '|') { const s = document.createElement('span'); s.className = 'sep'; dock.append(s); continue; }
    const app = APPS.find(a => a.id === id);
    const b = document.createElement('button');
    b.className = 'dock-item';
    b.style.setProperty('--h', app.hue);
    b.dataset.app = id;
    b.innerHTML = `${app.glyph}<span class="tip">${app.label} <kbd>${app.key === ' ' ? 'Space' : app.key.toUpperCase()}</kbd></span>`;
    b.setAttribute('aria-label', `${app.label}: ${app.hint}`);
    b.onclick = () => { buzz(10); runApp(id); showDock(); };
    dock.append(b);
  }
  if (coarse && sensors.available()) {
    const b = document.createElement('button');
    b.className = 'dock-item';
    b.id = 'tiltBtn';
    b.style.setProperty('--h', 170);
    b.innerHTML = '📐<span class="tip">Tilt</span>';
    b.onclick = toggleTilt;
    dock.append(b);
  }
  // Desktop magnification.
  const items = () => [...dock.querySelectorAll('.dock-item')];
  dock.addEventListener('mousemove', e => {
    for (const el of items()) {
      const r = el.getBoundingClientRect(), d = Math.abs(e.clientX - (r.left + r.width / 2));
      el.style.transform = `scale(${1 + 0.5 * Math.max(0, 1 - d / 120)})`;
    }
    showDock();
  });
  dock.addEventListener('mouseleave', () => items().forEach(el => (el.style.transform = '')));
  $('dockHandle').onclick = showDock;
  addEventListener('mousemove', e => { if (e.clientY > innerHeight - 90) showDock(); });
}

function showDock() {
  body.classList.remove('dock-hidden');
  clearTimeout(dockTimer);
  dockTimer = setTimeout(() => { if (!$('dock').matches(':hover')) body.classList.add('dock-hidden'); else showDock(); }, coarse ? 4500 : 5000);
}

async function toggleTilt() {
  try {
    if (sensors.enabled) { sensors.disable(); toast('Tilt off'); }
    else { await sensors.enable(); toast('Tilt on — tip this screen like a ramp'); }
  } catch (e) { toast(esc(e.message), 4200); }
  $('tiltBtn')?.classList.toggle('on', sensors.enabled);
}

// ----------------------------------------------------------------- menubar
function initMenubar() {
  const menu = $('menu'), logo = $('logoBtn');
  const closeMenu = () => { menu.hidden = true; logo.setAttribute('aria-expanded', 'false'); };
  logo.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; logo.setAttribute('aria-expanded', String(!menu.hidden)); };
  addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== logo) closeMenu(); });
  menu.onclick = e => {
    const cmd = e.target.closest('button')?.dataset.cmd;
    closeMenu();
    if (cmd === 'about') openSheet('about');
    if (cmd === 'calibrate') openSheet('calibrate');
    if (cmd === 'rename') {
      const name = prompt('Name this screen', net.me()?.name || '');
      if (name?.trim()) { store.set('name', name.trim()); updateJoinParams({ name: name.trim() }); net.send('rename', { name: name.trim() }); }
    }
    if (cmd === 'tilt') toggleTilt();
    if (cmd === 'cinema') cinema(true);
    if (cmd === 'fullscreen') fullscreen();
    if (cmd === 'reset' && confirm('Reset the whole world for every screen?')) runApp('reset');
    if (cmd === 'leave') { net.socket.disconnect(); location.href = location.pathname; }
  };
  $('gravityPill').onclick = () => runApp('gravity');
  $('roomPill').onclick = () => openSheet('add');
  $('screensPill').onclick = () => openSheet('map');
  $('cinemaExit').onclick = () => { if (body.classList.contains('watch')) body.classList.remove('watch-view'), ($('remote').hidden = false); else cinema(false); };
  const tick = () => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 10000);
  net.on('status', s => $('net').classList.toggle('online', s === 'online'));
  net.on('rejoined', r => { if (!r.error) toast('Reconnected'); });
}

function cinema(on) {
  body.classList.toggle('cinema', on);
  if (on) toast('Cinema mode · press <i>H</i> or tap ◈ to exit', 2200);
}

function fullscreen(force) {
  const el = document.documentElement;
  if (!document.fullscreenElement || force) el.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
  else document.exitFullscreen?.();
}

async function wakeLock() {
  try {
    await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {}); }, { once: true });
  } catch {}
}

// -------------------------------------------------------------------- desk
function onDesk(desk) {
  const me = net.me();
  $('screenCount').textContent = desk.devices.length;
  $('dots').replaceChildren(...desk.devices.map(d => {
    const i = document.createElement('i');
    i.style.background = d.color; i.style.color = d.color;
    i.title = d.name;
    if (d.id === net.id) i.className = 'me';
    return i;
  }));
  $('roomCode').textContent = net.room || '';
  $('gravityPill').textContent = GRAVITY_LABEL[desk.gravity] || '';
  const q = desk.quest;
  $('questPill').hidden = !q.active;
  if (q.active) $('questPill').textContent = q.hasKey ? '🗝️ Key found — reach the door' : `🗝️ Find the key on ${net.device(q.keyDevice)?.name || 'a screen'}${q.wins ? ` · ✦ ${q.wins}` : ''}`;
  body.classList.toggle('identify', !!desk.identify);
  if (me) {
    body.style.setProperty('--me', me.color);
    $('identify').querySelector('.id-name').textContent = me.name;
    $('identify').querySelector('.id-kind').textContent = `${KIND_ICON[me.kind]} ${KIND_LABEL[me.kind]} · ${Math.round(me.w)} × ${Math.round(me.h)} mm`;
  }
  $('linkHint').hidden = !desk.linking;
  if (mapOpen) drawMap();
}

// ---------------------------------------------------------------------- fx
function inView(x, y, pad = 0) {
  return x >= view.x - pad && x <= view.x + view.w + pad && y >= view.y - pad && y <= view.y + view.h + pad;
}
const panOf = x => Math.max(-1, Math.min(1, ((x - view.x) / view.w) * 2 - 1));
const later = fn => setTimeout(fn, Math.max(0, INTERP_DELAY - net.rtt / 2));

function onFx(e) {
  const at = serverNow();
  switch (e.k) {
    case 'hit':
      if (!inView(e.x, e.y, 6)) break;
      later(() => { sfx.hit(e.type, e.p, panOf(e.x)); if (e.p > 4 && coarse) buzz(Math.min(40, e.p * 4)); });
      if (e.p > 3) addFx({ k: 'spark', x: e.x, y: e.y, p: e.p, t: at, color: e.type === TYPE.boulder ? '#ffcf9a' : '#fff6c8' });
      break;
    case 'wave':
      addFx(e);
      if (inView(e.x, e.y, 150)) later(() => sfx.boom(panOf(e.x)));
      break;
    case 'confetti':
      addFx(e);
      if (inView(e.x, e.y, 200)) later(() => sfx.pop(panOf(e.x)));
      break;
    case 'poof': case 'key': case 'win':
      addFx({ ...e, t: at });
      if (e.k === 'key') { later(sfx.key); toast('🗝️ The wanderer found the key!'); }
      if (e.k === 'win') { later(sfx.win); toast(`✦ Through the door! <i>Quest ${e.wins} complete</i> — a new key appeared`, 3600); }
      break;
    case 'link': {
      addFx({ ...e, t: at });
      const a = net.device(e.a), b = net.device(e.b);
      if (e.a === net.id || e.b === net.id) { later(sfx.chime); buzz([20, 40, 20]); }
      if (a && b) toast(`🔗 Linked <i>${esc(a.name)}</i> → <i>${esc(b.name)}</i> · ${e.gap} mm gap`);
      break;
    }
    case 'count': countdown(e.at); break;
    case 'joined': toast(`✨ <i>${esc(e.name)}</i> joined the world`); sfx.join(); addFx({ k: 'portal', a: net.id, b: e.id, edge: edgeTowards(e.id), t: at + 400 }); break;
    case 'left': toast(`${esc(e.name)} left`); break;
    case 'magnet': sfx.magnet(); break;
    case 'gravity': toast(`Gravity: <i>${GRAVITY_LABEL[e.mode]}</i>`); break;
    case 'quest': toast('🗝️ Quest: guide the wanderer to the key, then through the door', 3800); break;
  }
}

function edgeTowards(id) {
  return (net.desk.portals?.[net.id] || []).find(p => p.id === id)?.edge || 'right';
}

function countdown(atServer) {
  const el = $('countdown');
  for (const [n, offset] of [['3', -3000], ['2', -2000], ['1', -1000], ['GO', 0]]) {
    const wait = atServer + offset - serverNow();
    if (wait < -300) continue;
    setTimeout(() => {
      el.innerHTML = `<span>${n}</span>`;
      sfx.count(n === 'GO');
      buzz(n === 'GO' ? 120 : 30);
      if (n === 'GO') setTimeout(() => { el.innerHTML = ''; }, 900);
    }, Math.max(0, wait));
  }
}

// ------------------------------------------------------------------ sheets
let mapOpen = false;

function openSheet(name) {
  closeSheets();
  $('scrim').hidden = false;
  $('sheet-' + name).hidden = false;
  if (name === 'add') fillAdd();
  if (name === 'map') { mapOpen = true; net.send('identify', { on: true }); requestAnimationFrame(mapLoop); }
  if (name === 'calibrate') fillCalibrate();
  if (name === 'about') fillAbout();
}

function closeSheets() {
  if (mapOpen) net.send('identify', { on: false });
  mapOpen = false;
  $('scrim').hidden = true;
  for (const s of document.querySelectorAll('.sheet')) s.hidden = true;
}

let info = null;
async function fillAdd() {
  if (!info) { try { info = await (await fetch('/api/info')).json(); } catch { info = { lan: [] }; } }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const base = local && info.lan?.length ? info.lan[0] : location.origin;
  const url = `${base}/?room=${encodeURIComponent(net.room)}`;
  $('joinUrl').textContent = url;
  $('qr').src = '/qr.svg?data=' + encodeURIComponent(url);
  const notes = [];
  if (local && !info.lan?.length) notes.push('This computer has no network address other devices can reach. Connect to Wi‑Fi first.');
  if (local && info.lan?.length) notes.push('Using your local network address so phones on the same Wi‑Fi can join.');
  if (!isSecureContext || location.protocol === 'http:') notes.push('Phones need HTTPS for tilt and shake: run <code>npm run start:https</code> or use a tunnel.');
  $('addNote').innerHTML = notes.join(' ');
  $('copyUrl').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Copy failed — select the link instead'); } };
}

function fillAbout() {
  const rows = APPS.filter(a => a.key).map(a => `<div><span>${a.glyph} ${a.label}</span><kbd>${a.key === ' ' ? 'Space' : a.key.toUpperCase()}</kbd></div>`);
  rows.push('<div><span>🎞️ Cinema</span><kbd>H</kbd></div>', '<div><span>⛶ Full screen</span><kbd>F</kbd></div>');
  $('shortcuts').innerHTML = rows.join('');
}

// Bank-card calibration: ISO/IEC 7810 ID-1 is 85.60 × 53.98 mm.
let draftPpm = 4;
function fillCalibrate() {
  draftPpm = scale.pxPerMm;
  $('calRange').value = draftPpm;
  renderCard();
  $('calRange').oninput = () => { draftPpm = Number($('calRange').value); renderCard(); };
  $('calMinus').onclick = () => { draftPpm -= 0.02; $('calRange').value = draftPpm; renderCard(); };
  $('calPlus').onclick = () => { draftPpm += 0.02; $('calRange').value = draftPpm; renderCard(); };
  $('calDone').onclick = () => {
    scale.set(draftPpm);
    const size = scale.size();
    updateJoinParams(size);
    net.send('layout', size);
    closeSheets();
    toast(`True size saved · this screen is <i>${Math.round(size.w)} × ${Math.round(size.h)} mm</i>`);
  };
}
function renderCard() {
  const card = $('cardOutline');
  card.style.width = 85.6 * draftPpm + 'px';
  card.style.height = 53.98 * draftPpm + 'px';
  card.style.borderRadius = 3.18 * draftPpm + 'px';
  $('calInfo').textContent = `${(draftPpm * 25.4).toFixed(0)} CSS px per inch · this screen ≈ ${Math.round(innerWidth / draftPpm)} × ${Math.round(innerHeight / draftPpm)} mm`;
}

// --------------------------------------------------------------- desk map
const map = { frozen: null, drag: null };
function mapFrame() {
  const devices = net.desk.devices;
  if (map.frozen) return map.frozen;
  if (!devices.length) return { x: 0, y: 0, w: net.world.w, h: net.world.h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of devices) { x0 = Math.min(x0, d.x); y0 = Math.min(y0, d.y); x1 = Math.max(x1, d.x + d.w); y1 = Math.max(y1, d.y + d.h); }
  const pad = Math.max(120, (x1 - x0) * 0.3);
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
function mapTransform(c) {
  const f = mapFrame(), s = Math.min(c.clientWidth / f.w, c.clientHeight / f.h);
  return { s, ox: (c.clientWidth - f.w * s) / 2 - f.x * s, oy: (c.clientHeight - f.h * s) / 2 - f.y * s };
}
function mapLoop() { if (!mapOpen) return; drawMap(); requestAnimationFrame(mapLoop); }
function drawMap() {
  const c = $('map'), dpr = devicePixelRatio || 1;
  if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
  const g = c.getContext('2d'), { s, ox, oy } = mapTransform(c);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, c.clientWidth, c.clientHeight);
  g.save();
  g.translate(ox, oy); g.scale(s, s);
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1 / s;
  g.beginPath();
  for (let x = 0; x <= net.world.w; x += 50) { g.moveTo(x, 0); g.lineTo(x, net.world.h); }
  for (let y = 0; y <= net.world.h; y += 50) { g.moveTo(0, y); g.lineTo(net.world.w, y); }
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.strokeRect(0, 0, net.world.w, net.world.h);
  for (const d of net.desk.devices) {
    g.fillStyle = d.color + '22';
    g.strokeStyle = d.color; g.lineWidth = (d.id === net.id ? 2.5 : 1.5) / s;
    g.beginPath(); g.roundRect(d.x, d.y, d.w, d.h, Math.min(d.w, d.h) * 0.06); g.fill(); g.stroke();
    g.fillStyle = '#fff';
    g.font = `600 ${13 / s}px "Space Grotesk", sans-serif`;
    g.fillText(`${KIND_ICON[d.kind]} ${d.name}${d.id === net.id ? ' (this)' : ''}`, d.x + 6 / s, d.y + 18 / s);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = `${11 / s}px "DM Sans", sans-serif`;
    g.fillText(`${Math.round(d.w)}×${Math.round(d.h)} mm`, d.x + 6 / s, d.y + 33 / s);
  }
  // Open seams.
  g.lineWidth = 4 / s; g.lineCap = 'round';
  for (const [id, list] of Object.entries(net.desk.portals || {})) for (const p of list) {
    const d = net.device(id);
    if (!d || (p.edge !== 'right' && p.edge !== 'bottom')) continue;
    g.strokeStyle = '#c5fa75';
    g.shadowColor = '#c5fa75'; g.shadowBlur = 10;
    g.beginPath();
    if (p.edge === 'right') { const x = d.x + d.w + p.gap / 2; g.moveTo(x, p.from); g.lineTo(x, p.to); }
    else { const y = d.y + d.h + p.gap / 2; g.moveTo(p.from, y); g.lineTo(p.to, y); }
    g.stroke();
  }
  g.shadowBlur = 0;
  for (const b of bodies) {
    if (b.type === TYPE.door) continue;
    g.fillStyle = b.type === TYPE.ball ? `hsl(${b.extra} 100% 70%)` : b.type === TYPE.wanderer ? '#ffd27a' : b.type === TYPE.icon ? `hsl(${APPS[b.extra]?.hue} 80% 65%)` : '#ccc';
    g.beginPath(); g.arc(b.x, b.y, Math.max(3 / s, b.type === TYPE.boulder ? 15 : 6), 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
function initMap() {
  const c = $('map');
  const world = e => { const r = c.getBoundingClientRect(), { s, ox, oy } = mapTransform(c); return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s }; };
  c.onpointerdown = e => {
    const p = world(e), d = [...net.desk.devices].reverse().find(o => p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h);
    if (!d) return;
    map.frozen = mapFrame();
    map.drag = { id: d.id, dx: p.x - d.x, dy: p.y - d.y, last: 0 };
    c.setPointerCapture(e.pointerId);
    c.style.cursor = 'grabbing';
  };
  c.onpointermove = e => {
    if (!map.drag) return;
    const p = world(e), now = performance.now();
    if (now - map.drag.last < 30) return;
    map.drag.last = now;
    net.send('layout', { id: map.drag.id, x: p.x - map.drag.dx, y: p.y - map.drag.dy, snap: true });
  };
  c.onpointerup = c.onpointercancel = e => {
    if (!map.drag) return;
    const p = world(e);
    net.send('layout', { id: map.drag.id, x: p.x - map.drag.dx, y: p.y - map.drag.dy, snap: true });
    map.drag = null; map.frozen = null;
    c.style.cursor = '';
  };
  $('arrange').onclick = () => {
    const list = [...net.desk.devices].sort((a, b) => a.x - b.x), gap = 12;
    const total = list.reduce((s, d) => s + d.w, 0) + gap * (list.length - 1);
    let x = net.world.w / 2 - total / 2;
    for (const d of list) { net.send('layout', { id: d.id, x, y: 1150 - d.h }); x += d.w + gap; }
    toast('Arranged in a row, bottoms on the same desk line');
  };
  $('mapLink').onclick = () => { closeSheets(); setLinking(true); };
  $('mapDone').onclick = closeSheets;
}

// ------------------------------------------------------------- watch remote
const REMOTE = ['magnet', 'wave', 'confetti', 'orb', 'gravity', 'showtime', 'boulder', 'wanderer', 'quest'];
let remoteIndex = 0;
function initRemote() {
  $('remote').hidden = false;
  const dots = document.querySelector('.r-dots');
  dots.replaceChildren(...REMOTE.map(() => document.createElement('i')));
  const show = () => {
    const app = APPS.find(a => a.id === REMOTE[remoteIndex]);
    $('remoteBtn').style.setProperty('--h', app.hue);
    $('remote').querySelector('.r-glyph').textContent = app.glyph;
    $('remote').querySelector('.r-label').textContent = app.label;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === remoteIndex));
  };
  const step = n => { remoteIndex = (remoteIndex + n + REMOTE.length) % REMOTE.length; show(); sfx.tick(); buzz(8); };
  let sx = null;
  $('remote').addEventListener('pointerdown', e => { sx = e.clientX; });
  $('remote').addEventListener('pointerup', e => {
    if (sx == null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 30) step(dx < 0 ? 1 : -1);
    else if (e.target.closest('#remoteBtn')) { buzz(25); runApp(REMOTE[remoteIndex]); }
  });
  addEventListener('wheel', e => { if (!$('remote').hidden) step(e.deltaY > 0 ? 1 : -1); }, { passive: true });
  $('remoteView').onclick = e => { e.stopPropagation(); $('remote').hidden = true; body.classList.add('watch-view'); };
  show();
}

// ---------------------------------------------------------------- keyboard
let mouse = null;
function initKeys() {
  addEventListener('mousemove', e => { mouse = e; });
  addEventListener('keydown', e => {
    if (body.classList.contains('booting') || e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { closeSheets(); if (net.desk.linking) setLinking(false); cinema(false); return; }
    const k = e.key.toLowerCase();
    if (k === 'h') return cinema(!body.classList.contains('cinema'));
    if (k === 'f') return fullscreen();
    const app = APPS.find(a => a.key === k);
    if (!app) return;
    e.preventDefault();
    const at = mouse && (app.id === 'wave' || app.id === 'confetti') ? { x: view.x + mouse.clientX / view.ppm, y: view.y + mouse.clientY / view.ppm } : null;
    runApp(app.id, at);
  });
}

// ------------------------------------------------------------------- start
export function initUI() {
  initBoot();
  buildDock();
  initMenubar();
  initMap();
  initKeys();
  for (const b of document.querySelectorAll('.sheet .close')) b.onclick = closeSheets;
  $('scrim').onclick = closeSheets;
  $('linkDone').onclick = () => setLinking(false);
  net.on('desk', onDesk);
  net.on('fx', onFx);
  net.on('app', ({ id, x, y }) => runApp(id, { x, y }));
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!net.id) return;
      const size = scale.size();
      updateJoinParams(size);
      net.send('layout', size);
    }, 160);
  });
}
