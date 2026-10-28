# ◈ ShatterOS

**Every screen on your desk. One world.**

ShatterOS turns your laptop, phone, tablet and watch into windows onto one continuous, physical world. Each screen sees its own slice of it, measured in real millimetres. Throw an app icon off the laptop and it flies across the bezel gap onto your phone. Tip the phone like a ramp and its contents pour out onto the laptop. A small traveller walks from screen to screen looking for a key that waits on your watch.

Nothing is pre-rendered. One authoritative physics simulation runs on the server, and every device renders the same world shifted to its own place on the desk.

## Run it

Requires Node.js 22+.

```sh
npm ci
npm start              # http://localhost:3000
npm run start:https    # https://localhost:3443, needed for tilt & shake on phones
```

1. On the laptop, open the URL and press **Create a world**.
2. A QR code appears. Scan it with your phone (same Wi‑Fi). The phone docks to the right of the laptop on its own, and things can already roll across.
3. Press **Link** 🔗 and swipe one finger off the edge of one screen and straight onto the next. The two screens line up to the millimetre, and the wallpaper's sun and grid continue across the bezel.
4. Press **Showtime** 🎬.

With `start:https` the server creates a self-signed certificate for your LAN addresses in `.cert/`. Each phone has to accept the warning once. A tunnel such as `cloudflared` or `ngrok` works too. Docker: `docker build -t shatteros . && docker run -p 3000:3000 shatteros`.

No second device? Open two browser windows side by side, put both in the same world, and arrange them in **Desk Map**.

## What makes it feel like magic

| | |
| --- | --- |
| **World‑space wallpaper** | The synthwave sun, mountains, aurora and stars are painted in world millimetres, not per screen. Once the screens are aligned the art continues across the bezels, so anyone can see that the screens share one space. |
| **Bezels are real space** | The gap between screens is part of the world. Objects keep travelling through it at the same speed and come out the other side. |
| **Portals, walls and bridges** | Each screen's bottom edge is a floor and its sides are walls, except where an edge faces another screen. Those edges become glowing portals labelled with the neighbour's name and gap. Narrow gaps get an invisible bridge so things roll across. A wide gap is a real hole that things fall into. |
| **Swipe to link** (Pinch‑style) | Swipe off one screen onto another. The server matches the exit and the entry, lines up the touch points, and estimates the bezel gap as *finger speed × time in the gap*. |
| **True size** | Hold a bank card against the screen and match the outline (ISO ID‑1, 85.6 × 54 mm). After that, a 16 mm icon is 16 mm on every device. |
| **Elevator screens** | Dragging a screen in the Desk Map carries whatever is inside it, like sliding a phone with the character still in it. Stack a screen under another and the floor above it opens. |
| **Tilt & shake** | The phone's real gravity is projected onto its screen. Tip it sideways on the desk and its contents slide off the edge onto the next screen. Shake it and everything on it jumps. |
| **Apps are objects** | The desktop icons are physics bodies. Tap one to run it. Drag it to fling it across screens. The **Magnet** pulls every scattered icon home through everything else. |
| **Synchronised time** | Clients estimate the server clock (NTP‑style). The Showtime countdown hits zero on every screen at the same moment, and confetti, shockwave rings and twinkling stars are computed from shared timestamps and seeds, so a burst that starts on the laptop carries on across the phone. |
| **Sound from the right screen** | Impacts play only on the device where they happen, panned to where they hit. Phones buzz under heavy hits. |
| **Form‑factor roles** | **Laptop:** the stage, with a desktop of apps, a dock and keyboard shortcuts. **Phone/tablet:** a window with tilt and shake. **Watch:** a one‑button remote (swipe or turn the crown to choose Magnet, Shockwave, Confetti…). The smallest screen also holds the quest key, like the iPod nano. |
| **Cross‑Screen Quest** | 🗝️ The wanderer walks continuously and turns back at walls. Bridge the gaps, move screens as elevators, pick up the key on the smallest screen and reach the door on the far one. |

### Gestures & keys

