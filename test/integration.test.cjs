const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createApp } = require('../server.cjs');

const once = (s, n) => new Promise(r => s.once(n, r));
const ack = (s, n, d) => new Promise(r => s.emit(n, d, r));
async function until(s, event, predicate, max = 120) {
  for (let i = 0; i < max; i++) { const v = await once(s, event); if (predicate(v)) return v; }
  throw new Error('condition not met for ' + event);
}

async function server(t, opts) {
  const app = createApp(opts);
  await new Promise(r => app.http.listen(0, r));
  const url = 'http://localhost:' + app.http.address().port, clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await app.close(); app.http.close(); });
  async function join(room, extra = {}) {
    const s = io(url, { transports: ['websocket'] });
    clients.push(s);
    await once(s, 'connect');
    const result = await ack(s, 'join', { room, w: 300, h: 190, ...extra });
    return { s, result };
  }
  return { app, url, join };
}

test('shared world: placement, portals, snapshots, room isolation and cleanup', async t => {
  const { app, join } = await server(t, { roomTtlMs: 50 });
  const a = await join('DEMO', { name: 'Laptop', kind: 'desktop' });
  const b = await join('DEMO', { name: 'Phone', kind: 'phone', w: 65, h: 140 });
  const other = await join('OTHER');
  assert.ok(a.result.id && b.result.desk.devices.length === 2);
  const desk = await until(a.s, 'desk', d => d.devices.length === 2);
  const [da, db] = [desk.devices.find(d => d.name === 'Laptop'), desk.devices.find(d => d.name === 'Phone')];
  assert.equal(db.x, da.x + da.w + 12, 'new screen lines up to the right');
  assert.equal(db.y + db.h, da.y + da.h, 'bottoms sit on the same desk');
  assert.equal(desk.portals[da.id][0].id, db.id);
  const sa = await once(a.s, 'state'), sb = await once(b.s, 'state');
  assert.equal(sa.b.length, 12);
  assert.deepEqual(sa.b.map(x => x[0]).sort(), sb.b.map(x => x[0]).sort());

  a.s.emit('action', { type: 'orb', x: da.x + da.w - 40, y: da.y + da.h - 8, vx: 12, vy: 0 });
  const crossed = await until(a.s, 'state', s => s.b.some(x => x[1] === 1 && x[2] / 10 > db.x));
  assert.ok(crossed, 'orb crosses the bezel into the phone');
  const otherState = await once(other.s, 'state');
  assert.equal(otherState.b.filter(x => x[1] === 1).length, 0, 'rooms are isolated');

  a.s.emit('action', { type: 'reset' });
  await until(a.s, 'state', s => s.b.length === 12);

  b.s.disconnect();
  const after = await until(a.s, 'desk', d => d.devices.length === 1);
  assert.equal(after.devices[0].name, 'Laptop');
  other.s.disconnect();
  await new Promise(r => setTimeout(r, 150));
  assert.ok(!app.rooms.has('OTHER'), 'empty rooms are cleaned up after the grace period');
});

test('swipe across two screens links them', async t => {
  const { join } = await server(t);
  const a = await join('LINK', { name: 'A' });
  const b = await join('LINK', { name: 'B', w: 65, h: 140 });
  a.s.emit('linkmode', { on: true });
  await until(a.s, 'desk', d => d.linking);
  const now = Date.now();
  a.s.emit('edge', { phase: 'exit', edge: 'right', along: 100, t: now, speed: 0.1 });
  b.s.emit('edge', { phase: 'enter', edge: 'left', along: 20, t: now + 90 });
  const fx = await until(b.s, 'fx', list => list.some(f => f.k === 'link'));
  assert.equal(fx.find(f => f.k === 'link').gap, 9);
  const desk = await until(a.s, 'desk', d => d.devices.find(x => x.name === 'B').y === d.devices.find(x => x.name === 'A').y + 80);
  const [da, db] = [desk.devices.find(d => d.name === 'A'), desk.devices.find(d => d.name === 'B')];
  assert.equal(db.x, da.x + da.w + 9);
});

test('reconnecting with the same device key restores the screen position', async t => {
  const { join } = await server(t);
  const a = await join('KEEP', { key: 'k1' });
  a.s.emit('layout', { x: 300, y: 400 });
  await until(a.s, 'desk', d => d.devices[0].x === 300);
  const keeper = await join('KEEP', { key: 'k2' });
  a.s.disconnect();
  await until(keeper.s, 'desk', d => d.devices.length === 1);
  const again = await join('KEEP', { key: 'k1' });
  assert.equal(again.result.device.x, 300);
  assert.equal(again.result.device.y, 400);
});

test('invalid input is rejected', async t => {
  const { join } = await server(t);
  assert.ok((await join('!')).result.error);
  assert.ok((await join('ab')).result.error);
});

test('QR endpoint renders an SVG and rejects junk', async t => {
  const { url } = await server(t);
  const ok = await fetch(url + '/qr.svg?data=' + encodeURIComponent('http://192.168.1.2:3000/?room=ABCDE'));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /<svg/);
  assert.equal((await fetch(url + '/qr.svg?data=javascript:alert(1)')).status, 400);
  const info = await (await fetch(url + '/api/info')).json();
  assert.ok(Array.isArray(info.lan));
});
