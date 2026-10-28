// Physical scale. Browsers do not report real pixel density, so we start
// from a form-factor guess and let the person refine it against a bank card.

const KEY = 'shatteros.pxPerMm';
const DEFAULT = { watch: 7.2, phone: 6.3, tablet: 5.1, desktop: 4.1 };

export const KIND_ICON = { desktop: '💻', tablet: '📟', phone: '📱', watch: '⌚' };
export const KIND_LABEL = { desktop: 'Laptop', tablet: 'Tablet', phone: 'Phone', watch: 'Watch' };

export function detectKind() {
  const shortSide = Math.min(innerWidth, innerHeight);
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (shortSide < 260) return 'watch';
  if (coarse && Math.min(screen.width, screen.height) < 520) return 'phone';
  if (coarse) return 'tablet';
  return 'desktop';
}

export function guessName(kind) {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Watch|Wear OS/i.test(ua)) return 'Watch';
  if (/Android/.test(ua)) return kind === 'tablet' ? 'Android tablet' : 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'PC';
  if (/CrOS/.test(ua)) return 'Chromebook';
  return KIND_LABEL[kind];
}

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch {} }

export const scale = {
  kind: 'desktop',
  pxPerMm: DEFAULT.desktop,
  calibrated: false,
  init(kind) {
    this.kind = kind;
    const saved = Number(read(KEY));
    this.calibrated = saved >= 1.5 && saved <= 20;
    this.pxPerMm = this.calibrated ? saved : DEFAULT[kind];
  },
  set(v) {
    this.pxPerMm = Math.max(1.5, Math.min(20, v));
    this.calibrated = true;
    write(KEY, String(this.pxPerMm));
  },
  // The visible size of this screen in millimetres.
  size() {
    return { w: innerWidth / this.pxPerMm, h: innerHeight / this.pxPerMm };
  },
};

export function deviceKey() {
  let k = null;
  try { k = sessionStorage.getItem('shatteros.key'); } catch {}
  if (!k) {
    k = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('shatteros.key', k); } catch {}
  }
  return k;
}