| Do | Gesture | Key |
| --- | --- | --- |
| Open an app | tap its icon | |
| Grab & fling anything | press, drag, release | |
| Slingshot an orb | pull back on empty space (shows its trajectory) | `O` launches one |
| Shockwave | double‑tap empty space | `Space` at the cursor |
| Boulder · Wanderer · Magnet · Gravity · Confetti · Showtime · Quest | dock / icons | `B` `W` `M` `G` `C` `S` `Q` |
| Link · Desk map · Add screen | dock / icons | `L` `P` `A` |
| Cinema mode · Full screen | ◈ menu | `H` · `F` |

## How it works

```
 phone  ─┐                                   ┌─ every client renders
 laptop ─┼─ Socket.IO ─▶  room: World        │  screenPx = (worldMm − originMm) × pxPerMm
 watch  ─┘   inputs       • Matter.js @60 Hz │  interpolating snapshots ~95 ms in the past
                          • devices = viewports in mm
                          • floors/walls/bridges rebuilt from the layout
                          ── snapshots @30 Hz + fx events ─▶
```

- **`lib/geometry.cjs`** holds the pure desk math: neighbours, portals, floor and wall solids with holes cut where screens face each other, bridges, auto‑placement, snapping, and swipe‑link positioning.
- **`lib/world.cjs`** is the simulation for one room: per‑screen gravity (tilt), parked icons that sleep until hit, magnet recall, grab constraints, shockwaves, elevator carry, the wanderer, key and door, and the Showtime timeline.
- **`server.cjs`** handles rooms, validation, per‑socket rate limits, reconnection (a device gets its old position back), the QR code at `/qr.svg`, LAN discovery at `/api/info`, and optional HTTPS.
- **`public/js/`** contains the browser modules: `net` (clock sync, snapshot interpolation), `render` (sprites, the silhouette, portals, trails, off‑screen hints), `art` (world wallpaper), `fx` (deterministic shared effects), `input` (gestures, swipe‑link), `sensors` (tilt & shake), `audio` (synth), `ui` (the OS shell).

Key formulas:

- `pxPerMm` comes from card calibration, or a per‑form‑factor guess until you calibrate. Browsers do not report real pixel density.
- Gravity on a screen from `DeviceOrientation` is `g = (sin γ · cos β, sin β)`, rotated by `screen.orientation.angle`. A phone lying flat keeps a gentle default "down", so it still behaves like the side‑view world, and tilt then acts as a ramp.
- Swipe link: `B.x = A.right + gap`, `B.y = A.y + exitAlong − enterAlong`, with `gap ≈ fingerSpeed × (tEnter − tExit)`, clamped to 2–70 mm.

## Test

```sh
npm test
```

20 tests run in about a second. They cover the geometry (portals, holes, bridges, snapping, link math), the simulation (crossing a bezel, elevator carry, shockwave and magnet, grab and fling, tilt pouring, a complete quest, the Showtime timeline) and the server end to end over real sockets (placement, room isolation, swipe linking, reconnect identity, input validation, QR).

## Hosting & limits

- Run it as **one long‑lived Node process** with WebSockets, behind HTTPS. Rooms live in memory, are kept for 60 s after the last screen leaves, and are lost on restart. Several replicas would need room affinity.
- A room code works like a password: anyone with it can join and act in that world. There are no accounts. Treat it as something to use with people you trust.
- Swipe linking needs touch, or a mouse drag that ends at the edge. iOS Safari's edge‑swipe‑back gesture can get in the way on the left edge, so use **Add to Home Screen** for a full‑screen app.
- Tilt needs HTTPS and, on iOS, a permission tap. Watch browsers vary, so the remote also works with taps and swipes.
- Screens are assumed upright and unrotated relative to each other.

## Roadmap

- Rotated screens and orientation‑aware portals
- Modular Desk studio: a card palette on the phone, an inspector on the tablet, a metronome on the watch
- More quest levels with moving platforms and switches across devices
- Optional camera‑assisted auto‑layout (each screen flashes a marker)

## License

MIT, see [LICENSE](LICENSE).
