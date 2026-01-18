// lib/types.ts
export interface RoomPayload {
  status: string;
  message: string;
  patient_id: string;
  room_id: string;
  patient_token: string;
  livekit_url: string;
  patient_meet_url: string;
  urgency: string;
  mongodb_updated: boolean;
}
