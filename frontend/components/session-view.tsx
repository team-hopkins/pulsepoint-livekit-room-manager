'use client';

import { ParticipantTile, useRoomContext, useTracks, useVoiceAssistant } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { useEffect, useState } from 'react';

interface SessionViewProps {
  patientId: string;
  onDisconnect: () => void;
}

export function SessionView({ patientId, onDisconnect }: SessionViewProps) {
  const room = useRoomContext();
  const { state: agentState } = useVoiceAssistant();
  const [participants, setParticipants] = useState(0);
  const [doctorJoined, setDoctorJoined] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: true },
    ],
    { onlySubscribed: false }
  ) || [];

  useEffect(() => {
    const handleParticipantsChange = () => {
      if (room?.participants) {
        setParticipants(room.participants.size);
      }
    };

    room.on(RoomEvent.ParticipantsChanged, handleParticipantsChange);
    handleParticipantsChange();

    return () => {
      room.off(RoomEvent.ParticipantsChanged, handleParticipantsChange);
    };
  }, [room]);

  const inviteDoctor = async () => {
    try {
      setDoctorError(null);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'https://urchin-app-uibbb.ondigitalocean.app'}/get-doctor-token?patient_id=${patientId}&doctor_id=DOCTOR_001`,
        { method: 'POST' }
      );
      if (!response.ok) throw new Error('Failed to get doctor token');

      const data = await response.json();

      const inviteUrl = `${window.location.origin}?token=${data.doctor_token}&roomId=${data.room_id}&patientId=${patientId}&likeKitUrl=${data.livekit_url}`;
      setInviteLink(inviteUrl);

      await navigator.clipboard.writeText(inviteUrl);
      setDoctorJoined(true);
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : 'Failed to invite doctor');
    }
  };

  const getAgentStatus = () => {
    switch (agentState) {
      case 'listening':
        return { text: 'Listening...', color: 'bg-green-500', animate: false };
      case 'thinking':
        return { text: 'Processing...', color: 'bg-blue-500', animate: true };
      case 'speaking':
        return { text: 'Speaking...', color: 'bg-purple-500', animate: false };
      case 'connecting':
        return { text: 'Connecting...', color: 'bg-yellow-500', animate: true };
      default:
        return { text: 'Idle', color: 'bg-gray-500', animate: false };
    }
  };

  const status = getAgentStatus();

  return (
    <div className="fixed inset-0 flex flex-col bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="border-b border-slate-700 bg-slate-900/50 px-8 py-6 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Patient Consultation</h1>
            <p className="mt-1 text-sm text-slate-400">Patient ID: {patientId}</p>
          </div>
          <button
            onClick={() => {
              room.disconnect();
              onDisconnect();
            }}
            className="rounded-lg bg-red-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-red-700"
          >
            End Session
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-6xl">
          <div className="grid gap-6 lg:grid-cols-3 items-start">
            <div className="rounded-2xl bg-slate-800/50 backdrop-blur border border-slate-700 p-8">
              <div className="flex flex-col items-center">
                <div className="relative mb-4">
                  <div
                    className={`h-20 w-20 rounded-full ${status.color} ${status.animate ? 'animate-pulse' : ''
                      }`}
                  ></div>
                  <div className="absolute inset-0 rounded-full border-4 border-slate-600/30"></div>
                </div>
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-semibold text-white">Medical AI Agent</h2>
                  <p className="text-lg font-medium text-slate-300">{status.text}</p>
                  <p className="text-sm text-slate-400">
                    {participants} participant{participants !== 1 ? 's' : ''} in room
                  </p>
                </div>

                <button
                  onClick={inviteDoctor}
                  disabled={doctorJoined}
                  className={`mt-6 w-full rounded-lg px-4 py-2 font-semibold text-white transition-colors ${doctorJoined
                    ? 'bg-green-600 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                >
                  {doctorJoined ? '✓ Link Copied' : 'Invite Doctor'}
                </button>

                {doctorError && (
                  <p className="mt-2 text-xs text-red-400">{doctorError}</p>
                )}

                {inviteLink && (
                  <div className="mt-4 w-full">
                    <p className="text-xs text-slate-400 mb-2">Share this link:</p>
                    <div className="bg-slate-900/50 border border-slate-700 rounded p-2 text-xs text-slate-300 break-all">
                      {inviteLink}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-2 rounded-2xl bg-slate-800/50 backdrop-blur border border-slate-700 p-4 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Live Video</p>
                  <p className="text-sm text-slate-300">Camera and screen share tiles</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3 min-h-[280px] flex flex-wrap gap-3 justify-start">
                {tracks && tracks.length > 0 ? (
                  tracks.map((trackRef, idx) => {
                    const key =
                      trackRef.publication?.trackSid ??
                      `${trackRef.participant?.sid || 'participant'}-${trackRef.source}-${idx}`;
                    return (
                      <div key={key} className="w-48 h-32 rounded-lg overflow-hidden bg-slate-800/80 border border-slate-700">
                        <ParticipantTile trackRef={trackRef} />
                      </div>
                    );
                  })
                ) : (
                  <p className="text-slate-400 text-sm">Waiting for participants...</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 mt-6">
            <div className="rounded-lg bg-slate-800/30 border border-slate-700 p-4">
              <p className="text-xs font-semibold uppercase text-slate-400">Status</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {agentState === 'speaking'
                  ? 'Agent Speaking'
                  : agentState === 'listening'
                    ? 'Listening'
                    : agentState === 'thinking'
                      ? 'Processing'
                      : 'Connected'}
              </p>
            </div>

            <div className="rounded-lg bg-slate-800/30 border border-slate-700 p-4">
              <p className="text-xs font-semibold uppercase text-slate-400">Duration</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {formatDuration(room.state === 'connected' ? Date.now() : 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-700 bg-slate-900/50 px-8 py-4 backdrop-blur">
        <div className="mx-auto max-w-5xl text-center text-xs text-slate-400">
          Session in progress - Keep your microphone enabled for best results
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}