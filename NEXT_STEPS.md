# Next Steps

This checkpoint was made on Sunday, May 10, 2026 for the prototype presentation on Wednesday, May 13, 2026.

## Current Run Modes

Codex in-app browser debugging:

```bash
npm run dev:codex:all
```

Open:

```text
http://localhost:5173/
```

Quest/WebXR testing:

```bash
npm run dev:all
```

Open the Vite HTTPS Network URL on the Mac and Quests:

```text
https://<mac-ip>:5173/
```

The HTTPS route is required for immersive WebXR on Quest Browser. The Codex in-app browser rejects the local self-signed HTTPS certificate, so use the HTTP-only Codex mode for visual debugging.

## Current Default Spawn

The selected first spawn/view is stored in `src/experiences/cessnaExperience.ts`:

```ts
initialView: {
  mode: "inspect",
  target: [7.867, 1.795, 0.383],
  distance: 18,
  yaw: 6.559,
  pitch: -0.109
}
```

Teacher mode also has a `Capture View` button. Move/orbit to a better view, press `Capture View`, then copy the shown `initialView` snippet into the experience config.

## What Was Changed In This Checkpoint

- Added `npm run dev:codex:all` for HTTP debugging in the Codex browser.
- Kept `npm run dev:all` as the HTTPS path for Quest/WebXR.
- Added `.nvmrc` with Node 20.
- Added `docs/presentation-runbook.md` for Mac plus five Quest headsets on a separate router.
- Updated stale README asset references.
- Updated the browser title to `IOL Cessna Demo`.
- Added typed `initialView` support.
- Added the teacher `Capture View` helper.
- Changed the model visibility label from `Cessna` to `Turbofan`.
- Marked binary assets in `.gitattributes`.

## Known Issue

There is still a Three.js console warning:

```text
THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values. _PlaneGeometry
```

The scene still renders and `npm run build` passes. Next useful task: reproduce this warning on a fresh page load, identify which `PlaneGeometry` gets a NaN dimension, and fix it so presentation debugging stays quiet.

## Suggested Next Prompt

```text
Continue IOL_Cessna_Demo from NEXT_STEPS.md. First inspect git status, then fix the Three.js PlaneGeometry warning and verify the Codex browser view.
```

## Presentation Priorities

1. Rehearse on the separate router with one Quest.
2. Confirm Quest Browser accepts the HTTPS URL and immersive WebXR starts.
3. Add all five Quests and test joining the same teacher session.
4. Confirm video triggers and marker reveal.
5. Keep fallback mode ready as backup if trusted HTTPS blocks immersive XR.
