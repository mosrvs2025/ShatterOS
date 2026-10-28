// Networking: socket, clock sync with the server, and a snapshot buffer that
// is sampled slightly in the past so motion stays smooth through jitter.
import { io } from '/socket.io/socket.io.esm.min.js';

const INTERP_DELAY = 95;
const listeners = new Map();

export const net = {
  socket: io({ autoConnect: false, transports: ['websocket', 'polling'] }),
  offset: 0,
  rtt: 0,
  id: null,
  room: null,
  joinParams: null,
  world: { w: 2400, h: 1400 },
  desk: { devices: [], portals: {}, hostId: null, gravity: 'earth', quest: { active: false }, identify: false, linking: false },
  snapshots: [],

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
  },
  emitLocal(event, data) {
    for (const fn of listeners.get(event) || []) fn(data);
  },
  send(event, data) {
    if (this.id && this.socket.connected) this.socket.emit(event, data);
  },
  me() {
    return this.desk.devices.find(d => d.id === this.id) || null;
  },
  device(id) {
    return this.desk.devices.find(d => d.id === id) || null;
  },
  host() {
    return this.device(this.desk.hostId) || this.me();
  },
};

export const serverNow = () => Date.now() + net.offset;

async function syncClock(samples = 7) {
  let best = Infinity;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    let ts;
    try { ts = await net.socket.timeout(2000).emitWithAck('clock', null); } catch { continue; }
    const t1 = Date.now(), rtt = t1 - t0;
    if (rtt < best) { best = rtt; net.rtt = rtt; net.offset = ts - (t0 + t1) / 2; }
  }
}

function join() {
  return new Promise(resolve => {
    net.socket.emit('join', net.joinParams, async result => {
      if (result.error) return resolve(result);
      net.id = result.id;
      net.room = result.room;
      net.world = result.world;
      net.desk = result.desk;
      net.offset = result.time - Date.now();
      net.snapshots = [];
      resolve(result);
      await syncClock();
      net.emitLocal('desk', net.desk);
    });
  });
}

export function connect(params) {
  net.joinParams = params;
  return new Promise(resolve => {
    let first = true;
    net.socket.on('connect', async () => {
      net.emitLocal('status', 'online');
      const result = await join();
      if (first) { first = false; resolve(result); }
      else net.emitLocal('rejoined', result);
    });
    net.socket.on('disconnect', () => { net.id = null; net.emitLocal('status', 'offline'); });
    net.socket.on('connect_error', () => {
      net.emitLocal('status', 'offline');
      if (first) { first = false; resolve({ error: 'Cannot reach the ShatterOS server. Check the address and Wi‑Fi.' }); }
    });
    net.socket.connect();
  });
}

export function updateJoinParams(patch) {
  if (net.joinParams) Object.assign(net.joinParams, patch);
}

net.socket.on('desk', desk => { net.desk = desk; net.emitLocal('desk', desk); });
net.socket.on('fx', list => { for (const fx of list) net.emitLocal('fx', fx); });
net.socket.on('state', s => {
  const bodies = new Map();
  for (const b of s.b) bodies.set(b[0], b);
  net.snapshots.push({ t: s.t, bodies });
  if (net.snapshots.length > 40) net.snapshots.shift();
});
setInterval(() => { if (net.id) syncClock(3); }, 15000);

const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// Interpolated bodies for the given server time.
export function sample(t = serverNow() - INTERP_DELAY) {
  const s = net.snapshots;
  if (!s.length) return [];
  let a = s[0], b = s[0];
  if (t >= s[s.length - 1].t) a = b = s[s.length - 1];
  else for (let i = 0; i < s.length - 1; i++) if (s[i].t <= t && s[i + 1].t > t) { a = s[i]; b = s[i + 1]; break; }
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  const out = [];
  for (const [id, nb] of b.bodies) {
    const na = a.bodies.get(id) || nb;
    out.push({
      id, type: nb[1],
      x: (na[2] + (nb[2] - na[2]) * k) / 10,
      y: (na[3] + (nb[3] - na[3]) * k) / 10,
      a: lerpAngle(na[4] / 1000, nb[4] / 1000, k),
      vx: (nb[2] - na[2]) / 10 / Math.max(1, (b.t - a.t) / 16.67),
      vy: (nb[3] - na[3]) / 10 / Math.max(1, (b.t - a.t) / 16.67),
      extra: nb[5], flags: nb[6],
    });
  }
  return out;
}
