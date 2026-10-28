const express = require('express');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const geo = require('./lib/geometry.cjs');
const { World } = require('./lib/world.cjs');

const TICK_MS = 1000 / 60;
const ROOM_RE = /^[A-Z0-9-]{3,24}$/;
const EDGES = ['left', 'right', 'top', 'bottom'];
const { clamp } = geo;
const num = (n, a, b, f = 0) => (typeof n === 'number' && Number.isFinite(n) ? clamp(n, a, b) : f);
const obj = d => (d && typeof d === 'object' ? d : {});

function lanUrls(port, protocol) {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => `${protocol}://${i.address}:${port}`);
}

// Token bucket per socket and event class, so one tab cannot flood a room.
function limiter() {
  const buckets = new Map();
  return (kind, perSecond, burst = perSecond) => {
    const now = Date.now(), b = buckets.get(kind) || { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    buckets.set(kind, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

function createApp({ roomTtlMs = 60_000, server } = {}) {
  const app = express();
  const httpServer = server || http.createServer();
  httpServer.on('request', app);
  const io = new Server(httpServer, { maxHttpBufferSize: 16384 });
  const rooms = new Map();

  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  app.get('/api/info', (req, res) => {
    const port = httpServer.address()?.port;
    res.json({ lan: lanUrls(port, req.protocol), world: geo.WORLD });
  });

  app.get('/qr.svg', async (req, res) => {
    const data = String(req.query.data || '');
    if (!/^https?:\/\/[^\s]{3,300}$/.test(data)) return res.status(400).send('bad data');
    const svg = await QRCode.toString(data, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0d12', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  });

  function getRoom(code) {
    let r = rooms.get(code);
    if (!r) {
      if (rooms.size >= 100) return null;
      r = { code, world: new World(), ghosts: new Map(), edges: [], identify: new Set(), linkingUntil: 0, tick: 0, emptyTimer: null };
      rooms.set(code, r);
    }
    clearTimeout(r.emptyTimer);
    return r;
  }

  const deskOf = r => ({ ...r.world.desk(), identify: r.identify.size > 0, linking: r.linkingUntil > Date.now() });

  // Pinch-style linking: a finger leaves screen A through one edge and lands
  // on screen B through the opposite edge. Finger speed × travel time ≈ bezel gap.
  function matchEdge(r, e) {
    const now = Date.now();
    r.edges = r.edges.filter(o => now - o.received < 3000);
    const match = r.edges.find(o => o.device !== e.device && o.phase !== e.phase && geo.OPPOSITE[o.edge] === e.edge && Math.abs(o.t - e.t) < 1600);
    if (!match) { r.edges.push(e); return; }
    r.edges = r.edges.filter(o => o !== match);
    const exit = e.phase === 'exit' ? e : match, enter = exit === e ? match : e;
    const a = r.world.devices.get(exit.device), b = r.world.devices.get(enter.device);
    if (!a || !b) return;
    const dt = enter.t - exit.t;
    const gap = dt > 15 && dt < 600 && exit.speed > 0 ? clamp(exit.speed * dt, 2, 70) : geo.DEFAULT_GAP;
    const spot = geo.linkPosition(a, exit.edge, exit.along, b, enter.edge, enter.along, gap);
    if (!spot) return;
    r.world.updateDevice(b.id, spot);
    io.to(r.code).emit('fx', [{ k: 'link', a: a.id, b: b.id, edge: exit.edge, gap: Math.round(gap) }]);
  }

  io.on('connection', socket => {
    let r = null, device = null, key = null;
    const allow = limiter();

    socket.on('clock', (_, ack) => typeof ack === 'function' && ack(Date.now()));

    socket.on('join', (data, ack) => {
      data = obj(data);
      if (typeof ack !== 'function') ack = () => {};
      if (r) return ack({ error: 'Already joined' });
      const code = typeof data.room === 'string' ? data.room.trim().toUpperCase() : '';
      if (!ROOM_RE.test(code)) return ack({ error: 'Use a room code of 3–24 letters, numbers or hyphens.' });
      const room = getRoom(code);
      if (!room) return ack({ error: 'Server full — try again soon.' });
      if (room.world.devices.size >= 12) return ack({ error: 'This world already has 12 screens.' });
      key = typeof data.key === 'string' ? data.key.slice(0, 40) : null;
      const restore = key ? room.ghosts.get(key) : null;
      if (key) room.ghosts.delete(key);
      r = room;
      device = r.world.addDevice({ id: socket.id, name: data.name, kind: data.kind, w: data.w, h: data.h, restore });
      socket.join(code);
      socket.to(code).emit('fx', [{ k: 'joined', id: device.id, name: device.name }]);
      ack({ id: socket.id, room: code, device, time: Date.now(), world: geo.WORLD, desk: deskOf(r) });
    });

    const guard = (kind, perSecond, fn) => (data, ack) => { if (r && allow(kind, perSecond)) fn(obj(data), ack); };

    socket.on('layout', guard('layout', 40, d => {
      const target = typeof d.id === 'string' ? d.id : socket.id;
      const patch = {};
      for (const k of ['x', 'y']) if (k in d) patch[k] = d[k];
      if (target === socket.id) for (const k of ['w', 'h']) if (k in d) patch[k] = d[k];
      patch.snap = d.snap === true;
      r.world.updateDevice(target, patch);
    }));

    socket.on('rename', guard('rename', 2, d => {
      if (typeof d.name === 'string' && d.name.trim()) { device.name = d.name.trim().slice(0, 24); r.world.dirty = true; }
    }));

    socket.on('tilt', guard('tilt', 30, d => r.world.setTilt(socket.id, d.off ? null : { x: d.x, y: d.y })));
    socket.on('shake', guard('shake', 2, () => r.world.shake(socket.id)));

    socket.on('grab', guard('grab', 20, d => r.world.grab(socket.id, d.id, num(d.x, -500, 3000), num(d.y, -800, 1800))));
    socket.on('drag', guard('drag', 90, d => r.world.drag(socket.id, d.x, d.y)));
    socket.on('release', guard('release', 20, d => r.world.release(socket.id, { vx: d.vx, vy: d.vy })));

    socket.on('action', guard('action', 12, d => {
      const w = r.world, x = num(d.x, -200, 2600, device.x + 20), y = num(d.y, -400, 1400, device.y + 20);
      switch (d.type) {
        case 'orb': case 'boulder': case 'wanderer': w.spawn(d.type, x, y, num(d.vx, -40, 40), num(d.vy, -40, 40)); break;
        case 'wave': w.wave(x, y); break;
        case 'magnet': w.magnet(); break;
        case 'gravity': w.cycleGravity(d.mode); break;
        case 'confetti': w.confetti(x, y); break;
        case 'showtime': w.showtime(); break;
        case 'quest': if (w.quest.active) w.endQuest(); else w.startQuest(); w.dirty = true; break;
        case 'reset': w.reset(); break;
      }
    }));

    socket.on('edge', guard('edge', 10, d => {
      if (!EDGES.includes(d.edge) || !['exit', 'enter'].includes(d.phase)) return;
      matchEdge(r, { device: socket.id, phase: d.phase, edge: d.edge, along: num(d.along, -100, 1500), t: num(d.t, 0, 1e15), speed: num(d.speed, 0, 5), received: Date.now() });
    }));

    socket.on('linkmode', guard('linkmode', 4, d => { r.linkingUntil = d.on ? Date.now() + 120_000 : 0; r.world.dirty = true; }));
    socket.on('identify', guard('identify', 4, d => { if (d.on) r.identify.add(socket.id); else r.identify.delete(socket.id); r.world.dirty = true; }));

    socket.on('disconnect', () => {
      if (!r) return;
      const room = r;
      room.identify.delete(socket.id);
      if (key) room.ghosts.set(key, { x: device.x, y: device.y, color: device.color, at: Date.now() });
      room.world.removeDevice(socket.id);
      io.to(room.code).emit('fx', [{ k: 'left', name: device.name }]);
      if (!room.world.devices.size) room.emptyTimer = setTimeout(() => {
        if (room.world.devices.size) return;
        room.world.destroy();
        rooms.delete(room.code);
      }, roomTtlMs).unref();
    });
  });

  const timer = setInterval(() => {
    for (const [code, r] of rooms) {
      if (!r.world.devices.size) continue;
      r.world.step();
      r.tick++;
      if (r.tick % 2) continue;
      const fx = r.world.drainFx();
      if (fx.length) io.to(code).emit('fx', fx);
      if (r.world.dirty || r.tick % 60 === 0) { r.world.dirty = false; io.to(code).emit('desk', deskOf(r)); }
      io.to(code).emit('state', { t: Date.now(), b: r.world.snapshot() });
      for (const [k, g] of r.ghosts) if (Date.now() - g.at > 120_000) r.ghosts.delete(k);
    }
  }, TICK_MS);

  async function close() {
    clearInterval(timer);
    for (const r of rooms.values()) { clearTimeout(r.emptyTimer); r.world.destroy(); }
    await new Promise(resolve => io.close(() => resolve()));
  }

  return { app, http: httpServer, io, rooms, close };
}

// Optional self-signed HTTPS so phones on the LAN may use motion sensors.
async function httpsServer() {
  const dir = path.join(__dirname, '.cert'), keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
  if (!fs.existsSync(certFile)) {
    const selfsigned = require('selfsigned');
    const ips = ['127.0.0.1', ...lanUrls(0, 'x').map(u => u.slice(4, u.lastIndexOf(':')))];
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'shatteros.local' }], {
      days: 365, keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))] }],
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
  }
  return https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) });
}

if (require.main === module) (async () => {
  const secure = process.env.HTTPS === '1' || process.argv.includes('--https');
  const port = Number(process.env.PORT) || (secure ? 3443 : 3000);
  const { http: server } = createApp({ server: secure ? await httpsServer() : undefined });
  server.listen(port, '0.0.0.0', () => {
    const protocol = secure ? 'https' : 'http';
    console.log(`\n  ◈ ShatterOS is live\n\n  This computer   ${protocol}://localhost:${port}`);
    for (const url of lanUrls(port, protocol)) console.log(`  Other screens   ${url}`);
    if (!secure) console.log('\n  Tip: run `npm run start:https` so phones can use tilt & shake.');
    console.log('');
  });
})();

module.exports = { createApp };
