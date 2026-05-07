# Architecture

## Goals

The MVP creates a maintainable foundation for teacher-led classroom WebXR sessions without locking the project into Unity, a heavy UI framework, or a single hardcoded 3D object.

## Client modules

- `src/app/ClassroomApp.ts` owns the app shell, experience selection, role flow, teacher controls, student marker panels, and basic state rendering.
- `src/scene/ExperienceScene.ts` owns Three.js rendering, WebXR buttons, GLB loading, markers, shell visibility, intro video billboard playback, and fallback placeholder geometry.
- `src/scene/capabilities.ts` detects AR and VR support with `navigator.xr.isSessionSupported`.
- `src/experiences/` contains reusable experience configuration.
- `src/net/ClassroomSocket.ts` wraps WebSocket communication and keeps UI code away from protocol details.
- `src/net/protocol.ts` defines shared client/server message contracts.

## Backend

`server/index.ts` is an in-memory WebSocket session server. It supports:

- Teacher-created 4-character session codes.
- Student joins by code.
- Connected and calibrated participant state.
- Teacher-only shared commands.

This is intentionally lightweight. Production work should add persistence only if sessions need recovery, and real identity only if school deployment requires it.

## Calibration model

Each browser stores its own local XR pose when the user presses Calibrate. The MVP uses this as the classroom origin contract and syncs calibrated status to the teacher. Future shared anchors can replace or augment this without changing the experience config contract.

## Experience config

An experience declares model, environment, parts, intro videos, and assessment URL. Core app logic should stay generic so new experiences can be added by creating another config and asset folder.

## Future extension points

- Shared anchors: add anchor IDs or cloud anchor metadata to session state.
- APK export: wrap the web build with PWA/TWA/Capacitor after WebXR behavior is validated.
- AI expert character: add an experience-level character config and a separate service boundary for LLM calls.
- ElevenLabs voice: add generated audio/video assets or a streaming audio service behind explicit teacher/student interactions.
- Per-student intro videos: use the `introVideos` map with participant IDs or group IDs.
