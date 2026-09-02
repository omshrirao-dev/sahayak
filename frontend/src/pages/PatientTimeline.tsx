import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { PatientSnapshot, TimelineEntry } from "../api/types.js";
import { CareStageBadge, EngagementBadge, RiskBadge, StatusBadge, TierBadge } from "../components/Badge.js";
import { ErrorBanner } from "./PatientList.js";

export function PatientTimeline({
  patientId,
  refreshVersion,
  onBack,
}: {
  patientId: string;
  refreshVersion: number;
  onBack: () => void;
}) {
  const [snapshot, setSnapshot] = useState<PatientSnapshot | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [sending, setSending] = useState(false);

  function load() {
    Promise.all([api.getPatient(patientId), api.getTimeline(patientId)])
      .then(([s, t]) => {
        setSnapshot(s);
        setTimeline([...t].reverse()); // most recent first
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, [patientId, refreshVersion]);

  async function sendMessage() {
    if (!messageDraft.trim()) return;
    setSending(true);
    try {
      await api.simulateMessage(patientId, messageDraft);
      setMessageDraft("");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!snapshot || !timeline) return <p className="text-sm text-slate-500">Loading timeline…</p>;

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-slate-500 hover:text-slate-800">
        ← Back to patient list
      </button>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">{snapshot.patient.displayName}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CareStageBadge stage={snapshot.careStage} />
          <RiskBadge level={snapshot.risk.riskLevel} />
          <EngagementBadge status={snapshot.engagement.engagementStatus} />
        </div>
        <ul className="mt-3 space-y-0.5 text-xs text-slate-500">
          {snapshot.risk.reasons.map((r, i) => (
            <li key={i}>risk: {r}</li>
          ))}
        </ul>

        <div className="mt-4 flex gap-2">
          <input
            value={messageDraft}
            onChange={(e) => setMessageDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Simulate an inbound patient message…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
          <button
            disabled={sending || !messageDraft.trim()}
            onClick={sendMessage}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Runs through the real orchestrator + live safety service (independent crisis and injection checks
          on every message).
        </p>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-slate-900">Full timeline ({timeline.length})</h3>
      <div className="space-y-3">
        {timeline.map((entry, i) => (
          <TimelineRow key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === "event") return <EventRow event={entry.event} />;
  if (entry.kind === "action") return <ActionRow action={entry.action} />;
  if (entry.kind === "override") return <OverrideRow override={entry.override} />;
  return <ReasoningTraceRow trace={entry.trace} />;
}

function Timestamp({ at }: { at: string }) {
  return <span className="text-xs text-slate-400">{new Date(at).toLocaleString()}</span>;
}

function EventRow({ event }: { event: Extract<TimelineEntry, { kind: "event" }>["event"] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-700">📅 {event.eventType}</span>
        <Timestamp at={event.occurredAt} />
      </div>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs text-slate-500">
        {JSON.stringify(event.payload)}
      </pre>
      <div className="mt-1 text-xs text-slate-400">source: {event.source}</div>
    </div>
  );
}

function ActionRow({ action }: { action: Extract<TimelineEntry, { kind: "action" }>["action"] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-700">⚙️ {action.actionType}</span>
          <TierBadge tier={action.tier} />
          <StatusBadge status={action.status} />
          {action.flaggedForReview && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">flagged for review</span>
          )}
        </div>
        <Timestamp at={action.createdAt} />
      </div>
      <div className="mt-1 text-xs text-slate-500">proposed by {action.proposedBy}</div>
      {action.blockRecord && (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Blocked ({action.blockRecord.reason}): {action.blockRecord.details.join(" ")}
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-400">history ({action.history.length})</summary>
        <ul className="mt-1 space-y-0.5 pl-3 text-xs text-slate-500">
          {action.history.map((h, i) => (
            <li key={i}>
              {h.status} — {new Date(h.at).toLocaleString()} by {h.by}
              {h.note ? ` (${h.note})` : ""}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function OverrideRow({ override }: { override: Extract<TimelineEntry, { kind: "override" }>["override"] }) {
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-violet-800">🖐 Clinician override — {override.actionType}</span>
        <Timestamp at={override.at} />
      </div>
      <div className="mt-1 text-xs text-slate-600">
        {override.overriddenBy}: "{override.reason}"
      </div>
    </div>
  );
}

function ReasoningTraceRow({ trace }: { trace: Extract<TimelineEntry, { kind: "reasoning_trace" }>["trace"] }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getReasoningTrace(trace.id);
      setContent(res.content);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-600">🔒 Reasoning trace — {trace.authorId}</span>
        <Timestamp at={trace.createdAt} />
      </div>
      {content === null && !error && (
        <button onClick={reveal} disabled={loading} className="mt-1 text-xs text-slate-500 underline hover:text-slate-800">
          {loading ? "Decrypting…" : "Reveal (access-controlled, encrypted at rest)"}
        </button>
      )}
      {content !== null && <p className="mt-1 text-xs text-slate-700">{content}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
