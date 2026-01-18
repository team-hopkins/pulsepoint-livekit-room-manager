"use client";

import { useEffect, useMemo, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  useTracks,
  useLocalParticipant
} from "@livekit/components-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PatientSummary {
  patient_id: string;
  name?: string;
  condition?: string;
  urgency?: string;
  updated_at?: string;
  location?: string;
  output?: {
    response?: string;
    urgency?: string;
    confidence?: number;
  };
  input?: {
    text?: string;
    has_image?: boolean;
    image_storage?: {
      url?: string;
      cdn_url?: string;
    };
  };
  council_votes?: {
    gpt4?: { urgency?: string; confidence?: number; model?: string };
    claude?: { urgency?: string; confidence?: number; model?: string };
    gemini?: { urgency?: string; confidence?: number; model?: string };
  };
}

interface PatientDetails extends PatientSummary {
  timestamp?: string;
  processing_time?: number;
  trace_id?: string;
}

export default function DoctorDashboard() {
  const room = useMemo(() => new Room(), []);
  const doctorId = "DOCTOR_001";

  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selected, setSelected] = useState<PatientSummary | null>(null);
  const [patientDetails, setPatientDetails] = useState<PatientDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [joining, setJoining] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [recentTranscription, setRecentTranscription] = useState<string>("");

  // Fetch patient list
  useEffect(() => {
    const fetchPatients = async () => {
      setLoadingList(true);
      setError(null);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://urchin-app-uibbb.ondigitalocean.app";
        const res = await fetch(`${baseUrl}/patients`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Failed to load patients`);
        const data = await res.json();
        setPatients(data.patients || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load patients");
      } finally {
        setLoadingList(false);
      }
    };

    fetchPatients();
    const interval = setInterval(fetchPatients, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch detailed patient information when selected
  useEffect(() => {
    const fetchPatientDetails = async () => {
      if (!selected?.patient_id) {
        setPatientDetails(null);
        return;
      }

      setLoadingDetails(true);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://urchin-app-uibbb.ondigitalocean.app";
        const response = await fetch(`${baseUrl}/patient/${selected.patient_id}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        
        if (!response.ok) {
          // Fallback to using existing data if endpoint doesn't exist
          setPatientDetails(selected as PatientDetails);
          return;
        }
        const data = await response.json();
        // Handle the response structure { status, source, patient }
        setPatientDetails(data.patient || data);
      } catch (err: unknown) {
        console.error("Failed to fetch patient details:", err);
        // Fallback to existing data
        setPatientDetails(selected as PatientDetails);
      } finally {
        setLoadingDetails(false);
      }
    };

    fetchPatientDetails();
  }, [selected]);

  // Room event handlers for connection and AI agent data
  useEffect(() => {
    const onDisconnected = () => {
      setSessionStarted(false);
      setNotes("");
      setRecentTranscription("");
      setSelected(null);
    };

    const onDataReceived = (payload: Uint8Array, participant?: any) => {
      /**
       * Handle real-time data from AI agent
       * Expected format: JSON string with type and content
       * Types: "transcription", "notes", "diagnosis"
       */
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));

        console.log("📨 Received data from agent:", message);

        switch (message.type) {
          case "transcription":
            // Update recent transcription (live speech-to-text)
            setRecentTranscription(message.content);
            break;

          case "notes":
            // Update medical notes (accumulated SOAP notes)
            setNotes(message.content);
            break;

          case "diagnosis":
            // Handle diagnosis updates (could extend notes)
            setNotes(prev => `${prev}\n\n## Diagnosis\n${message.content}`);
            break;

          default:
            console.warn("Unknown message type:", message.type);
        }
      } catch (err) {
        console.error("Failed to parse agent data:", err);
      }
    };

    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.DataReceived, onDataReceived);

    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.DataReceived, onDataReceived);
      room.disconnect();
    };
  }, [room]);

  const parseMeetUrl = (meetUrl: string): { liveKitUrl: string; token: string } => {
    try {
      const url = new URL(meetUrl);
      const liveKitUrl = url.searchParams.get("liveKitUrl");
      const token = url.searchParams.get("token");

      if (!liveKitUrl || !token) {
        throw new Error("Missing liveKitUrl or token in meet URL");
      }

      return {
        liveKitUrl: decodeURIComponent(liveKitUrl),
        token: decodeURIComponent(token),
      };
    } catch (err) {
      throw new Error(`Failed to parse meet URL: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleJoinRoom = async (patient: PatientSummary) => {
    if (joining || sessionStarted) return;

    setJoining(true);
    setError(null);
    setSelected(patient);

    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://urchin-app-uibbb.ondigitalocean.app";
      const payload = {
        patient_id: patient.patient_id,
        doctor_id: doctorId,
      };

      console.log("🔍 Joining room with payload:", payload);
      console.log("🌐 API URL:", `${baseUrl}/doctor/join-room`);

      const res = await fetch(`${baseUrl}/doctor/join-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("📡 Response status:", res.status);
      const data = await res.json();
      console.log("📦 Response data:", data);

      if (!res.ok) {
        throw new Error(data.detail || `Failed to join room (${res.status})`);
      }

      // Parse the meet URL to extract connection parameters
      if (data.doctor_meet_url) {
        console.log("✅ Doctor meet URL received:", data.doctor_meet_url);
        const { liveKitUrl, token } = parseMeetUrl(data.doctor_meet_url);

        console.log("🔐 Extracted LiveKit URL:", liveKitUrl);
        console.log("🎫 Extracted token:", token.substring(0, 50) + "...");

        // Connect to LiveKit room with extracted credentials
        await room.connect(liveKitUrl, token);
        console.log("✅ Connected to LiveKit room successfully");

        // Enable microphone automatically for the AI agent to hear
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          console.log("🎤 Microphone enabled for transcription");
        } catch (micError) {
          console.warn("⚠️ Could not enable microphone:", micError);
        }

        setSessionStarted(true);
      } else if (data.livekit_url && data.doctor_token) {
        // Legacy format - connect directly
        console.log("📡 Using legacy connection format");
        await room.connect(data.livekit_url, data.doctor_token);

        // Enable microphone automatically
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          console.log("🎤 Microphone enabled for transcription");
        } catch (micError) {
          console.warn("⚠️ Could not enable microphone:", micError);
        }

        setSessionStarted(true);
      } else {
        throw new Error("Invalid response format from server");
      }
    } catch (err) {
      console.error("❌ Error joining room:", err);
      setError(err instanceof Error ? err.message : "Failed to join session");
      setSelected(null);
    } finally {
      setJoining(false);
    }
  };

  const handleEndSession = () => {
    room.disconnect();
  };

  const sendCommandToAgent = async (command: string, data?: any) => {
    try {
      const message = JSON.stringify({
        type: "command",
        command,
        data,
        timestamp: new Date().toISOString(),
      });

      const encoder = new TextEncoder();
      await room.localParticipant.publishData(encoder.encode(message), { reliable: true });

      console.log("📤 Sent command to agent:", command);
    } catch (err) {
      console.error("Failed to send command to agent:", err);
      setError("Failed to communicate with AI agent");
    }
  };

  const getUrgencyColor = (urgency?: string) => {
    switch (urgency?.toUpperCase()) {
      case "HIGH":
      case "CRITICAL":
        return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800";
      case "MEDIUM":
      case "MODERATE":
        return "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800";
      case "LOW":
        return "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-700";
    }
  };

  if (!sessionStarted) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Header */}
          <motion.header
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-widest text-blue-600 uppercase dark:text-blue-400">
                      Medical Platform
                    </p>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                      Doctor's Dashboard
                    </h1>
                  </div>
                </div>
                <p className="text-slate-600 dark:text-slate-400 ml-15">
                  Real-time consultations with AI-powered note-taking
                </p>
              </div>

              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white dark:bg-slate-800 shadow-md border border-slate-200 dark:border-slate-700">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Dr. {doctorId}
                </span>
              </div>
            </div>
          </motion.header>

          {/* Error Alert */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="font-semibold">Error</p>
                    <p className="text-sm">{error}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Patient Details View - Full Screen */}
          {selected && patientDetails ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-6xl mx-auto"
            >
              {/* Back Button */}
              <button
                onClick={() => setSelected(null)}
                className="mb-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="font-medium">Back to Patient List</span>
              </button>

              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 bg-gradient-to-r from-blue-50 to-slate-50 dark:from-slate-800 dark:to-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                        {patientDetails.name || `Patient ${patientDetails.patient_id}`}
                      </h3>
                      <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                        <span className="font-mono font-medium">ID: {patientDetails.patient_id}</span>
                        {patientDetails.location && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              {patientDetails.location}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={`px-4 py-2 rounded-xl border-2 ${getUrgencyColor(patientDetails.output?.urgency)} flex items-center gap-2`}>
                      <span className="w-2.5 h-2.5 rounded-full bg-current animate-pulse"></span>
                      <span className="font-bold text-lg">{patientDetails.output?.urgency || "Unknown"}</span>
                    </div>
                  </div>
                </div>

                {loadingDetails ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"></div>
                      <p className="text-slate-600 dark:text-slate-400">Loading patient details...</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                      {/* Left Column - Patient Image and Stats */}
                      <div className="space-y-6">
                        {/* Patient Image */}
                        {patientDetails.input?.has_image && patientDetails.input?.image_storage?.cdn_url && (
                          <div className="rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 shadow-lg">
                            <img
                              src={patientDetails.input.image_storage.cdn_url}
                              alt="Patient condition"
                              className="w-full h-auto object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                        )}

                        {/* Confidence Score */}
                        {patientDetails.output?.confidence && (
                          <div className="p-5 rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 border border-emerald-200 dark:border-emerald-800">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">AI Confidence</span>
                              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-300">
                              {(patientDetails.output.confidence * 100).toFixed(0)}%
                            </p>
                          </div>
                        )}

                        {/* Council Votes */}
                        {patientDetails.council_votes && (
                          <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                              </svg>
                              AI Council Votes
                            </h4>
                            <div className="space-y-3">
                              {patientDetails.council_votes.gpt4 && (
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800">
                                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{patientDetails.council_votes.gpt4.model || "GPT-4"}</span>
                                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${getUrgencyColor(patientDetails.council_votes.gpt4.urgency)}`}>
                                    {patientDetails.council_votes.gpt4.urgency}
                                  </span>
                                </div>
                              )}
                              {patientDetails.council_votes.claude && (
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800">
                                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{patientDetails.council_votes.claude.model || "Claude"}</span>
                                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${getUrgencyColor(patientDetails.council_votes.claude.urgency)}`}>
                                    {patientDetails.council_votes.claude.urgency}
                                  </span>
                                </div>
                              )}
                              {patientDetails.council_votes.gemini && (
                                <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800">
                                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{patientDetails.council_votes.gemini.model || "Gemini"}</span>
                                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${getUrgencyColor(patientDetails.council_votes.gemini.urgency)}`}>
                                    {patientDetails.council_votes.gemini.urgency}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right Column - AI Assessment and Input */}
                      <div className="lg:col-span-2 space-y-6">
                        {/* AI Response/Assessment */}
                        {patientDetails.output?.response && (
                          <div className="p-6 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 border-2 border-blue-200 dark:border-blue-800 shadow-lg">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-10 h-10 rounded-xl bg-blue-600 dark:bg-blue-500 flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </div>
                              <h4 className="text-lg font-bold text-slate-900 dark:text-white">AI Medical Assessment</h4>
                            </div>
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed text-base">
                                {patientDetails.output.response}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Patient Input */}
                        {patientDetails.input?.text && (
                          <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-md">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-10 h-10 rounded-xl bg-slate-600 dark:bg-slate-700 flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                </svg>
                              </div>
                              <h4 className="text-lg font-bold text-slate-900 dark:text-white">Patient Reported Symptoms</h4>
                            </div>
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed text-base">
                                {patientDetails.input.text}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Metadata */}
                        {patientDetails.timestamp && (
                          <div className="flex items-center gap-6 text-sm text-slate-500 dark:text-slate-400 pt-2">
                            <span className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Assessment: {new Date(patientDetails.timestamp).toLocaleString()}
                            </span>
                            {patientDetails.processing_time && (
                              <span className="flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                Processing: {patientDetails.processing_time.toFixed(2)}s
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-4 pt-6 border-t border-slate-200 dark:border-slate-700">
                      <button
                        onClick={() => handleJoinRoom(patientDetails)}
                        disabled={joining}
                        className="flex-1 py-4 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold text-lg shadow-xl hover:shadow-2xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                      >
                        {joining ? (
                          <>
                            <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Connecting to Patient...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>Start Consultation</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setSelected(null)}
                        className="px-6 py-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold transition-all duration-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            /* Patients Grid */
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence>
              {loadingList ? (
                <div className="col-span-full flex items-center justify-center py-16">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"></div>
                    <p className="text-slate-600 dark:text-slate-400">Loading patients...</p>
                  </div>
                </div>
              ) : patients.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="col-span-full text-center py-16 px-4"
                >
                  <div className="max-w-md mx-auto">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                      No Patients Yet
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400">
                      Patients will appear here once they complete triage assessment.
                    </p>
                  </div>
                </motion.div>
              ) : (
                patients.map((patient, idx) => (
                  <motion.div
                    key={patient.patient_id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => setSelected(patient)}
                    className={`group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border cursor-pointer transition-all duration-300 hover:-translate-y-1 ${
                      selected?.patient_id === patient.patient_id
                        ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-900"
                        : "border-slate-200 dark:border-slate-700 hover:shadow-xl"
                    }`}
                  >
                    {/* Urgency Badge */}
                    <div className="absolute top-4 right-4">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${getUrgencyColor(patient.output?.urgency)}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                        {patient.output?.urgency || "Unknown"}
                      </span>
                    </div>

                    {/* Patient Info */}
                    <div className="mb-4 pt-6">
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                        {patient.name || `Patient ${patient.patient_id}`}
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                        ID: <span className="font-mono font-medium">{patient.patient_id}</span>
                      </p>
                      {patient.output?.confidence && (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          Confidence: <span className="font-semibold">{(patient.output.confidence * 100).toFixed(0)}%</span>
                        </p>
                      )}
                    </div>

                    {/* Join Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleJoinRoom(patient);
                      }}
                      disabled={joining}
                      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group-hover:scale-[1.02]"
                    >
                      {joining && selected?.patient_id === patient.patient_id ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          <span>Join Consultation</span>
                        </>
                      )}
                    </button>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
            </div>
          )}
        </div>
      </main>
    );
  }

  // In-session view
  return (
    <RoomContext.Provider value={room}>
      <main className="h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
        <RoomAudioRenderer />

        {/* Header */}
        <header className="flex-shrink-0 px-6 py-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {selected?.name || `Patient ${selected?.patient_id}`}
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Live Consultation
                </p>
              </div>
            </div>

            <button
              onClick={handleEndSession}
              className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              End Session
            </button>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex gap-6 p-6 overflow-hidden">
          {/* Video Section */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <VideoSection room={room} />

            {/* AI Agent Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => sendCommandToAgent("request_diagnosis")}
                className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Request Diagnosis
              </button>

              <button
                onClick={() => sendCommandToAgent("generate_summary")}
                className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Generate Summary
              </button>
            </div>
          </div>

          {/* Notes Section */}
          <div className="w-96 flex flex-col gap-4">
            <NotesPanel notes={notes} recentTranscription={recentTranscription} />
          </div>
        </div>
      </main>
    </RoomContext.Provider>
  );
}

// Video Section Component
function VideoSection({ room }: { room: Room }) {
  const tracks = useTracks([Track.Source.Camera], { room });
  const { isMicrophoneEnabled, isCameraEnabled, localParticipant } = useLocalParticipant();

  const toggleMicrophone = async () => {
    await room.localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const toggleCamera = async () => {
    await room.localParticipant.setCameraEnabled(!isCameraEnabled);
  };

  // Separate local (doctor) and remote (patient) video tracks
  const localTracks = tracks.filter(track => track.participant.sid === localParticipant?.sid);
  const remoteTracks = tracks.filter(track => track.participant.sid !== localParticipant?.sid);

  return (
    <div className="flex-1 rounded-2xl overflow-hidden bg-slate-900 shadow-2xl border border-slate-700 relative flex flex-col gap-3 p-3">
      {remoteTracks.length > 0 || localTracks.length > 0 ? (
        <>
          {/* Remote Participant (Patient) - Main View */}
          <div className="flex-1 rounded-xl overflow-hidden bg-slate-800 relative min-h-0">
            {remoteTracks.length > 0 ? (
              <>
                <VideoTrack
                  trackRef={remoteTracks[0]}
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-sm text-white text-sm font-medium">
                  Patient: {remoteTracks[0].participant.identity}
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-700 flex items-center justify-center">
                    <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <p className="text-slate-400 text-sm font-medium">Waiting for patient video...</p>
                </div>
              </div>
            )}
          </div>

          {/* Local Participant (Doctor) - Picture-in-Picture */}
          {localTracks.length > 0 && (
            <div className="absolute bottom-20 right-6 w-64 h-48 rounded-xl overflow-hidden bg-slate-800 shadow-2xl border-2 border-slate-600 z-10">
              <VideoTrack
                trackRef={localTracks[0]}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-white text-xs font-semibold">
                You (Doctor)
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center">
            <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
              <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-slate-400 font-medium text-lg">Waiting for video streams...</p>
            <p className="text-slate-500 text-sm mt-2">Enable your camera to start</p>
          </div>
        </div>
      )}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-full px-4 py-3 shadow-2xl border border-slate-200 dark:border-slate-700">
          <button
            onClick={toggleMicrophone}
            className={`p-3 rounded-full transition-all duration-200 ${isMicrophoneEnabled
              ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              : "bg-red-500 text-white hover:bg-red-600"
              }`}
            title={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
          >
            {isMicrophoneEnabled ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>

          <button
            onClick={toggleCamera}
            className={`p-3 rounded-full transition-all duration-200 ${isCameraEnabled
              ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              : "bg-red-500 text-white hover:bg-red-600"
              }`}
            title={isCameraEnabled ? "Turn off camera" : "Turn on camera"}
          >
            {isCameraEnabled ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Notes Panel Component
function NotesPanel({ notes, recentTranscription }: { notes: string; recentTranscription: string }) {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Track when content updates
  useEffect(() => {
    if (notes || recentTranscription) {
      setLastUpdate(new Date());
    }
  }, [notes, recentTranscription]);

  return (
    <>
      {/* Recent Transcription */}
      <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
            Live Transcription
          </h3>
          <span className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            {recentTranscription ? (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <span>Live</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                <span>Standing by</span>
              </>
            )}
          </span>
        </div>
        <div className="min-h-[120px] max-h-[180px] overflow-y-auto">
          {recentTranscription ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {recentTranscription}
              </p>
              {lastUpdate && (
                <p className="text-xs text-slate-400 italic">
                  Updated {lastUpdate.toLocaleTimeString()}
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-slate-400 italic text-center">
                AI agent will transcribe the conversation in real-time...
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Medical Notes */}
      <div className="flex-1 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
              Medical Notes
            </h3>
            {notes && (
              <span className="px-2 py-1 rounded-md bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-xs font-medium">
                AI Generated
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {notes && (
              <button
                onClick={() => {
                  // Copy notes to clipboard
                  navigator.clipboard.writeText(notes);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/50 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </button>
            )}
            <button className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium transition-colors flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {notes ? (
            <div className="prose prose-sm prose-invert max-w-none prose-headings:text-white prose-p:text-white prose-strong:text-white prose-ul:text-white prose-li:text-white prose-a:text-blue-300 prose-code:text-white prose-pre:text-white [&_*]:text-white">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {notes}
              </ReactMarkdown>
              {lastUpdate && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-400 italic">
                    Last updated: {lastUpdate.toLocaleTimeString()}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 mb-4 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 font-medium mb-2">
                No notes yet
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">
                AI-generated medical notes in SOAP format will appear here as the consultation progresses
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
