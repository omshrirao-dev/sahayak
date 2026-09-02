import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { ApprovalQueueItem } from "../api/types.js";
import { TierBadge } from "../components/Badge.js";
import { ErrorBanner } from "./PatientList.js";

export function ApprovalQueue({
  refreshVersion,
  onOpenPatient,
}: {
  refreshVersion: number;
  onOpenPatient: (id: string) => void;
}) {
  const [items, setItems] = useState<ApprovalQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api
      .getApprovalQueue()
      .then(setItems)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [refreshVersion]);

  async function approve(id: string) {
    setBusyId(id);
    try {
      await api.approveAction(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting this action?", "Not clinically appropriate");
    if (reason === null) return;
    setBusyId(id);
    try {
      await api.overrideAction(id, reason);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!items) return <p className="text-sm text-slate-500">Loading approval queue…</p>;

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-slate-900">
        Approval queue <span className="text-sm font-normal text-slate-400">({items.length})</span>
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        HIGH-tier drafted actions, plus any lower-tier action currently blocked from auto-executing (stale
        source facts or a safety-service verdict). Nothing here has run yet.
      </p>
      {items.length === 0 && <EmptyState label="Nothing pending approval right now." />}
      <div className="space-y-3">
        {items.map(({ action, patient }) => (
          <div key={action.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <button
                  className="font-medium text-slate-900 hover:underline"
                  onClick={() => patient && onOpenPatient(patient.id)}
                >
                  {patient?.displayName ?? "Unknown patient"}
                </button>
                <div className="mt-1 flex items-center gap-2">
                  <TierBadge tier={action.tier} />
                  <span className="text-sm text-slate-700">{action.actionType}</span>
                  <span className="text-xs text-slate-400">via {action.proposedBy}</span>
                </div>
                {action.blockRecord && (
                  <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <span className="font-medium">
                      Blocked ({action.blockRecord.reason === "stale_facts" ? "stale source facts" : "safety service"}):
                    </span>{" "}
                    {action.blockRecord.details.join(" ")}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  disabled={busyId === action.id}
                  onClick={() => approve(action.id)}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busyId === action.id}
                  onClick={() => reject(action.id)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}
