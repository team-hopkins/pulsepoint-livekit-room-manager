'use client';

import { useEffect, useState } from 'react';

interface JoinConfirmationProps {
  patientId: string;
  urgency: string;
  onConfirm: () => void;
}

export function JoinConfirmation({
  patientId,
  urgency,
  onConfirm,
}: JoinConfirmationProps) {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  const urgencyColor =
    urgency === 'HIGH'
      ? 'bg-red-100 text-red-700 border-red-300'
      : urgency === 'MEDIUM'
        ? 'bg-yellow-100 text-yellow-700 border-yellow-300'
        : 'bg-green-100 text-green-700 border-green-300';

  const urgencyDot =
    urgency === 'HIGH'
      ? 'bg-red-500'
      : urgency === 'MEDIUM'
        ? 'bg-yellow-500'
        : 'bg-green-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Join Consultation</h1>
          <p className="mt-1 text-blue-100">Patient Telemedicine Session</p>
        </div>

        {/* Content */}
        <div className="px-8 py-8">
          {/* Patient Info */}
          <div className="mb-6 rounded-lg bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-600">Patient ID</p>
            <p className="mt-1 font-mono text-lg font-semibold text-gray-900">
              {patientId}
            </p>
          </div>

          {/* Urgency Badge */}
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-600">Urgency Level</p>
            <div
              className={`mt-2 inline-flex items-center gap-2 rounded-full border px-4 py-2 ${urgencyColor}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${urgencyDot}`}></span>
              <span className="font-semibold">{urgency}</span>
            </div>
          </div>

          {/* Description */}
          <div className="mb-8 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            <p className="font-medium">About to join a live consultation</p>
            <ul className="mt-2 list-inside list-disc space-y-1 opacity-75">
              <li>Your audio will be enabled</li>
              <li>You can interact with the agent</li>
              <li>Session will be recorded for documentation</li>
            </ul>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => setIsVisible(false)}
              className="flex-1 rounded-lg border-2 border-gray-300 px-6 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onConfirm();
                setIsVisible(false);
              }}
              className="flex-1 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-3 font-semibold text-white transition-transform hover:shadow-lg hover:shadow-blue-500/50 active:scale-95"
            >
              Join Session
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 bg-gray-50 px-8 py-4 text-center text-xs text-gray-500">
          By joining, you accept the terms of service
        </div>
      </div>
    </div>
  );
}
