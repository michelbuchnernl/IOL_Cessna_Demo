# Tomorrow Notes - 2026-05-10

## Classroom Sync Follow-Up

- Student has a visible object representation, and the teacher can see the head moving.
- When the student moves, gyro/head rotation keeps updating, but student position is not updating.
- Teacher is not visible to the student.
- Teacher can move the blue video balls, but students do not see an effective result from that placement.
- Student still gets no video when pressing a blue ball.

## Likely Areas To Inspect

- Participant presence position capture and transform conversion between `userRig`, XR camera, and `classroomRoot`.
- Remote participant fallback placement versus live position updates for monitor and VR clients.
- Session state sync for teacher-placed part marker positions.
- Student marker raycast/selection path and video panel opening after marker selection.
