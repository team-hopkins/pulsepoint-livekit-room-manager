'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface PatientSummary {
  patient_id: string;
  name?: string;
  condition?: string;
  urgency?: string;
  updated_at?: string;
}

export default function Page() {
  const router = useRouter();
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPatients = async () => {
      setLoadingList(true);
      setError(null);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const res = await fetch(`${baseUrl}/patients`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`Failed to load patients (status ${res.status})`);
        const data = await res.json();
        setPatients(data.patients || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load patients');
      } finally {
        setLoadingList(false);
      }
    };

    fetchPatients();
  }, []);

  const formatDate = (value?: string) => {
    if (!value) return '--';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const urgencyClass = (urgency?: string) => {
    const level = (urgency || 'NORMAL').toUpperCase();
    if (level === 'HIGH' || level === 'EMERGENCY') return 'bg-red-600/20 text-red-200 border-red-500/60';
    if (level === 'MEDIUM') return 'bg-amber-500/20 text-amber-200 border-amber-400/60';
    return 'bg-emerald-600/20 text-emerald-200 border-emerald-500/60';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <p className="text-sm text-slate-400">Doctor Dashboard</p>
          <h1 className="text-2xl font-bold">Patients</h1>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-slate-300">Patient Queue</p>
            {loadingList && <span className="text-xs text-slate-500">Loading...</span>}
          </div>
          <div className="space-y-2">
            {patients.map((p) => (
              <button
                key={p.patient_id}
                onClick={() => router.push(`/patient/${p.patient_id}`)}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-left transition hover:border-blue-500 hover:bg-slate-800"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-100">{p.name || p.patient_id}</p>
                    <p className="text-xs text-slate-400">ID: {p.patient_id}</p>
                  </div>
                  <span className={`text-xs rounded-full px-2 py-1 border ${urgencyClass(p.urgency)}`}>
                    {p.urgency || 'NORMAL'}
                  </span>
                </div>
                {p.condition && <p className="mt-1 text-sm text-slate-300">{p.condition}</p>}
                <p className="mt-1 text-xs text-slate-500">Updated: {formatDate(p.updated_at)}</p>
              </button>
            ))}

            {!loadingList && patients.length === 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-sm text-slate-300">
                No patients yet. If this seems wrong, ensure the backend is running and that NEXT_PUBLIC_API_URL points to it.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
