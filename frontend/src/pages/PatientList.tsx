import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { PatientSnapshot } from "../api/types.js";
import { CareStageBadge, EngagementBadge, RiskBadge } from "../components/Badge.js";

export function PatientList({
  refreshVersion,
  onOpenPatient,
}: {
  refreshVersion: number;
  onOpenPatient: (id: string) => void;
}) {
  const [patients, setPatients] = useState<PatientSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPatients()
      .then(setPatients)
      .catch((err) => setError(err.message));
  }, [refreshVersion]);

  if (error) return <ErrorBanner message={error} />;
  if (!patients) return <p className="text-sm text-slate-500">Loading patients…</p>;

  return (
    <div>
      <h2 className="mb-4 text-base font-semibold text-slate-900">
        Patient list <span className="text-sm font-normal text-slate-400">({patients.length})</span>
      </h2>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Patient</Th>
              <Th>Care Stage</Th>
              <Th>Risk Level</Th>
              <Th>Engagement</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {patients.map((s) => (
              <tr
                key={s.patient.id}
                onClick={() => onOpenPatient(s.patient.id)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-medium text-slate-900">{s.patient.displayName}</td>
                <td className="px-4 py-3">
                  <CareStageBadge stage={s.careStage} />
                </td>
                <td className="px-4 py-3">
                  <RiskBadge level={s.risk.riskLevel} />
                  {s.risk.riskLevel !== "Stable" && (
                    <span className="ml-2 text-xs text-slate-400">{s.risk.reasons[0]}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <EngagementBadge status={s.engagement.engagementStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</th>;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-medium">Couldn't reach the dashboard API.</p>
      <p className="mt-1 text-red-700">{message}</p>
      <p className="mt-1 text-red-600">Make sure both the safety service and `npm run dashboard` (in core/) are running.</p>
    </div>
  );
}
