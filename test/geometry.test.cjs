const { test } = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../lib/geometry.cjs');

const laptop = { id: 'L', x: 900, y: 960, w: 300, h: 190 };
const phone = { id: 'P', x: 1212, y: 1010, w: 65, h: 140 };

test('subtract removes cut intervals', () => {
  assert.deepEqual(geo.subtract([0, 100], [[20, 30], [90, 120]]), [[0, 20], [30, 90]]);
  assert.deepEqual(geo.subtract([0, 10], [[-5, 15]]), []);
});

test('facing edges within reach become portals on both screens', () => {
  const n = geo.neighbours([laptop, phone]);
  assert.equal(n.get('L').right[0].id, 'P');
  assert.equal(n.get('L').right[0].gap, 12);
  assert.deepEqual([n.get('P').left[0].from, n.get('P').left[0].to], [1010, 1150]);
  const far = geo.neighbours([laptop, { ...phone, x: 1400 }]);
  assert.equal(far.get('L').right.length, 0);
});

test('solids: floors everywhere, walls only where no neighbour, a bridge across a small gap', () => {
  const rects = geo.solids([laptop, phone]);
  const walls = rects.filter(r => r.kind === 'wall');
  assert.ok(!walls.some(w => w.owner === 'P' && w.x < phone.x), 'phone has no wall facing the laptop');
  assert.ok(walls.some(w => w.owner === 'L' && w.x === 1200 && w.h === 50), 'laptop keeps a wall above the shorter phone');
  const bridge = rects.find(r => r.kind === 'bridge');
  assert.deepEqual([bridge.x, bridge.w, bridge.y], [1200, 12, 1150]);
});

test('a screen directly below opens a hole in the floor above it', () => {
  const below = { id: 'B', x: 950, y: 1160, w: 100, h: 80 };
  const floors = geo.solids([laptop, below]).filter(r => r.kind === 'floor' && r.owner === 'L');
  assert.deepEqual(floors.map(f => [f.x, f.x + f.w]), [[900, 950], [1050, 1200]]);
});

test('placeNew lines screens up to the right with bottoms on the same desk', () => {
  const first = geo.placeNew([], 300, 190);
  assert.equal(first.x + 300, geo.WORLD.w / 2);
  const second = geo.placeNew([{ id: 'A', ...first, w: 300, h: 190 }], 65, 140);
  assert.equal(second.x, first.x + 300 + geo.DEFAULT_GAP);
  assert.equal(second.y + 140, first.y + 190);
});

test('linkPosition aligns the touch points across the measured gap', () => {
  // Finger left the laptop's right edge 100 mm from its top, and entered the
  // phone's left edge 40 mm from its top, crossing a 9 mm gap.
  const spot = geo.linkPosition(laptop, 'right', 100, phone, 'left', 40, 9);
  assert.deepEqual(spot, { x: 1209, y: 1020 });
  const under = geo.linkPosition(laptop, 'bottom', 50, phone, 'top', 10, 5);
  assert.deepEqual(under, { x: 940, y: 1155 });
  assert.equal(geo.linkPosition(laptop, 'right', 0, phone, 'top', 0, 5), null);
});

test('snap pulls a dragged screen flush beside a neighbour', () => {
  const spot = geo.snap({ ...phone, x: 1220, y: 1004 }, [laptop]);
  assert.equal(spot.x, 1212);
  assert.equal(spot.y + phone.h, 1150);
});
