'use client';

import { useEffect, useMemo, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { RoomAudioRenderer, RoomContext } from '@livekit/components-react';
import { JoinConfirmation } from '@/components/join-confirmation';
import { SessionView } from '@/components/session-view';

interface RoomPayload {
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

interface PageProps {
  searchParams: Promise<{ token?: string; roomId?: string; patientId?: string; likeKitUrl?: string }>;
}

export default function Page({ searchParams }: PageProps) {
  const room = useMemo(() => new Room(), []);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [roomPayload, setRoomPayload] = useState<RoomPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Parse room details from URL or get from backend
  useEffect(() => {
    const initializeRoom = async () => {
      try {
        const params = await searchParams;
        
        // If we have all necessary params from URL, use them
        if (params.token && params.roomId && params.patientId && params.likeKitUrl) {
          setRoomPayload({
            status: 'success',
            message: 'Room details loaded',
            patient_id: params.patientId,
            room_id: params.roomId,
            patient_token: params.token,
            livekit_url: params.likeKitUrl,
            patient_meet_url: '',
            urgency: 'NORMAL',
            mongodb_updated: false,
          });
        } else {
          // Try to get from localStorage (passed from backend)
          const stored = localStorage.getItem('roomPayload');
          if (stored) {
            setRoomPayload(JSON.parse(stored));
            localStorage.removeItem('roomPayload');
          } else {
            // Hackathon mode: Skip triage, go straight to join
            setRoomPayload({
              status: 'success',
              message: 'Ready to join',
              patient_id: 'HACK_' + Math.random().toString(36).slice(2, 7).toUpperCase(),
              room_id: 'hackathon_room',
              patient_token: 'temp_token', // Will be replaced on join
              livekit_url: process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://your-livekit-server',
              patient_meet_url: '',
              urgency: 'NORMAL',
              mongodb_updated: false,
            });
          }
        }
      } catch (err) {
        setError('Failed to initialize room');
        console.error(err);
      }
    };

    initializeRoom();
  }, [searchParams]);

  useEffect(() => {
    const onDisconnected = () => {
      setSessionStarted(false);
    };

    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  useEffect(() => {
    let aborted = false;

    if (sessionStarted && room.state === 'disconnected' && roomPayload) {
      const connectToRoom = async () => {
        try {
          let token = roomPayload.patient_token;
          
          // If using temp token, get a real one from backend
          if (token === 'temp_token') {
            const response = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/get-token?patient_id=${roomPayload.patient_id}`
            );
            if (!response.ok) throw new Error('Failed to get token');
            const data = await response.json();
            token = data.patient_token;
            roomPayload.livekit_url = data.livekit_url;
          }

          await Promise.all([
            room.localParticipant.setMicrophoneEnabled(true),
            room.connect(roomPayload.livekit_url, token),
          ]);
        } catch (error) {
          if (!aborted) {
            setError(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      };

      connectToRoom();
    }

    return () => {
      aborted = true;
      room.disconnect();
    };
  }, [room, sessionStarted, roomPayload]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-red-100 p-4">
        <div className="max-w-md rounded-lg bg-white p-8 shadow-lg">
          <h1 className="mb-4 text-2xl font-bold text-red-600">Error</h1>
          <p className="text-gray-700">{error}</p>
        </div>
      </div>
    );
  }

  if (!roomPayload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-300 border-t-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <RoomContext.Provider value={room}>
      <RoomAudioRenderer />
      
      {!sessionStarted && (
        <JoinConfirmation
          patientId={roomPayload.patient_id}
          urgency={roomPayload.urgency}
          onConfirm={() => setSessionStarted(true)}
        />
      )}

      {sessionStarted && (
        <SessionView
          patientId={roomPayload.patient_id}
          onDisconnect={() => setSessionStarted(false)}
        />
      )}
    </RoomContext.Provider>
  );
}
