import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { TriageQueueItemDTO } from "../api/types.js";
import { ErrorBanner } from "./PatientList.js";
import { EmptyState } from "./ApprovalQueue.js";

export function TriageQueue({
  refreshVersion,
  onOpenPatient,
}: {
  refreshVersion: number;
  onOpenPatient: (id: string) => void;
}) {
  const [items, setItems] = useState<TriageQueueItemDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api
      .getTriageQueue()
      .then(setItems)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [refreshVersion]);

  async function confirm(id: string) {
    setBusyId(id);
    try {
      await api.confirmTriage(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    const note = window.prompt("Why is this a false positive?", "Sarcastic / non-literal phrasing");
    if (note === null) return;
    setBusyId(id);
    try {
      await api.dismissTriage(id, note);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!items) return <p className="text-sm text-slate-500">Loading fast triage queue…</p>;

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-slate-900">
        Fast triage queue <span className="text-sm font-normal text-slate-400">({items.length})</span>
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Crisis-language flags awaiting a quick confirm/dismiss — deliberately separate from the full
        approval queue, so a false positive costs one click, not a full review (Edge Case 2).
      </p>
      {items.length === 0 && <EmptyState label="No crisis flags waiting on triage." />}
      <div className="space-y-3">
        {items.map(({ item, patient, escalationAction }) => (
          <div key={item.id} className="rounded-lg border border-red-200 bg-red-50/40 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <button
                  className="font-medium text-slate-900 hover:underline"
                  onClick={() => patient && onOpenPatient(patient.id)}
                >
                  {patient?.displayName ?? "Unknown patient"}
                </button>
                <div className="mt-1 text-sm text-slate-700">
                  Matched pattern:{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                    {item.matchedPattern === "__ml_only__" ? "ML classifier only (no keyword match)" : item.matchedPattern}
                  </code>
                  <span className="ml-2 text-xs text-slate-400">confidence {(item.probability * 100).toFixed(0)}%</span>
                </div>
                {escalationAction && (
                  <div className="mt-1 text-xs text-slate-500">Drafted escalation: {escalationAction.actionType} ({escalationAction.status})</div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  disabled={busyId === item.id}
                  onClick={() => confirm(item.id)}
                  className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                >
                  Confirm — genuine
                </button>
                <button
                  disabled={busyId === item.id}
                  onClick={() => dismiss(item.id)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Dismiss — false positive
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
