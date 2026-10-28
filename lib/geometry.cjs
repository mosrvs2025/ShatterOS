// Pure layout math for the shared desk. Everything is in millimetres of the
// global world; no Matter.js or socket code lives here so it is easy to test.

const WORLD = { w: 2400, h: 1400 };
const DESK_Y = 1150;          // where the bottoms of auto-placed screens sit
const PORTAL_REACH = 80;      // edges closer than this open into each other
const BRIDGE_GAP = 40;        // floor gaps up to this wide are bridged
const BRIDGE_STEP = 30;       // ...when the two floors differ by at most this
const THICKNESS = 40;         // floors and walls live just outside each screen
const DEFAULT_GAP = 12;

const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const right = d => d.x + d.w;
const bottom = d => d.y + d.h;

function overlap(a0, a1, b0, b1) {
  const from = Math.max(a0, b0), to = Math.min(a1, b1);
  return to - from > 4 ? [from, to] : null;
}

// Remove a set of [from, to] cuts from one interval.
function subtract([from, to], cuts) {
  let parts = [[from, to]];
  for (const [c0, c1] of cuts) {
    parts = parts.flatMap(([p0, p1]) => {
      if (c1 <= p0 || c0 >= p1) return [[p0, p1]];
      const out = [];
      if (c0 > p0) out.push([p0, c0]);
      if (c1 < p1) out.push([c1, p1]);
      return out;
    });
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 0.5);
}

// For every screen, which neighbours its four edges open onto.
function neighbours(devices) {
  const result = new Map(devices.map(d => [d.id, { left: [], right: [], top: [], bottom: [] }]));
  for (const a of devices) for (const b of devices) {
    if (a === b) continue;
    const edges = result.get(a.id);
    const ys = overlap(a.y, bottom(a), b.y, bottom(b));
    const xs = overlap(a.x, right(a), b.x, right(b));
    const gapR = b.x - right(a), gapL = a.x - right(b);
    const gapB = b.y - bottom(a), gapT = a.y - bottom(b);
    if (ys && gapR > -10 && gapR <= PORTAL_REACH) edges.right.push({ id: b.id, from: ys[0], to: ys[1], gap: gapR });
    if (ys && gapL > -10 && gapL <= PORTAL_REACH) edges.left.push({ id: b.id, from: ys[0], to: ys[1], gap: gapL });
    if (xs && gapB > -10 && gapB <= PORTAL_REACH) edges.bottom.push({ id: b.id, from: xs[0], to: xs[1], gap: gapB });
    if (xs && gapT > -10 && gapT <= PORTAL_REACH) edges.top.push({ id: b.id, from: xs[0], to: xs[1], gap: gapT });
  }
  return result;
}

// The invisible architecture: each screen's bottom edge is a floor and its
// sides are walls, except where an edge faces another screen. Small gaps
// between neighbouring floors get a bridge so things can roll across bezels.
function solids(devices) {
  const near = neighbours(devices), rects = [];
  for (const d of devices) {
    const n = near.get(d.id), cut = list => list.map(e => [e.from, e.to]);
    for (const [x0, x1] of subtract([d.x, right(d)], cut(n.bottom)))
      rects.push({ kind: 'floor', owner: d.id, x: x0, y: bottom(d), w: x1 - x0, h: THICKNESS });
    for (const [y0, y1] of subtract([d.y, bottom(d)], cut(n.left)))
      rects.push({ kind: 'wall', owner: d.id, x: d.x - THICKNESS, y: y0, w: THICKNESS, h: y1 - y0 });
    for (const [y0, y1] of subtract([d.y, bottom(d)], cut(n.right)))
      rects.push({ kind: 'wall', owner: d.id, x: right(d), y: y0, w: THICKNESS, h: y1 - y0 });
    for (const e of n.right) {
      const other = devices.find(o => o.id === e.id);
      const step = Math.abs(bottom(other) - bottom(d));
      if (e.gap > 0 && e.gap <= BRIDGE_GAP && step <= BRIDGE_STEP)
        rects.push({ kind: 'bridge', owner: d.id, x: right(d), y: Math.max(bottom(d), bottom(other)), w: e.gap, h: THICKNESS });
    }
  }
  return rects;
}

