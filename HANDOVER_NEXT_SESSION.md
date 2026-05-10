# IOL Cessna Demo Handover - May 10, 2026

We are working in:

```text
/Users/michelbuchner/Documents/New project/IOL_Cessna_Demo
```

Current goal: stabilize the IOL Cessna Demo for Quest testing and presentation.

## V3 Sleep Note - May 10, 2026

V3 is the current stable demo checkpoint to commit.

What works well enough to preserve:

- Teacher monitor placement flow works.
- Student Quest flow works for the currently tested video interactions.
- Tablet flow works.
- Remote participant labels/HMD/controllers were added and survived testing.
- Optimized hangar GLB is in use and build still passes.
- Image quality was tuned with lower exposure, XR framebuffer scaling, foveation adjustment, and texture anisotropy.
- Teacher asset placement menu exists for monitor `Alt + right mouse` and Quest Teacher `A` path, but see the active bug below.

Active V3 bug to pick up next:

- Teacher Quest controller input is still broken. Right thumbstick does not rotate/teleport, `B` does not open the slider/menu panel, and `A` placement is still dead from inside Teacher Quest VR.
- Teacher monitor and Student Quest still work, so preserve current behavior while debugging this.
- Likely next debugging step: add an in-headset XR input diagnostic overlay/log for `session.inputSources`, `handedness`, gamepad axes, and button pressed states in Teacher Quest mode. The current fallback resolver in `src/scene/ExperienceScene.ts` may still not match what Quest Browser exposes for the teacher session.

## Current Run State

Quest/WebXR HTTPS stack is currently running with:

```bash
npm run dev:all
```

Current URLs from Vite:

```text
Mac Chrome: https://localhost:5173/
Quest primary: https://192.168.1.86:5173/
Quest fallback: https://192.168.1.197:5173/
```

The classroom sync server is running on port `8787` and Vite proxies WebSocket traffic through `/classroom-ws`.

After any server restart, create a new teacher session code.

For Codex in-app browser HTTP debugging only:

```bash
npm run dev:codex:all
```

## Git State

Latest observed state:

```text
## main...origin/main [ahead 1]
 M NEXT_STEPS.md
 M README.md
 M docs/presentation-runbook.md
 M server/index.ts
 M src/app/ClassroomApp.ts
 M src/experiences/cessnaExperience.ts
 M src/net/ClassroomSocket.ts
 M src/net/protocol.ts
 M src/scene/ExperienceScene.ts
```

This handover file is new and should also appear as modified/untracked after creation.

## Verification

Latest completed verification:

```bash
npm run build
```

Result: passes. Vite still warns only about chunk size.

HTTPS smoke check:

```bash
curl -k -I https://localhost:5173/
```

Result: `HTTP/1.1 200 OK`.

## Recent Implemented Changes

Per-video prep state was added:

- `videoPrepStates` keyed by video part id.
- Synced through `src/net/protocol.ts`, `src/net/ClassroomSocket.ts`, and `server/index.ts`.
- Used by `src/app/ClassroomApp.ts` for the Green Screen Video panel.
- Applied by `src/scene/ExperienceScene.ts` to teacher previews, markers, and video billboards.

Teacher video controls were adjusted:

- Reset uses real default video values, not remembered device settings.
- Selecting a video as teacher should no longer auto-play audio.
- Play and Play From Start still explicitly play audio.
- Shift + mouse wheel was changed to lock to the selected video marker instead of falling through to move the turbine GLB.
- Ctrl + drag prioritizes video markers/previews before GLB movement.
- Restart Video now attempts to target the teacher-controlled Cessna part video instead of the old global chroma path.
- Green student video balls were made visible to students once the experience starts, without requiring Reveal Markers.
- Remote participant visibility was relaxed to show presence even if calibration state is not yet true.

Teacher navigation was adjusted:

- Shift + WASD is now faster: `DESKTOP_RUN_MULTIPLIER` changed from `1.8` to `3.6`.
- Right-mouse view drag in fallback/inspect mode now re-anchors the orbit pivot nearer to the current camera view.

## Current User Findings / Active Bugs

These are not resolved yet and should be first priority next session.

1. Teacher sees only the single controller used by the student.
   - Teacher does not see the student label.
   - Teacher does not see the HMD/headset GLB.
   - Student can see the teacher label, so presence is at least partially flowing.

2. Student does not see any videos.
   - Student sees the teacher label.
   - Student does not see the video balls.
   - Student does not see the Cessna video.
   - In Quest, no video is working from the student perspective.

## Likely Areas To Inspect First

Start with `src/scene/ExperienceScene.ts`.

For participant label/HMD:

- `setParticipants(...)`
- `updateRemoteParticipant(...)`
- `createRemoteParticipantVisual(...)`
- `loadParticipantHeadsetTemplate(...)`
- `applyPresenceJoint(...)`
- `applyPresenceToController(...)`
- render ordering / scale / position of `visual.label` and `visual.headAnchor`

Potential suspicion:

- Controller meshes are added directly to `visual.root`, while label/head are under `headAnchor`.
- If head presence is wrong, hidden, zero-scaled, inside the floor, or overwritten by headset model transform, the controller could still appear while label/HMD do not.
- The label uses `createObjectStateLabel(...)`; confirm material/depth/renderOrder makes it visible in VR and fallback.

For student video visibility:

- `shouldShowPartMarker(...)`
- `handlePartMarkerSelected(...)`
- `showPartVideoBillboard(...)`
- `applyVideoPrepState(...)`
- `setVideoPrepStates(...)`
- `setPartMarkerStates(...)`
- `ClassroomApp.applySharedState(...)`
- `server/index.ts` handling of `set-video-prep-state`

Potential suspicion:

- Student devices may receive empty `videoPrepStates` unless teacher has explicitly selected/synced each video after session creation.
- `setPartMarkerStates(...)` may be overwriting marker visibility from socket state after `setVideoPrepStates(...)`.
- Cessna is `videoActivationMode: "teacher"`, and `shouldShowPartMarker(...)` currently only exposes teacher-mode markers to teachers. That is fine for markers, but the actual Cessna video billboard must be shown from the shared teacher command path on students.
- `showPartVideoBillboard(...)` may be creating a video but autoplay could fail on Quest unless the student action is a direct controller click/tap. For the teacher-triggered Cessna, consider muted autoplay or a visible student-start affordance if Quest blocks playback.

## Important Current Video Intent

Cessna:

- Teacher-controlled video.
- Teacher can prep privately.
- Teacher command should show/play it to students.
- Hide should only hide the selected Cessna video when Cessna is selected, not a blue-ball student video.

Boeing and Turbofan:

- Student-triggered blue-ball videos.
- Teacher can select each blue ball and prep size/height/chroma independently.
- Green means visible/armed for students.
- Orange means teacher-only prep.
- Red means hidden/recovery.

## Suggested Next Prompt

```text
Continue IOL_Cessna_Demo from HANDOVER_NEXT_SESSION.md. First inspect git status and current ExperienceScene participant/video paths. Fix two active Quest bugs: teacher only sees student controller but not label/HMD, and student sees no video balls/Cessna video. Preserve the current per-video prep state work and keep npm run build passing. Restart npm run dev:all and give Quest URLs after fixes.
```
