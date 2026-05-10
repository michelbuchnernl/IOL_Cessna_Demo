# IOL_Cessna_Demo

Single-experience WebXR classroom demo for inspecting a Cessna in AR, VR, and fallback mode with shared object controls and a chroma-keyed Cessna video.

## Stack

- Vite + TypeScript client
- Three.js with WebXRManager, ARButton, and VRButton
- Node.js WebSocket classroom sync server
- JSON/TypeScript-driven experience configuration

## Run locally

Install dependencies:

```bash
npm install
```

Run the client and classroom sync server:

```bash
npm run dev:all
```

Open the Vite HTTPS URL from the terminal output. Quest Browser requires HTTPS for immersive WebXR APIs. In local development, Vite proxies `/classroom-ws` to the plain WebSocket server on port `8787`, so the browser connects with the same HTTPS/WSS origin. Override `VITE_CLASSROOM_WS_URL` when deploying behind your own TLS proxy.

For Codex in-app browser debugging, use the HTTP-only dev script:

```bash
npm run dev:codex:all
```

Then open `http://localhost:5173/`. This avoids local certificate errors in Codex while keeping `npm run dev:all` as the HTTPS path for Quest/WebXR testing.

For the classroom presentation setup with a Mac, separate router, and multiple Quests, use the runbook in [docs/presentation-runbook.md](docs/presentation-runbook.md).

## MVP flow

1. Choose Teacher or Student.
2. Teacher creates a 4-character session code.
3. Students join with that code.
4. Each device presses Calibrate at the same classroom zero spot.
5. Teacher starts the shared experience and controls Shell Off, Play Introduction, Reveal Markers, object sizing, marker visibility, and the greenscreen Cessna video.
6. Students select revealed markers locally.
7. Students open the configured assessment URL.

## Assets

Project assets are wired to:

- `public/assets/experiences/iol-cessna-demo/models/turbofan.glb`
- `public/assets/experiences/iol-cessna-demo/environments/hangar.glb`
- `public/assets/experiences/iol-cessna-demo/videos/cessna.mp4`
- `public/assets/experiences/iol-cessna-demo/videos/turbine.mp4`
- `public/assets/experiences/iol-cessna-demo/videos/boeing.mp4`
- `public/assets/chroma/cessna-green-screen.mp4`

Optional UI button artwork can live in `public/assets/ui-buttons/`. The current MVP uses CSS buttons so the app remains usable before final art is copied in.

If the GLB is missing, the app renders a simple placeholder model so the classroom flow can still be tested.

## Deployment notes

- Use runtime capability detection through `navigator.xr` and `isSessionSupported("immersive-ar" | "immersive-vr")`.
- Use AR/MR for real passthrough. Do not fake passthrough in VR with camera access.
- For Quest classroom testing, host the Vite build and WebSocket server on a machine reachable by all headsets over the same network.
- APK export is future work. Reasonable paths are PWA installability, Trusted Web Activity, or Capacitor wrapping after the web app stabilizes.

More architecture notes are in [docs/architecture.md](docs/architecture.md).
