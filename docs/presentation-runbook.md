# Presentation Runbook

Target date: Wednesday, May 13, 2026.

Setup: one Mac host, five Meta Quest headsets, and one separate classroom router.

## Goal

Run one teacher-led IOL Cessna Demo session from the Mac and let five Quests join through Quest Browser on the same router network.

## Critical Risk

Immersive WebXR on Quest Browser requires a secure context. The app is served over HTTPS in development, but local development certificates can still be rejected or treated as untrusted by a headset.

Do not discover the HTTPS behavior for the first time during the presentation. Test with at least one Quest on the presentation router before Wednesday.

## Preferred Demo Path

1. Connect the Mac and all Quests to the separate router.
2. Give the Mac a stable IP address on that router, either through a router DHCP reservation or by writing down the IP Vite prints.
3. Start the app on the Mac:

```bash
nvm use
npm install
npm run dev:all
```

4. Use the `https://<mac-ip>:5173/` Network URL printed by Vite on every Quest.
5. On the Mac, open the same URL as Teacher.
6. On the Quests, open the same URL as Students.
7. Teacher creates a session code.
8. Students join with that code.
9. All devices press Calibrate at the same classroom zero spot.
10. Teacher starts the shared experience and drives the lesson controls.

## HTTPS Decision Tree

Use this order when testing:

1. Try the Vite HTTPS Network URL on one Quest.
2. If Quest Browser shows a certificate warning, accept it and confirm the AR/VR buttons still appear and start.
3. If immersive WebXR is unavailable after accepting the warning, switch to a trusted HTTPS option before Wednesday.
4. If trusted HTTPS cannot be ready in time, use fallback mode as the backup demo and present the shared classroom sync, markers, and videos without immersive XR.

Trusted HTTPS options:

- Use an internet-connected router and a tunnel with a public HTTPS URL.
- Use a real domain and a valid certificate that points to the Mac for the demo network.
- Use a pre-tested local certificate approach only if the Quest accepts it and WebXR remains available.

## Router Checklist

- Router SSID and password are known and written down.
- Mac and all Quests can join the router.
- Client isolation is disabled, so Quests can reach the Mac.
- The Mac firewall allows incoming connections for Node/Vite.
- The Mac IP on the router is stable for the session.
- The room has power for the Mac and router.

## Device Checklist

- Charge all five Quests.
- Update Quest Browser only before the rehearsal, not right before the presentation.
- Open the demo URL on each Quest during rehearsal.
- Confirm each Quest can join a session.
- Confirm video playback starts from student and teacher activators.
- Confirm the calibration spot is physically marked in the room.

## Mac Checklist

- Use Node 20 through `.nvmrc`.
- Run `npm run build` before leaving for the presentation.
- Run `npm run dev:all` for the live demo.
- Run `npm run dev:codex:all` only when debugging in the Codex in-app browser.
- Keep the terminal visible enough to read the Vite Network URL.
- Keep automatic sleep disabled during the presentation.
- Close heavy apps before running the demo.

## Rehearsal Script

1. Start the router.
2. Connect Mac and one Quest.
3. Start `npm run dev:all`.
4. Open the Vite Network URL on Mac and Quest.
5. Create a teacher session on Mac.
6. Join as student on Quest.
7. Calibrate both devices at the same physical zero spot.
8. Start the experience.
9. Toggle markers.
10. Trigger the Cessna, turbofan, and Boeing videos.
11. Repeat with all five Quests connected.

## Presentation Backup

If Quest WebXR fails, keep the demo moving:

1. Use fallback mode in Quest Browser or on the Mac.
2. Show teacher session creation and student joining.
3. Demonstrate synchronized marker reveal and video controls.
4. Explain that immersive mode is blocked by trusted HTTPS on the event network, not by the classroom sync app.

## Known Follow-Ups

- Replace the placeholder assessment URL with the final Microsoft Forms link.
- Decide whether the presentation needs the Cessna model or the current turbofan teaching prop.
- Consider a production HTTPS deployment path after the prototype presentation.
