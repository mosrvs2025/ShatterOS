// The authoritative shared world for one room: a Matter.js simulation in
// millimetres, plus the devices (viewports) that look into it.

const { Engine, Bodies, Body, Composite, Sleeping, Constraint, Events } = require('matter-js');
const geo = require('./geometry.cjs');

const STEP_MS = 1000 / 60;
const APPS = ['orb', 'boulder', 'wanderer', 'wave', 'magnet', 'gravity', 'confetti', 'showtime', 'link', 'map', 'add', 'quest'];
const TYPE = { icon: 0, ball: 1, boulder: 2, wanderer: 3, key: 4, door: 5 };
const GRAVITY = { earth: 2, moon: 0.55, zero: 0 };
const GRAVITY_ORDER = ['earth', 'moon', 'zero'];
const ICON = 16, MAX_BALLS = 40, MAX_BODIES = 140, MAX_SPEED = 40;
const COLORS = ['#c5fa75', '#b49cff', '#ffb86b', '#6fd8f5', '#ff7aa8', '#f7e463', '#7cf2c0', '#ff8f6b', '#9fb4ff', '#e9a8ff', '#ffd1a1', '#a5ffd6'];

const { clamp } = geo;
const num = (n, a, b, f = 0) => (typeof n === 'number' && Number.isFinite(n) ? clamp(n, a, b) : f);
const area = d => d.w * d.h;

class World {
  constructor({ now = Date.now, random = Math.random } = {}) {
    this.now = now;
    this.random = random;
    this.engine = Engine.create({ enableSleeping: true });
    this.engine.gravity.scale = 0; // gravity is applied per screen in step()
    this.devices = new Map();
    this.solids = [];
    this.fx = [];
    this.timeline = [];
    this.after = [];
    this.grabs = new Map();
    this.gravityMode = 'earth';
    this.quest = { active: false, hasKey: false, wins: 0, spawnDevice: null, keyDevice: null, doorDevice: null };
    this.door = null;
    this.dirty = true;
    Events.on(this.engine, 'collisionStart', e => this.onCollisions(e.pairs, true));
    Events.on(this.engine, 'collisionActive', e => this.onCollisions(e.pairs, false));
    this.reset();
  }

  // ---------------------------------------------------------------- devices
  addDevice({ id, name, kind, w, h, restore }) {
    const used = new Set([...this.devices.values()].map(d => d.color));
    const size = { w: num(w, 20, 1400, 200), h: num(h, 20, 1200, 140) };
    const spot = restore ? geo.clampToWorld(size, restore.x, restore.y) : geo.placeNew([...this.devices.values()], size.w, size.h);
    const device = {
      id, name: String(name || 'Screen').slice(0, 24), kind: ['desktop', 'tablet', 'phone', 'watch'].includes(kind) ? kind : 'desktop',
      color: restore?.color && !used.has(restore.color) ? restore.color : COLORS.find(c => !used.has(c)) || COLORS[this.devices.size % COLORS.length],
      ...size, ...spot, gravity: null,
    };
    this.devices.set(id, device);
    this.rebuild();
    return device;
  }

  removeDevice(id) {
    this.release(id);
    this.devices.delete(id);
    this.rebuild();
  }

  // Move or resize a screen. Whatever is inside it rides along, like the
  // phone being slid down like an elevator with the character inside.
  updateDevice(id, patch = {}) {
    const d = this.devices.get(id);
    if (!d) return null;
    const before = { x: d.x, y: d.y, w: d.w, h: d.h };
    if ('w' in patch) d.w = num(patch.w, 20, 1400, d.w);
    if ('h' in patch) d.h = num(patch.h, 20, 1200, d.h);
    let x = 'x' in patch ? num(patch.x, -10000, 10000, d.x) : d.x;
    let y = 'y' in patch ? num(patch.y, -10000, 10000, d.y) : d.y;
    ({ x, y } = patch.snap ? geo.snap({ ...d, x, y }, [...this.devices.values()].filter(o => o !== d)) : geo.clampToWorld(d, x, y));
    d.x = x; d.y = y;
    const dx = d.x - before.x, dy = d.y - before.y;
    if (dx || dy) for (const b of this.dynamicBodies()) {
      if (b.plugin.parked || this.isHeld(b) || !geo.contains(before, b.position.x, b.position.y)) continue;
      Body.translate(b, { x: dx, y: dy });
      Sleeping.set(b, false);
    }
    this.rebuild();
    return d;
  }

