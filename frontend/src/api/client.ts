import type {
  ActionInstanceDTO,
  ApprovalQueueItem,
  PatientSnapshot,
  TimelineEntry,
  TriageQueueItemDTO,
} from "./types.js";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
export const DEMO_PRINCIPAL = "clinician:demo";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getPatients: () => request<PatientSnapshot[]>("/api/patients"),
  getPatient: (id: string) => request<PatientSnapshot>(`/api/patients/${id}`),
  getTimeline: (id: string) => request<TimelineEntry[]>(`/api/patients/${id}/timeline`),

  getApprovalQueue: () => request<ApprovalQueueItem[]>("/api/approval-queue"),
  approveAction: (id: string, by = DEMO_PRINCIPAL) =>
    request<ActionInstanceDTO>(`/api/actions/${id}/approve`, { method: "POST", body: JSON.stringify({ by }) }),
  overrideAction: (id: string, reason: string, by = DEMO_PRINCIPAL) =>
    request<ActionInstanceDTO>(`/api/actions/${id}/override`, { method: "POST", body: JSON.stringify({ by, reason }) }),

  getTriageQueue: () => request<TriageQueueItemDTO[]>("/api/triage-queue"),
  confirmTriage: (id: string, by = DEMO_PRINCIPAL) =>
    request<ActionInstanceDTO>(`/api/triage/${id}/confirm`, { method: "POST", body: JSON.stringify({ by }) }),
  dismissTriage: (id: string, note: string, by = DEMO_PRINCIPAL) =>
    request<ActionInstanceDTO>(`/api/triage/${id}/dismiss`, { method: "POST", body: JSON.stringify({ by, note }) }),

  getReasoningTrace: (entryId: string, requesterId = DEMO_PRINCIPAL) =>
    request<{ content: string }>(`/api/reasoning-traces/${entryId}?requesterId=${encodeURIComponent(requesterId)}`),

  simulateMessage: (patientId: string, text: string) =>
    request<{ event: unknown; actions: ActionInstanceDTO[] }>(`/api/patients/${patientId}/simulate-message`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
};

export function wsUrl(): string {
  return BASE_URL.replace(/^http/, "ws") + "/ws";
}
