# Frontend/Backend Changes and Communication

## Backend Endpoints
- POST /get-doctor-token: Issues a doctor LiveKit token for `hackathon_{patient_id}` without MongoDB dependency; returns doctor_token, room_id, livekit_url.
- GET /patient/{patient_id}: Now un-nested and reachable; falls back to mock data if MongoDB errors.

## Frontend Updates
- Doctor join flow calls `/get-doctor-token`, connects to LiveKit, then enables camera and mic to publish media.
- Session view subscribes to camera/screen tracks and renders participant tiles; stable keys to avoid React warnings; refreshed layout (status card + video grid + invite doctor).

## Communication Flow
1) Frontend sends POST to `/get-doctor-token` with patient_id and doctor_id.
2) Backend returns doctor_token and livekit_url.
3) Frontend calls `room.connect(livekit_url, doctor_token)`, then publishes camera/mic and renders tiles from active tracks.
4) Invite button also calls `/get-doctor-token` and copies a join link containing token/room details.

## File Pointers
- Backend endpoints: main.py
- Frontend join logic: frontend/app/page.tsx
- Session UI: frontend/components/session-view.tsx
