"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Room, RoomEvent } from "livekit-client";
import { RoomAudioRenderer, RoomContext } from "@livekit/components-react";
import { SessionView } from "@/components/session-view";

interface PatientRecord {
  patient_id: string;
  name?: string;
  location?: string;
  condition?: string;
  urgency?: string;
  timestamp?: string;
  input?: {
    text?: string;
    has_image?: boolean;
    image_storage?: {
      url?: string;
      cdn_url?: string;
    };
    is_conversation?: boolean;
    qa_pairs_count?: number;
  };
  output?: {
    response?: string;
    urgency?: string;
    confidence?: number;
  };
  council_votes?: Record<string, { urgency?: string; confidence?: number; model?: string }>;
  evaluations?: Record<string, unknown>;
  [key: string]: unknown;
}

interface JoinInfo {
  doctor_token: string;
  livekit_url: string;
  patient_link: string;
  room_id: string;
}

export default function PatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const router = useRouter();
  const room = useMemo(() => new Room(), []);
  const doctorId = "DOCTOR_001";

  const [patientId, setPatientId] = useState<string>("");
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [joinInfo, setJoinInfo] = useState<JoinInfo | null>(null);

  // Unwrap params promise
  useEffect(() => {
    params.then(({ patientId }) => setPatientId(patientId));
  }, [params]);

  useEffect(() => {
    if (!patientId) return;
    
    const fetchPatient = async () => {
      setLoading(true);
      setError(null);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://urchin-app-uibbb.ondigitalocean.app";
        const res = await fetch(`${baseUrl}/patient/${patientId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load patient (status ${res.status})`);
        const data = await res.json();
        setPatient(data.patient);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load patient");
      } finally {
        setLoading(false);
      }
    };

    fetchPatient();
  }, [patientId]);

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

  useEffect(() => {
    let aborted = false;
    if (sessionStarted && room.state === "disconnected" && joinInfo) {
      const connectDoctor = async () => {
        setJoining(true);
        setError(null);
        try {
          await room.connect(joinInfo.livekit_url, joinInfo.doctor_token);
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
  }, [sessionStarted, room, joinInfo]);

  const handleJoin = async () => {
    if (!patient) return;
    setError(null);
    setJoining(true);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://urchin-app-uibbb.ondigitalocean.app";

      const patientRes = await fetch(`${baseUrl}/get-token?patient_id=${patient.patient_id}`, { method: "POST" });
      if (!patientRes.ok) throw new Error(`Failed to get patient token (status ${patientRes.status})`);
      const patientData = await patientRes.json();

      const doctorRes = await fetch(`${baseUrl}/doctor/${doctorId}/join-patient/${patient.patient_id}`, {
        method: "POST",
      });
      if (!doctorRes.ok) throw new Error(`Failed to get doctor token (status ${doctorRes.status})`);
      const doctorData = await doctorRes.json();

      const frontendUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
      const patientLink = `${frontendUrl}/patient-join?token=${encodeURIComponent(patientData.patient_token)}&roomId=${encodeURIComponent(
        patientData.room_id
      )}&patientId=${encodeURIComponent(patient.patient_id)}&livekitUrl=${encodeURIComponent(patientData.livekit_url)}`;

      setJoinInfo({
        doctor_token: doctorData.doctor_token,
        livekit_url: doctorData.livekit_url,
        patient_link: patientLink,
        room_id: doctorData.room_id,
      });
      setSessionStarted(true);

      // Open patient link to auto-join the patient side.
      window.open(patientLink, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join session");
      setSessionStarted(false);
    } finally {
      setJoining(false);
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return "--";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const imageUrl = patient?.input?.image_storage?.cdn_url || patient?.input?.image_storage?.url;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400">Patient Detail</p>
            <h1 className="text-2xl font-bold">{patient?.name || patient?.patient_id || patientId}</h1>
            <p className="text-sm text-slate-400">ID: {patient?.patient_id || patientId}</p>
            {patient?.location && <p className="text-sm text-slate-300">Location: {patient.location}</p>}
            {patient?.urgency && <p className="text-sm text-slate-300">Urgency: {patient.urgency}</p>}
            {patient?.timestamp && <p className="text-xs text-slate-500">Timestamp: {formatDate(patient.timestamp)}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            >
              Back
            </button>
            <button
              disabled={joining}
              onClick={handleJoin}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
            >
              {joining ? "Joining..." : "Join Call (doctor + patient)"}
            </button>
            {joinInfo?.patient_link && (
              <button
                onClick={() => navigator.clipboard.writeText(joinInfo.patient_link)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                Copy Patient Link
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4 space-y-3">
            <h2 className="text-lg font-semibold">Clinical Summary</h2>
            <p className="text-sm text-slate-300">Condition: {patient?.condition || "--"}</p>
            <p className="text-sm text-slate-300">Urgency: {patient?.urgency || "--"}</p>
            <p className="text-sm text-slate-300">Conversation: {patient?.input?.is_conversation ? "Yes" : "No"}</p>
            <p className="text-sm text-slate-300">Q/A Pairs: {patient?.input?.qa_pairs_count ?? "--"}</p>
            {patient?.output?.urgency && (
              <p className="text-sm text-slate-300">Model Urgency: {patient.output.urgency}</p>
            )}
            {patient?.output?.confidence !== undefined && (
              <p className="text-sm text-slate-300">Confidence: {patient.output.confidence}</p>
            )}
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Patient Narrative</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                {patient?.input?.text || "No conversation recorded."}
              </pre>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Model Response</p>
              <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                {patient?.output?.response || "No response available."}
              </div>
            </div>
            {imageUrl && (
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Attached Image</p>
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60">
                  {/* Image is user-provided; displayed as-is. */}
                  <img src={imageUrl} alt="Patient attachment" className="w-full max-h-[360px] object-contain" />
                </div>
              </div>
            )}
          </div>
        </div>

        {patient?.council_votes && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4">
            <h2 className="text-lg font-semibold mb-3">Council Votes</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(patient.council_votes).map(([model, vote]) => (
                <div key={model} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-sm font-semibold text-white">{model}</p>
                  <p className="text-sm text-slate-300">Urgency: {vote.urgency || "--"}</p>
                  <p className="text-sm text-slate-300">Confidence: {vote.confidence ?? "--"}</p>
                  <p className="text-xs text-slate-500">Model: {vote.model || "--"}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4">
          {sessionStarted ? (
            <RoomContext.Provider value={room}>
              <RoomAudioRenderer />
              <SessionView patientId={patient?.patient_id || patientId} onDisconnect={() => setSessionStarted(false)} />
            </RoomContext.Provider>
          ) : (
            <p className="text-slate-400 text-sm">Click "Join Call" to start the session and auto-join patient + doctor.</p>
          )}
        </div>
      </div>
    </div>
  );
}
