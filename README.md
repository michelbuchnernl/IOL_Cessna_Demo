# IOL_Cessna_Demo

Single-experience WebXR classroom demo for inspecting an aircraft hangar in AR, VR, and fallback mode with shared object controls, teacher-prepped chroma-keyed videos, and student-triggered video markers.

## Docs

- [Audit V3, oktober 2026 (NL)](docs/audit-2026-10-04.md): known bugs, measurements, headset test list and the V4 plan
- [Architecture](docs/architecture.md)
- [Presentation runbook](docs/presentation-runbook.md)

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

## Teacher/student flow

1. Choose Teacher or Student.
2. Teacher creates a 4-character session code.
3. Students join with that code.
4. Each device presses Calibrate at the same classroom zero spot.
5. Teacher starts the shared experience and controls Shell Off, Restart Video, Reveal Markers, object sizing, marker visibility, and the video prep panel.
6. Teacher preps the videos before revealing them:
   - Cessna video is teacher-controlled. The teacher calls it up and can size, lift, pause/play, and chroma-key it.
   - Boeing and Turbofan videos are student-triggered blue-ball videos. The teacher can select each blue ball, size/lift/chroma-key the preview, and leave it paused while preparing.
7. Teacher sets each student video access state:
   - Green: armed for students. Students see the blue ball and can press it to play the video.
   - Orange: teacher-only prep. Students do not see it.
   - Red: hidden. Students do not see it; teacher sees only the recovery marker, with the preview hidden/not playing.
8. Teacher presses Reveal Markers when the student-facing markers should appear.
9. Students select green/armed blue balls locally to start their videos.
10. Students open the configured assessment URL.

## Video prep controls

Select a video marker as Teacher to open the Green Screen Video panel.

- Key sliders change the chroma-key settings for the selected/prepped video materials.
- Video size resizes the selected video preview.
- Height lifts or lowers the selected video marker/preview.
- Play and Pause let the teacher check a clip while keeping the default prep state silent and paused.
- Play From Start restarts the selected preview video.
- Reset restores the default key/size/height values.

For desktop prep, `Ctrl` + drag moves a video marker/preview, and `Shift` + mouse wheel adjusts its depth from the camera.

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
