"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Room, RoomEvent } from "livekit-client";
import { RoomAudioRenderer, RoomContext } from "@livekit/components-react";
import { SessionView } from "@/components/session-view";

export default function PatientJoinPage() {
  const search = useSearchParams();
  const room = useMemo(() => new Room(), []);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const token = search.get("token") || "";
  const liveKitUrl = search.get("livekitUrl") || search.get("liveKitUrl") || "";
  const patientId = search.get("patientId") || "patient";

  useEffect(() => {
    let aborted = false;
    const run = async () => {
      if (!token || !liveKitUrl) {
        setError("Missing token or LiveKit URL");
        return;
      }
      setConnecting(true);
      setError(null);
      try {
        await room.connect(liveKitUrl, token);
        await Promise.all([
          room.localParticipant.setCameraEnabled(true),
          room.localParticipant.setMicrophoneEnabled(true),
        ]);
        if (!aborted) setConnected(true);
      } catch (err) {
        if (!aborted) setError(err instanceof Error ? err.message : "Failed to join");
      } finally {
        if (!aborted) setConnecting(false);
      }
    };

    run();

    const onDisconnect = () => setConnected(false);
    room.on(RoomEvent.Disconnected, onDisconnect);
    return () => {
      aborted = true;
      room.off(RoomEvent.Disconnected, onDisconnect);
      room.disconnect();
    };
  }, [room, token, liveKitUrl]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-4">
        <div>
          <p className="text-sm text-slate-400">Patient Join</p>
          <h1 className="text-2xl font-bold">Room Access</h1>
          <p className="text-sm text-slate-400">Patient ID: {patientId}</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        )}
        {connecting && <div className="text-sm text-slate-300">Connecting...</div>}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4">
          {connected ? (
            <RoomContext.Provider value={room}>
              <RoomAudioRenderer />
              <SessionView patientId={patientId} onDisconnect={() => setConnected(false)} />
            </RoomContext.Provider>
          ) : (
            <p className="text-slate-400 text-sm">Waiting to join the room...</p>
          )}
        </div>
      </div>
    </div>
  );
}
