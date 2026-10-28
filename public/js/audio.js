// Tiny synthesiser. Sounds play only on the screen where they happen, so
// a crash literally comes out of the device it lands on.

let ac = null, master = null, recent = 0, recentAt = 0;

export function unlockAudio() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createDynamicsCompressor();
      const gain = ac.createGain();
      gain.gain.value = 0.9;
      master.connect(gain).connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
  } catch {}
}

function budget() {
  const now = performance.now();
  if (now - recentAt > 120) { recent = 0; recentAt = now; }
  return ++recent <= 10;
}

function voice({ type = 'sine', freq = 440, to = null, dur = 0.15, gain = 0.2, pan = 0, delay = 0 }) {
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o.connect(g);
  if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); node = node.connect(p); }
  node.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur = 0.08, gain = 0.15, freq = 1800, pan = 0 }) {
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime, len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8; g.gain.value = gain;
  let node = src.connect(f).connect(g);
  if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
  node.connect(master);
  src.start(t);
}

export const sfx = {
  hit(type, power, pan) {
    if (!budget()) return;
    const v = Math.min(1, power / 8);
    if (type === 2) { voice({ freq: 95, to: 40, dur: 0.4, gain: 0.5 * v + 0.1, pan }); noise({ dur: 0.18, gain: 0.25 * v, freq: 400, pan }); }
    else if (type === 1) voice({ type: 'sine', freq: 1200 + Math.random() * 600, to: 900, dur: 0.18, gain: 0.12 * v + 0.03, pan });
    else { voice({ type: 'triangle', freq: 420 + Math.random() * 260, to: 260, dur: 0.09, gain: 0.16 * v + 0.03, pan }); noise({ dur: 0.04, gain: 0.08 * v, freq: 2600, pan }); }
  },
  pop(pan = 0) { noise({ dur: 0.12, gain: 0.25, freq: 3000, pan }); voice({ freq: 880, to: 1760, dur: 0.12, gain: 0.08, pan }); },
  whoosh(pan = 0) { noise({ dur: 0.35, gain: 0.12, freq: 700, pan }); },
  boom(pan = 0) { voice({ freq: 70, to: 30, dur: 0.6, gain: 0.45, pan }); noise({ dur: 0.4, gain: 0.2, freq: 300, pan }); },
  chime() { [660, 990, 1320].forEach((f, i) => voice({ type: 'sine', freq: f, dur: 0.5, gain: 0.12, delay: i * 0.08 })); },
  count(final) { voice({ type: 'square', freq: final ? 1320 : 660, dur: final ? 0.5 : 0.18, gain: 0.08 }); },
  tick() { voice({ type: 'triangle', freq: 1500, dur: 0.03, gain: 0.05 }); },
  key() { [880, 1175, 1760].forEach((f, i) => voice({ type: 'triangle', freq: f, dur: 0.25, gain: 0.1, delay: i * 0.06 })); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => voice({ type: 'triangle', freq: f, dur: 0.45, gain: 0.12, delay: i * 0.09 })); },
  join() { voice({ freq: 330, to: 660, dur: 0.35, gain: 0.1 }); voice({ freq: 495, to: 990, dur: 0.35, gain: 0.07, delay: 0.1 }); },
  magnet() { voice({ type: 'sawtooth', freq: 120, to: 480, dur: 0.6, gain: 0.05 }); },
};

export function buzz(ms) {
  try { navigator.vibrate?.(ms); } catch {}
}
