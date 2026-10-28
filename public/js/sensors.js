// Tilt and shake. The device's real-world gravity is projected onto its
// screen, so tipping a phone sideways like a ramp pours its contents out
// through the edge and onto the neighbouring screen.
import { net } from './net.js';

let enabled = false, last = { x: 0, y: 1 }, lastSent = 0, lastShake = 0;
const rad = d => (d * Math.PI) / 180;

function screenAngle() {
  return screen.orientation?.angle ?? window.orientation ?? 0;
}

export function gravityFrom(beta, gamma, angle = 0) {
  // Gravity in device coordinates (x right, y down the screen).
  let gx = Math.sin(rad(gamma)) * Math.cos(rad(beta));
  let gy = Math.sin(rad(beta));
  // Lying flat, real gravity points into the desk; keep a gentle "down" so a
  // flat phone still behaves like the side-view world, and tilt adds a ramp.
  const inPlane = Math.hypot(gx, gy);
  if (inPlane < 1) gy += 1 - inPlane;
  const a = rad(-angle);
  const x = gx * Math.cos(a) - gy * Math.sin(a), y = gx * Math.sin(a) + gy * Math.cos(a);
  const len = Math.hypot(x, y) || 1;
  return { x: (x / len) * Math.min(1.6, len * 1.15), y: (y / len) * Math.min(1.6, len * 1.15) };
}

function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  const g = gravityFrom(e.beta, e.gamma, screenAngle()), now = performance.now();
  if (now - lastSent < 50 || Math.hypot(g.x - last.x, g.y - last.y) < 0.03) return;
  last = g;
  lastSent = now;
  net.send('tilt', g);
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const jolt = Math.abs(Math.hypot(a.x, a.y, a.z) - 9.81), now = performance.now();
  if (jolt > 16 && now - lastShake > 900) { lastShake = now; net.send('shake', {}); net.emitLocal('shake'); }
}

export const sensors = {
  get enabled() { return enabled; },
  available: () => typeof DeviceOrientationEvent !== 'undefined',
  // Must run inside a user gesture on iOS.
  async enable() {
    if (!isSecureContext) throw new Error('Tilt needs HTTPS — run `npm run start:https` or use a tunnel.');
    if (!this.available()) throw new Error('This device has no motion sensors.');
    if (typeof DeviceOrientationEvent.requestPermission === 'function' && (await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('Motion permission was declined.');
    if (typeof DeviceMotionEvent?.requestPermission === 'function') { try { await DeviceMotionEvent.requestPermission(); } catch {} }
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    enabled = true;
  },
  disable() {
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('devicemotion', onMotion);
    enabled = false;
    net.send('tilt', { off: true });
  },
};
