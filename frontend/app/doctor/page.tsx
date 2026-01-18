"use client";

import { useEffect, useMemo, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import { RoomAudioRenderer, RoomContext } from "@livekit/components-react";
import { SessionView } from "@/components/session-view";

interface PatientSummary {
  patient_id: string;
  name?: string;
  condition?: string;
  urgency?: string;
  updated_at?: string;
}

export default function DoctorDashboard() {
  const room = useMemo(() => new Room(), []);
  const doctorId = "DOCTOR_001";

  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selected, setSelected] = useState<PatientSummary | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [joining, setJoining] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch patient list on load
  useEffect(() => {
    const fetchPatients = async () => {
      setLoadingList(true);
      setError(null);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${baseUrl}/patients`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Failed to load patients (status ${res.status})`);
        const data = await res.json();
        setPatients(data.patients || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load patients");
      } finally {
        setLoadingList(false);
      }
    };

    fetchPatients();
  }, []);

  // Reset session state on disconnect
  useEffect(() => {
    const onDisconnected = () => {
      setSessionStarted(false);
      setJoining(false);
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  // Connect when session started
  useEffect(() => {
    let aborted = false;
    if (sessionStarted && room.state === "disconnected" && selected) {
      const connectDoctor = async () => {
        setJoining(true);
        setError(null);
        try {
          const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
          const res = await fetch(
            `${baseUrl}/get-doctor-token?patient_id=${selected.patient_id}&doctor_id=${doctorId}`,
            { method: "POST" }
          );
          if (!res.ok) throw new Error("Failed to get doctor token");
          const data = await res.json();

          await room.connect(data.livekit_url, data.doctor_token);
          await Promise.all([
            room.localParticipant.setCameraEnabled(true),
            room.localParticipant.setMicrophoneEnabled(true),
          ]);
        } catch (err) {
          if (!aborted) {
            setError(err instanceof Error ? err.message : "Failed to join session");
            setSessionStarted(false);
          }
        } finally {
          if (!aborted) setJoining(false);
        }
      };
      connectDoctor();
    }

    return () => {
      aborted = true;
    };
  }, [sessionStarted, room, selected]);

  const handleJoin = (patient: PatientSummary) => {
    setSelected(patient);
    setSessionStarted(true);
  };

  const formatDate = (value?: string) => {
    if (!value) return "--";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-sm text-slate-400">Doctor Dashboard</p>
            <h1 className="text-2xl font-bold">Patients</h1>
          </div>
          <button
            onClick={() => {
              room.disconnect();
              setSessionStarted(false);
            }}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 border border-slate-700 hover:bg-slate-700"
          >
            Disconnect
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Patient list */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-slate-300">Patient Queue</p>
              {loadingList && <span className="text-xs text-slate-500">Loading...</span>}
            </div>
            <div className="space-y-2">
              {patients.map((p) => {
                const isSelected = selected?.patient_id === p.patient_id;
                return (
                  <button
                    key={p.patient_id}
                    onClick={() => setSelected(p)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition hover:border-slate-600 hover:bg-slate-800 ${
                      isSelected ? "border-blue-500 bg-slate-800" : "border-slate-800 bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-100">{p.name || p.patient_id}</p>
                        <p className="text-xs text-slate-400">ID: {p.patient_id}</p>
                      </div>
                      <span className="text-xs rounded-full px-2 py-1 bg-slate-800 border border-slate-700">
                        {p.urgency || "NORMAL"}
                      </span>
                    </div>
                    {p.condition && <p className="mt-1 text-sm text-slate-300">{p.condition}</p>}
                    <p className="mt-1 text-xs text-slate-500">Updated: {formatDate(p.updated_at)}</p>
                  </button>
                );
              })}

              {!loadingList && patients.length === 0 && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-sm text-slate-300">
                  No patients yet. If this seems wrong, ensure the backend is running and that
                  NEXT_PUBLIC_API_URL points to it (current: {process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}).
                </div>
              )}
            </div>
          </div>

          {/* Detail + join */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-6">
            {!selected && <p className="text-slate-400">Select a patient to view details.</p>}

            {selected && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-400">Selected Patient</p>
                    <h2 className="text-xl font-semibold text-white">{selected.name || selected.patient_id}</h2>
                    <p className="text-sm text-slate-300">ID: {selected.patient_id}</p>
                    <p className="text-sm text-slate-300">Condition: {selected.condition || "--"}</p>
                    <p className="text-sm text-slate-300">Urgency: {selected.urgency || "NORMAL"}</p>
                    <p className="text-xs text-slate-500">Updated: {formatDate(selected.updated_at)}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      disabled={joining}
                      onClick={() => handleJoin(selected)}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
                    >
                      {joining ? "Joining..." : "Join Session"}
                    </button>
                    <button
                      onClick={() => {
                        room.disconnect();
                        setSessionStarted(false);
                      }}
                      className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                    >
                      End Session
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  {sessionStarted ? (
                    <RoomContext.Provider value={room}>
                      <RoomAudioRenderer />
                      <SessionView patientId={selected.patient_id} onDisconnect={() => setSessionStarted(false)} />
                    </RoomContext.Provider>
                  ) : (
                    <p className="text-slate-400 text-sm">Join the session to view live video.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