  setTilt(id, g) {
    const d = this.devices.get(id);
    if (d) d.gravity = g ? { x: num(g.x, -2, 2), y: num(g.y, -2, 2) } : null;
  }

  host() {
    let best = null;
    for (const d of this.devices.values()) if (!best || area(d) > area(best)) best = d;
    return best;
  }

  deviceAt(x, y) {
    for (const d of this.devices.values()) if (geo.contains(d, x, y)) return d;
    return null;
  }

  // Rebuild floors, walls and bridges from the current desk layout.
  rebuild() {
    for (const s of this.solids) Composite.remove(this.engine.world, s);
    const devices = [...this.devices.values()];
    this.solids = geo.solids(devices).map(r => {
      const b = Bodies.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, { isStatic: true, friction: 0.6, label: r.kind });
      b.plugin = { solid: true };
      return b;
    });
    Composite.add(this.engine.world, this.solids);
    for (const b of this.dynamicBodies()) if (!b.plugin.parked) Sleeping.set(b, false);
    this.rehomeIcons();
    this.placeDoor();
    this.dirty = true;
  }

  // ----------------------------------------------------------------- bodies
  dynamicBodies() {
    return this.engine.world.bodies.filter(b => !b.isStatic);
  }

  add(body, type, extra = {}) {
    body.plugin = { type, ...extra };
    Composite.add(this.engine.world, body);
    return body;
  }

  // Desktop-style columns down the left of the largest screen.
  iconHomes() {
    const h = this.host();
    if (!h) return APPS.map((_, i) => ({ x: 600 + i * 26, y: 900 }));
    const n = APPS.length, sy = 26;
    const rows = clamp(Math.floor((h.h - 22) / sy), 1, n), cols = Math.ceil(n / rows);
    const sx = Math.max(17, Math.min(28, (h.w - 8) / cols));
    return APPS.map((_, i) => ({ x: h.x + 6 + sx * Math.floor(i / rows) + sx / 2, y: h.y + 12 + sy * (i % rows) + sy / 2 - 2 }));
  }

  rehomeIcons() {
    const homes = this.iconHomes();
    for (const b of this.dynamicBodies()) {
      if (b.plugin.type !== TYPE.icon) continue;
      b.plugin.home = homes[b.plugin.app];
      if (b.plugin.parked) this.park(b);
    }
  }

  park(b) {
    Body.setPosition(b, b.plugin.home);
    Body.setAngle(b, 0);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    b.collisionFilter.mask = -1;
    b.plugin.parked = true;
    b.plugin.returning = false;
    Sleeping.set(b, true);
  }

  unpark(b) {
    b.plugin.parked = false;
    b.plugin.returning = false;
    b.collisionFilter.mask = -1;
    Sleeping.set(b, false);
  }

  reset() {
    for (const b of this.dynamicBodies()) Composite.remove(this.engine.world, b);
    this.grabs.clear();
    for (const c of Composite.allConstraints(this.engine.world)) Composite.remove(this.engine.world, c);
    this.endQuest();
    const homes = this.iconHomes();
    APPS.forEach((app, i) => {
      const b = this.add(Bodies.rectangle(homes[i].x, homes[i].y, ICON, ICON, { chamfer: { radius: 4 }, restitution: 0.35, friction: 0.35, density: 0.002 }), TYPE.icon, { app: i, home: homes[i] });
      this.park(b);
    });
    this.timeline = [];
    this.dirty = true;
  }

  spawn(kind, x, y, vx = 0, vy = 0) {
    if (this.engine.world.bodies.length > MAX_BODIES) return null;
    x = num(x, -200, geo.WORLD.w + 200, 600);
    y = num(y, -400, geo.WORLD.h, 600);
    let b;
    if (kind === 'orb') {
      const balls = this.dynamicBodies().filter(o => o.plugin.type === TYPE.ball);
      if (balls.length >= MAX_BALLS) Composite.remove(this.engine.world, balls[0]);
      b = this.add(Bodies.circle(x, y, 6, { restitution: 0.78, friction: 0.05, density: 0.004, frictionAir: 0.004 }), TYPE.ball, { hue: Math.floor(this.random() * 360) });
    } else if (kind === 'boulder') {
      b = this.add(Bodies.circle(x, y, 15, { restitution: 0.15, friction: 0.7, density: 0.03, frictionAir: 0.002 }), TYPE.boulder);
    } else if (kind === 'wanderer') {
      for (const o of this.dynamicBodies()) if (o.plugin.type === TYPE.wanderer) Composite.remove(this.engine.world, o);
      b = this.add(Bodies.rectangle(x, y, 9, 22, { inertia: Infinity, friction: 0, frictionStatic: 0, frictionAir: 0.02, density: 0.003, restitution: 0 }), TYPE.wanderer, { dir: vx < 0 ? -1 : 1, stuck: 0, lastX: x });
      this.fx.push({ k: 'poof', x, y });
      return b;
    } else if (kind === 'key') {
      b = this.add(Bodies.rectangle(x, y, 13, 7, { restitution: 0.4, friction: 0.5, density: 0.002 }), TYPE.key);
    } else return null;
    Body.setVelocity(b, { x: num(vx, -MAX_SPEED, MAX_SPEED), y: num(vy, -MAX_SPEED, MAX_SPEED) });
    return b;
  }

  find(type) {
    return this.dynamicBodies().find(b => b.plugin.type === type);
  }

  // ------------------------------------------------------------- interaction
  isHeld(b) {
    for (const c of this.grabs.values()) if (c.bodyB === b) return true;
    return false;
  }

  grab(owner, id, x, y) {
    this.release(owner);
    const b = this.engine.world.bodies.find(o => o.id === id && !o.isStatic);
    if (!b || Math.hypot(b.position.x - x, b.position.y - y) > 45) return false;
    this.unpark(b);
    const c = Constraint.create({ pointA: { x, y }, bodyB: b, pointB: { x: x - b.position.x, y: y - b.position.y }, stiffness: 0.22, damping: 0.08, length: 0 });
    Composite.add(this.engine.world, c);
    this.grabs.set(owner, c);
    this.fx.push({ k: 'grab', x, y });
    return true;
  }

  drag(owner, x, y) {
    const c = this.grabs.get(owner);
    if (c) c.pointA = { x: num(x, -500, geo.WORLD.w + 500), y: num(y, -800, geo.WORLD.h + 200) };
  }

  release(owner, v) {
    const c = this.grabs.get(owner);
    if (!c) return;
    Composite.remove(this.engine.world, c);
    this.grabs.delete(owner);
    if (v) Body.setVelocity(c.bodyB, { x: num(v.vx, -MAX_SPEED, MAX_SPEED), y: num(v.vy, -MAX_SPEED, MAX_SPEED) });
  }

  wave(x, y, radius = 280, power = 16) {
    for (const b of this.dynamicBodies()) {
      const dx = b.position.x - x, dy = b.position.y - y, dist = Math.hypot(dx, dy);
      if (dist > radius || this.isHeld(b)) continue;
      this.unpark(b);
      const f = power * (1 - dist / radius) / Math.max(1, Math.sqrt(b.mass * 4)), n = dist || 1;
      Body.setVelocity(b, { x: b.velocity.x + (dx / n) * f, y: b.velocity.y + (dy / n) * f - f * 0.35 });
    }
    this.fx.push({ k: 'wave', x, y, t: this.now() });
  }

  // Every scattered icon flies home through everything, then snaps into place.
  magnet() {
    for (const b of this.dynamicBodies()) {
      if (b.plugin.type !== TYPE.icon || b.plugin.parked || this.isHeld(b)) continue;
      b.plugin.returning = true;
      b.collisionFilter.mask = 0;
      Sleeping.set(b, false);
    }
    this.fx.push({ k: 'magnet', t: this.now() });
  }

  cycleGravity(mode) {
    this.gravityMode = GRAVITY_ORDER.includes(mode) ? mode : GRAVITY_ORDER[(GRAVITY_ORDER.indexOf(this.gravityMode) + 1) % GRAVITY_ORDER.length];
    for (const b of this.dynamicBodies()) {
      if (b.plugin.parked) continue;
      Sleeping.set(b, false);
      if (this.gravityMode === 'zero') Body.setVelocity(b, { x: b.velocity.x + (this.random() - 0.5) * 2, y: b.velocity.y - 1 - this.random() * 2 });
    }
    this.fx.push({ k: 'gravity', mode: this.gravityMode });
    this.dirty = true;
  }

  confetti(x, y) {
    this.fx.push({ k: 'confetti', x, y, seed: Math.floor(this.random() * 1e9), t: this.now() });
  }

  shake(deviceId) {
    const d = this.devices.get(deviceId);
    if (!d) return;
    for (const b of this.dynamicBodies()) {
      if (!geo.contains(d, b.position.x, b.position.y) || this.isHeld(b)) continue;
      this.unpark(b);
      Body.setVelocity(b, { x: (this.random() - 0.5) * 8, y: -6 - this.random() * 8 });
    }
  }

  // ----------------------------------------------------------------- quest
  // A tiny Cross-Screen Bridge game: the wanderer must find the key on the
  // smallest screen and carry it to the door on the far screen.
  startQuest() {
    const list = [...this.devices.values()];
    if (!list.length) return;
    // The smallest screen is the key holder (the iPod nano trick); the
    // wanderer starts on the far left and the door waits on the far right.
    const keyHolder = list.length > 1 ? [...list].sort((a, b) => area(a) - area(b))[0] : list[0];
    const rest = list.filter(d => d !== keyHolder || list.length === 1).sort((a, b) => a.x - b.x);
    const spawn = rest[0], door = rest[rest.length - 1];
    Object.assign(this.quest, { active: true, hasKey: false, spawnDevice: spawn.id, keyDevice: keyHolder.id, doorDevice: door.id });
    this.spawn('wanderer', spawn.x + Math.min(18, spawn.w / 3), spawn.y + spawn.h - 14, 1);
    this.placeKey();
    this.placeDoor();
    this.fx.push({ k: 'quest', t: this.now() });
    this.dirty = true;
  }

  placeKey(previous) {
    for (const o of this.dynamicBodies()) if (o.plugin.type === TYPE.key) Composite.remove(this.engine.world, o);
    let d = this.devices.get(this.quest.keyDevice);
    if (!d || previous) {
      let options = [...this.devices.values()].filter(o => o.id !== this.quest.doorDevice);
      if (options.length > 1) options = options.filter(o => o.id !== previous);
      d = options[Math.floor(this.random() * options.length)] || this.host();
      this.quest.keyDevice = d?.id;
    }
    if (d) this.spawn('key', d.x + d.w / 2, d.y + d.h - 10);
  }

  placeDoor() {
    if (this.door) Composite.remove(this.engine.world, this.door);
    this.door = null;
    if (!this.quest.active) return;
    let d = this.devices.get(this.quest.doorDevice);
    if (!d) { d = this.host(); this.quest.doorDevice = d?.id; }
    if (!d) return;
    this.door = Bodies.rectangle(d.x + d.w - Math.min(16, d.w / 4), d.y + d.h - 15, 16, 28, { isStatic: true, isSensor: true, label: 'door' });
    this.door.plugin = { type: TYPE.door };
    Composite.add(this.engine.world, this.door);
  }

  endQuest() {
    for (const b of this.dynamicBodies()) if (b.plugin.type === TYPE.wanderer || b.plugin.type === TYPE.key) Composite.remove(this.engine.world, b);
    this.quest.active = false;
    this.quest.hasKey = false;
    this.placeDoor();
  }

  // Synchronised opening scene: countdown on every screen, then go.
  showtime() {
    const at = this.now() + 3000;
    this.fx.push({ k: 'count', at });
    this.timeline.push({ at, run: () => {
      this.reset();
      this.startQuest();
      const list = [...this.devices.values()].sort((a, b) => a.x - b.x), first = list[0];
      if (first) this.spawn('boulder', first.x + 16, first.y + 16, 9, -2);
      const minX = Math.min(...list.map(d => d.x)), maxX = Math.max(...list.map(d => d.x + d.w));
      const top = Math.min(...list.map(d => d.y));
      this.confetti((minX + maxX) / 2, top + 30);
    } });
  }

  onCollisions(pairs, started) {
    for (const pair of pairs) {
      const a = pair.bodyA.parent, b = pair.bodyB.parent;
      const types = [a.plugin?.type, b.plugin?.type];
      if (types.includes(TYPE.wanderer) && this.quest.active) {
        const other = types[0] === TYPE.wanderer ? b : a, wanderer = other === a ? b : a;
        if (other.plugin?.type === TYPE.key && !this.quest.hasKey) {
          this.after.push(() => Composite.remove(this.engine.world, other));
          this.quest.hasKey = true;
          this.fx.push({ k: 'key', x: other.position.x, y: other.position.y });
          this.dirty = true;
        } else if (other === this.door && this.quest.hasKey) {
          this.quest.hasKey = false;
          this.quest.wins++;
          this.fx.push({ k: 'win', x: other.position.x, y: other.position.y, wins: this.quest.wins });
          this.confetti(other.position.x, other.position.y - 30);
          wanderer.plugin.dir *= -1;
          this.after.push(() => this.placeKey(this.quest.keyDevice));
          this.dirty = true;
        }
      }
      if (!started || pair.isSensor) continue;
      const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (rel < 1.6 || this.fx.length > 40) continue;
      const hit = pair.collision.supports?.[0] || a.position;
      const mover = a.isStatic ? b : a;
      this.fx.push({ k: 'hit', x: Math.round(hit.x), y: Math.round(hit.y), p: Math.min(10, Math.round(rel * 10) / 10), type: mover.plugin?.type ?? 0 });
    }
  }

  // ------------------------------------------------------------------ step
  step() {
    const now = this.now();
    for (const event of this.timeline.filter(e => e.at <= now)) event.run();
    this.timeline = this.timeline.filter(e => e.at > now);
    const strength = GRAVITY[this.gravityMode], W = geo.WORLD;
    for (const b of this.dynamicBodies()) {
      const p = b.plugin;
      if (p.parked && !b.isSleeping) p.parked = false;
      if (p.returning) {
        const dx = p.home.x - b.position.x, dy = p.home.y - b.position.y, dist = Math.hypot(dx, dy);
        if (dist < 0.8) { this.park(b); continue; }
        const speed = Math.min(22, dist * 0.14 + 1.5);
        Body.setVelocity(b, { x: (dx / dist) * speed, y: (dy / dist) * speed });
        Body.setAngle(b, b.angle * 0.85);
        continue;
      }
      if (b.isSleeping) continue;
      if (b.position.y > W.h + 120 || b.position.y < -1800 || b.position.x < -400 || b.position.x > W.w + 400) { this.lost(b); continue; }
      const d = this.deviceAt(b.position.x, b.position.y), g = d?.gravity || { x: 0, y: 1 };
      b.force.x += b.mass * g.x * strength * 0.001;
      b.force.y += b.mass * g.y * strength * 0.001;
      if (this.gravityMode === 'zero') b.frictionAir = 0.006;
      else if (b.frictionAir === 0.006) b.frictionAir = 0.01;
      if (p.type === TYPE.wanderer) this.walk(b);
    }
    Engine.update(this.engine, STEP_MS);
    const after = this.after;
    this.after = [];
    for (const run of after) run();
  }

  walk(b) {
    const p = b.plugin;
    Body.setVelocity(b, { x: p.dir * 1.15, y: b.velocity.y });
    p.stuck = Math.abs(b.position.x - p.lastX) < 0.25 ? p.stuck + 1 : 0;
    p.lastX = b.position.x;
    if (p.stuck > 18) { p.dir *= -1; p.stuck = 0; }
  }

  // Something fell off the edge of every screen.
  lost(b) {
    const t = b.plugin.type;
    if (t === TYPE.icon) { b.plugin.returning = true; b.collisionFilter.mask = 0; Body.setPosition(b, { x: b.plugin.home.x, y: -200 }); return; }
    Composite.remove(this.engine.world, b);
    if (t === TYPE.wanderer && this.quest.active) {
      const d = this.devices.get(this.quest.spawnDevice) || this.host();
      if (d) this.spawn('wanderer', d.x + Math.min(18, d.w / 3), d.y + d.h - 14, 1);
    }
    if (t === TYPE.key && this.quest.active) this.placeKey();
  }

  // ------------------------------------------------------------- snapshots
  snapshot() {
    const held = new Set([...this.grabs.values()].map(c => c.bodyB));
    const r = n => Math.round(n * 10);
    const list = [];
    for (const b of this.engine.world.bodies) {
      const p = b.plugin;
      if (b.isStatic && p.type !== TYPE.door) continue;
      let extra = 0;
      if (p.type === TYPE.icon) extra = p.app;
      else if (p.type === TYPE.ball) extra = p.hue;
      else if (p.type === TYPE.wanderer) extra = (p.dir > 0 ? 1 : 0) | (this.quest.hasKey ? 2 : 0);
      else if (p.type === TYPE.door) extra = this.quest.hasKey ? 1 : 0;
      const flags = (held.has(b) ? 1 : 0) | (p.returning ? 2 : 0) | (p.parked ? 4 : 0);
      list.push([b.id, p.type, r(b.position.x), r(b.position.y), Math.round(b.angle * 1000), extra, flags]);
    }
    return list;
  }

  desk() {
    const devices = [...this.devices.values()];
    return {
      devices,
      portals: geo.portals(devices),
      hostId: this.host()?.id || null,
      gravity: this.gravityMode,
      quest: { active: this.quest.active, hasKey: this.quest.hasKey, wins: this.quest.wins, keyDevice: this.quest.keyDevice, doorDevice: this.quest.doorDevice },
    };
  }

  drainFx() {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  destroy() {
    Events.off(this.engine);
    Engine.clear(this.engine);
  }
}

module.exports = { World, APPS, TYPE, GRAVITY, COLORS };
