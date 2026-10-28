# ShatterOS

**Your screens. One world.** A working multi-device physics playground inspired by choreographed viewport illusions. Open one room on several devices and use each screen as a window into one continuous world.

## Run it

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Open http://localhost:3000. To connect a phone on the same Wi-Fi, use `http://YOUR_COMPUTER_LAN_IP:3000` on both devices, then enter the same room code. Allow the port through your local firewall if necessary. Alternatively run the Docker image using `docker build -t shatteros .` and `docker run -p 3000:3000 shatteros`.

1. Join the same room on all screens. The room code is also in the URL for sharing.
2. Measure the visible canvas width on each device with a ruler and enter it in millimeters. Apply calibration.
3. Arrange the rectangles in the desk map to match your physical screens. Leave real bezel gaps between them.
4. Launch a ball, or drag and release on the canvas to throw one. It crosses the global space and knocks sleeping cards out of their grid.
5. Use Immersive mode for edge-to-edge viewing; calibrate again after changing browser UI or orientation.
6. Enable tilt on a compatible phone over HTTPS. A small screen or watch browser can join and act as a Reset grid remote.

For a quick single-computer demo, open two browser windows in the same room and place their map rectangles next to one another. This demonstrates the handoff without requiring sensor access.

## Implemented

- Authoritative Matter.js simulation at 60 fixed steps/second, snapshots at 30/second.
- Socket.IO rooms, automatic reconnect/rejoin, cleanup of empty worlds.
- Global 1600 × 900 millimeter space; canvas viewports with independent position and physical scale.
- Manual layout editor, numeric calibration, visible bezel travel, live viewport movement.
- Projectile launches, card collisions, reset, local tilt force and fullscreen view.
- Input validation, room/device/body limits, basic event throttling, integration tests and GitHub Actions.

The server remains the authority; clients interpolate the previous two snapshots. Interpolation adds roughly one snapshot of latency and does not eliminate network jitter. There is no camera tracking or automatic physical position detection.

## The math

`worldX = viewport.x + localCssX / cssPixelsPerMillimeter`

`screenCssX = (worldX - viewport.x) * cssPixelsPerMillimeter`

`cssPixelsPerMillimeter = visibleCanvasCssWidth / measuredCanvasWidthMm`

Height follows the canvas aspect ratio. Device pixel ratio is used only for sharp rendering, not physical-size inference. Browser-reported pixels do **not** reliably reveal physical DPI.

## Project map

| File | Responsibility |
| --- | --- |
| `server.cjs` | HTTP, room lifecycle, validated socket events, physics and snapshots |
| `public/app.js` | Calibration, interpolation, rendering, throwing, tilt and desk map |
| `public/index.html` / `style.css` | Responsive playground interface |
| `test/integration.test.cjs` | Real server and multi-client integration checks |

## Verify

```sh
npm test
```

Tests cover shared bodies, room isolation, manual viewport placement, a projectile crossing a viewport gap, reset, disconnect cleanup and invalid room rejection. Browser UI and real-device sensor behavior still need physical-device validation.

## Hosting

Deploy as **one persistent Node process** or Docker container with WebSocket support, behind HTTPS. Set `PORT` as needed. This version uses in-memory rooms: restarting the server clears them. Do not deploy the server as a short-lived request function. Multiple replicas require room affinity and a dedicated authoritative simulation design; a Socket.IO adapter alone is insufficient.

Room codes are bearer access: anyone knowing a code can move viewports, launch objects and reset that room. There are no accounts, private-room authorization or durable projects. Treat this as a trusted-group prototype until those controls are implemented.

## Scope and limitations

This is the ShatterOS sandbox foundation. The Modular Desk creative studio and Cross-Screen Bridge game are future modes, not finished features. OS icons are simulated app content; browser security prevents manipulating the real home screen. Tilt needs HTTPS, user permission where required, and compatible hardware. Watch browsers vary; native crown controls and haptics are not implemented. Physical movement is represented by dragging the map; moving a phone on the desk is not automatically tracked. Floors and walls belong to the global world, not each screen edge.

Simultaneous edge touches are not an exact spatial calibration method by themselves: touch timing cannot uniquely determine screen offsets, gaps or rotation. A future gesture flow needs known edges, matched contact points, clock offset estimation and a manual correction step.

## Roadmap

- [ ] Host/participant permissions, reconnect identity, persistent layouts and a shared join QR code.
- [ ] Pairwise edge calibration with explicit gap measurement and offset correction.
- [ ] Clock offset/RTT telemetry and adaptive snapshot interpolation.
- [ ] Rotated viewports and screen-orientation-aware gravity.
- [ ] Kinematic carrier surfaces for the elevator-screen interaction.
- [ ] Modular Desk mode: transferable cards, palette and inspector roles.
- [ ] Bridge game: character, moving platforms, keys and goals.
- [ ] Dedicated wearable controller, accessible map positioning and device test matrix.

## Continue developing

```sh
git clone https://github.com/mosrvs2025/ShatterOS.git
cd ShatterOS
npm ci
npm start
```

See the roadmap above for the next implementation milestones.

## License

MIT; see LICENSE.
