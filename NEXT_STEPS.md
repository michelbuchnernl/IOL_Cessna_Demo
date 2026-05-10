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

If `5173` is already occupied, Vite will print the alternate local URL. During the latest Codex verification it used:

```text
http://localhost:5174/
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

After a machine restart, do not assume the pre-restart LAN address is still valid. Start `npm run dev:all` and use the HTTPS Network URL printed by Vite for the Quest Browser.

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

## Restart Handoff - May 10, 2026

Latest git state before restart:

```text
## main...origin/main [ahead 1]
 M src/scene/ExperienceScene.ts
```

Latest change:

- Fixed the Three.js `_PlaneGeometry` NaN warning path by adding finite positive dimension guards in `src/scene/ExperienceScene.ts`.
- All local `PlaneGeometry` creation now routes through `createFinitePlaneGeometry(...)`.
- XR button width/aspect values are sanitized before creating both the visible button plane and matching hit target.
- The teleport floor plane uses a finite fallback size of `14`.

Verification already completed:

- `npm run build` passed.
- Codex browser rendered the teacher hangar scene.
- Browser warn/error logs were empty after loading the scene.
- The verified Codex URL was `http://localhost:5174/` because `5173` was occupied.

Useful restart sequence:

```bash
cd "/Users/michelbuchner/Documents/New project/IOL_Cessna_Demo"
git status --short --branch
npm run build
npm run dev:codex:all
```

For Quest testing after restart:

```bash
npm run dev:all
```

Then open the HTTPS Network URL printed by Vite on the Quest, for example:

```text
https://<mac-ip>:5173/
```

## Resolved Issue

This warning was the active issue for the latest handoff and should now be resolved:

```text
THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values. _PlaneGeometry
```

If it appears again, inspect any new `PlaneGeometry` call sites first and make sure derived width/height values are finite positive numbers before constructing geometry.

## Suggested Next Prompt

```text
Continue IOL_Cessna_Demo from NEXT_STEPS.md after restart. First inspect git status, run npm build, then start the appropriate dev server and verify the Codex browser or Quest URL.
```

## Presentation Priorities

1. Rehearse on the separate router with one Quest.
2. Confirm Quest Browser accepts the HTTPS URL and immersive WebXR starts.
3. Add all five Quests and test joining the same teacher session.
4. Confirm video triggers and marker reveal.
5. Keep fallback mode ready as backup if trusted HTTPS blocks immersive XR.
