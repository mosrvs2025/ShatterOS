const { test } = require('node:test');
const assert = require('node:assert/strict');
const { World, TYPE } = require('../lib/world.cjs');

function world() {
  const w = new World({ random: () => 0.5 });
  const laptop = w.addDevice({ id: 'L', kind: 'desktop', w: 300, h: 190 });
  const phone = w.addDevice({ id: 'P', kind: 'phone', w: 65, h: 140 });
  return { w, laptop, phone };
}
const run = (w, steps) => { for (let i = 0; i < steps; i++) w.step(); };
const icons = w => w.dynamicBodies().filter(b => b.plugin.type === TYPE.icon);

test('icons start parked in columns on the largest screen', () => {
  const { w, laptop } = world();
  run(w, 30);
  assert.equal(icons(w).length, 12);
  assert.ok(icons(w).every(b => b.plugin.parked && b.position.x > laptop.x && b.position.x < laptop.x + 80));
});

test('an orb rolls across the bridged bezel onto the next screen', () => {
  const { w, laptop, phone } = world();
  const orb = w.spawn('orb', laptop.x + laptop.w - 60, laptop.y + laptop.h - 8, 10, 0);
  let arrived = false;
  for (let i = 0; i < 90 && !arrived; i++) { w.step(); arrived = orb.position.x > phone.x && orb.position.y < phone.y + phone.h; }
  assert.ok(arrived, 'orb reaches the phone');
});

test('moving a screen carries what is inside it (the elevator)', () => {
  const { w, phone } = world();
  const ball = w.spawn('orb', phone.x + 30, phone.y + phone.h - 8);
  run(w, 60);
  const before = ball.position.y;
  w.updateDevice('P', { y: phone.y - 200 });
  assert.ok(Math.abs(ball.position.y - (before - 200)) < 1);
});

test('shockwave scatters icons and the magnet brings every one home', () => {
  const { w, laptop } = world();
  w.wave(laptop.x + 20, laptop.y + 60);
  run(w, 200);
  assert.ok(icons(w).filter(b => !b.plugin.parked).length >= 6);
  w.magnet();
  run(w, 600);
  assert.ok(icons(w).every(b => b.plugin.parked));
});

test('grab and fling', () => {
  const { w, laptop } = world();
  const target = icons(w)[0];
  assert.ok(w.grab('me', target.id, target.position.x, target.position.y));
  w.drag('me', laptop.x + 150, laptop.y + 80);
  run(w, 40);
  assert.ok(target.position.x > laptop.x + 100);
  w.release('me', { vx: 20, vy: -5 });
  assert.equal(w.grabs.size, 0);
  assert.equal(target.velocity.x, 20);
});

test('tilting a screen pours its contents sideways', () => {
  const { w, phone } = world();
  const ball = w.spawn('orb', phone.x + 30, phone.y + 40);
  w.setTilt('P', { x: -1.5, y: 0.2 });
  run(w, 120);
  assert.ok(ball.position.x < phone.x, 'ball poured out of the left edge');
});

test('quest: wanderer collects the key on the small screen and reaches the door', () => {
  const { w } = world();
  w.startQuest();
  assert.equal(w.quest.keyDevice, 'P');
  const seen = new Set();
  for (let i = 0; i < 2500 && !seen.has('win'); i++) { w.step(); for (const f of w.drainFx()) seen.add(f.k); }
  assert.ok(seen.has('key') && seen.has('win'));
  assert.equal(w.quest.wins, 1);
});

test('showtime counts down then runs the scene', () => {
  let now = 1000;
  const w = new World({ now: () => now });
  w.addDevice({ id: 'L', w: 300, h: 190 });
  w.showtime();
  assert.equal(w.drainFx()[0].k, 'count');
  now += 3100;
  w.step();
  assert.ok(w.quest.active);
  assert.ok(w.drainFx().some(f => f.k === 'confetti'));
});
