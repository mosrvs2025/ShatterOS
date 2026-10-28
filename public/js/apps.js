// The apps on the ShatterOS desktop. They are physical objects in the shared
// world *and* the controls of the OS. Order must match APPS in lib/world.cjs.
export const APPS = [
  { id: 'orb', glyph: '🔮', label: 'Orb', hue: 275, hint: 'Launch a glowing orb', key: 'o' },
  { id: 'boulder', glyph: '🪨', label: 'Boulder', hue: 28, hint: 'Drop something heavy', key: 'b' },
  { id: 'wanderer', glyph: '🚶', label: 'Wanderer', hue: 205, hint: 'A traveller who walks between screens', key: 'w' },
  { id: 'wave', glyph: '🌊', label: 'Shockwave', hue: 190, hint: 'Blast everything nearby', key: ' ' },
  { id: 'magnet', glyph: '🧲', label: 'Magnet', hue: 355, hint: 'Pull every icon back home', key: 'm' },
  { id: 'gravity', glyph: '🪐', label: 'Gravity', hue: 45, hint: 'Earth → Moon → Zero‑G', key: 'g' },
  { id: 'confetti', glyph: '🎉', label: 'Confetti', hue: 320, hint: 'Celebrate across every screen', key: 'c' },
  { id: 'showtime', glyph: '🎬', label: 'Showtime', hue: 262, hint: '3 · 2 · 1 — a synchronised scene', key: 's' },
  { id: 'link', glyph: '🔗', label: 'Link', hue: 150, hint: 'Swipe across screens to align them', key: 'l' },
  { id: 'map', glyph: '🗺️', label: 'Desk Map', hue: 100, hint: 'Arrange your screens', key: 'p' },
  { id: 'add', glyph: '📲', label: 'Add Screen', hue: 220, hint: 'QR code for another device', key: 'a' },
  { id: 'quest', glyph: '🗝️', label: 'Quest', hue: 48, hint: 'Help the wanderer carry the key home', key: 'q' },
];

export const TYPE = { icon: 0, ball: 1, boulder: 2, wanderer: 3, key: 4, door: 5 };
export const GRAVITY = { earth: 2, moon: 0.55, zero: 0 };
export const GRAVITY_LABEL = { earth: '🌍 Earth', moon: '🌙 Moon', zero: '✨ Zero‑G' };
export const STEP_MS = 1000 / 60;