// Portal segments in world space, for drawing glowing seams on each screen.
function portals(devices) {
  const out = {};
  for (const [id, edges] of neighbours(devices))
    out[id] = Object.entries(edges).flatMap(([edge, list]) => list.map(e => ({ edge, ...e })));
  return out;
}

function clampToWorld(d, x, y) {
  return { x: clamp(x, 0, WORLD.w - d.w), y: clamp(y, 0, WORLD.h - d.h) };
}

// New screens line up to the right of the row, bottoms on the same desk.
function placeNew(devices, w, h) {
  // The first screen ends just left of the world's centre, so the great sun in
  // the wallpaper straddles the seam with whichever screen joins next.
  if (!devices.length) return clampToWorld({ w, h }, WORLD.w / 2 - w, DESK_Y - h);
  const last = devices.reduce((m, d) => (right(d) > right(m) ? d : m));
  let x = right(last) + DEFAULT_GAP;
  if (x + w > WORLD.w) x = Math.max(0, devices.reduce((m, d) => Math.min(m, d.x), Infinity) - DEFAULT_GAP - w);
  return clampToWorld({ w, h }, x, bottom(last) - h);
}

// A finger left screen A through one edge and arrived on screen B through the
// opposite edge. Place B so the two touch points line up across the gap.
// `along` is the distance in mm from the edge's start (top or left).
function linkPosition(a, exitEdge, exitAlong, b, enterEdge, enterAlong, gap) {
  if (OPPOSITE[exitEdge] !== enterEdge) return null;
  let x, y;
  if (exitEdge === 'right') { x = right(a) + gap; y = a.y + exitAlong - enterAlong; }
  if (exitEdge === 'left') { x = a.x - gap - b.w; y = a.y + exitAlong - enterAlong; }
  if (exitEdge === 'bottom') { y = bottom(a) + gap; x = a.x + exitAlong - enterAlong; }
  if (exitEdge === 'top') { y = a.y - gap - b.h; x = a.x + exitAlong - enterAlong; }
  return clampToWorld(b, x, y);
}

// Snap a dragged rectangle onto nearby edges of the others (desk map helper).
function snap(d, others, reach = 18, gap = DEFAULT_GAP) {
  let { x, y } = d, bestX = reach, bestY = reach;
  for (const o of others) {
    const ys = overlap(d.y - reach, bottom(d) + reach, o.y, bottom(o));
    const xs = overlap(d.x - reach, right(d) + reach, o.x, right(o));
    if (ys) {
      for (const tx of [right(o) + gap, o.x - gap - d.w]) if (Math.abs(tx - d.x) < bestX) { bestX = Math.abs(tx - d.x); x = tx; }
      for (const ty of [bottom(o) - d.h, o.y]) if (Math.abs(ty - d.y) < bestY) { bestY = Math.abs(ty - d.y); y = ty; }
    }
    if (xs) for (const ty of [bottom(o) + gap, o.y - gap - d.h]) if (Math.abs(ty - d.y) < bestY) { bestY = Math.abs(ty - d.y); y = ty; }
  }
  return clampToWorld(d, x, y);
}

const contains = (d, x, y, pad = 0) => x >= d.x - pad && x <= right(d) + pad && y >= d.y - pad && y <= bottom(d) + pad;

module.exports = {
  WORLD, DESK_Y, PORTAL_REACH, THICKNESS, DEFAULT_GAP, OPPOSITE,
  clamp, subtract, neighbours, solids, portals, placeNew, linkPosition, snap, contains, clampToWorld,
};
