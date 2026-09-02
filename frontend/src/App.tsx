import { useState } from "react";
import { useRefreshSignal } from "./api/useRefreshSignal.js";
import { PatientList } from "./pages/PatientList.js";
import { PatientTimeline } from "./pages/PatientTimeline.js";
import { ApprovalQueue } from "./pages/ApprovalQueue.js";
import { TriageQueue } from "./pages/TriageQueue.js";

type Tab = "patients" | "timeline" | "approvals" | "triage";

const TABS: { id: Tab; label: string }[] = [
  { id: "patients", label: "Patients" },
  { id: "approvals", label: "Approval Queue" },
  { id: "triage", label: "Fast Triage" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("patients");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const { version, connected, lastEventAt } = useRefreshSignal();

  function openPatient(id: string) {
    setSelectedPatientId(id);
    setTab("timeline");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">SAHAYAK</h1>
            <p className="text-xs text-slate-500">Clinician dashboard — synthetic data only, no real PHI</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-300"}`} />
            {connected ? "Live" : "Reconnecting…"}
            {lastEventAt && <span className="text-slate-400">· updated {new Date(lastEventAt).toLocaleTimeString()}</span>}
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-t-md px-4 py-2 text-sm font-medium transition ${
                tab === t.id || (t.id === "patients" && tab === "timeline")
                  ? "border-b-2 border-slate-900 text-slate-900"
                  : "border-b-2 border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {tab === "patients" && <PatientList refreshVersion={version} onOpenPatient={openPatient} />}
        {tab === "timeline" && selectedPatientId && (
          <PatientTimeline patientId={selectedPatientId} refreshVersion={version} onBack={() => setTab("patients")} />
        )}
        {tab === "timeline" && !selectedPatientId && (
          <p className="text-sm text-slate-500">Select a patient from the Patients tab to view their timeline.</p>
        )}
        {tab === "approvals" && <ApprovalQueue refreshVersion={version} onOpenPatient={openPatient} />}
        {tab === "triage" && <TriageQueue refreshVersion={version} onOpenPatient={openPatient} />}
      </main>
    </div>
  );
}
