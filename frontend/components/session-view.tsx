'use client';

import { useRoomContext, useVoiceAssistant } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useEffect, useState } from 'react';

interface SessionViewProps {
  patientId: string;
  onDisconnect: () => void;
}

export function SessionView({ patientId, onDisconnect }: SessionViewProps) {
  const room = useRoomContext();
  const { state: agentState } = useVoiceAssistant();
  const [participants, setParticipants] = useState(0);

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
      {/* Header */}
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="max-w-2xl w-full">
          {/* Agent Status Card */}
          <div className="rounded-2xl bg-slate-800/50 backdrop-blur border border-slate-700 p-8 mb-8">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <div
                  className={`h-20 w-20 rounded-full ${status.color} ${
                    status.animate ? 'animate-pulse' : ''
                  }`}
                ></div>
                <div className="absolute inset-0 rounded-full border-4 border-slate-600/30"></div>
              </div>
            </div>

            <div className="text-center">
              <h2 className="text-xl font-semibold text-white">
                Medical AI Agent
              </h2>
              <p className="mt-2 text-lg font-medium text-slate-300">
                {status.text}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {participants} participant{participants !== 1 ? 's' : ''} in room
              </p>
            </div>
          </div>

          {/* Info Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-slate-800/30 border border-slate-700 p-4">
              <p className="text-xs font-semibold uppercase text-slate-400">
                Status
              </p>
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
              <p className="text-xs font-semibold uppercase text-slate-400">
                Duration
              </p>
              <p className="mt-2 text-lg font-semibold text-white">
                {formatDuration(room.state === 'connected' ? Date.now() : 0)}
              </p>
            </div>

            <div className="rounded-lg bg-slate-800/30 border border-slate-700 p-4">
              <p className="text-xs font-semibold uppercase text-slate-400">
                Connection
              </p>
              <p className="mt-2 text-lg font-semibold text-green-400">
                Connected
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
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
