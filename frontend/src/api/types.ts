export type CareStage = "Intake" | "Active Care" | "Maintenance" | "Discharged";
export type RiskLevel = "Stable" | "Watch" | "Crisis";
export type EngagementStatus = "Active" | "Unresponsive" | "Disengaged";
export type ActionTier = "LOW" | "MEDIUM" | "HIGH";
export type ActionStatus = "proposed" | "approved" | "executing" | "completed" | "superseded" | "cancelled";

export interface Patient {
  id: string;
  displayName: string;
  synthetic: true;
}

export interface PatientSnapshot {
  patient: Patient;
  careStage: CareStage;
  risk: { riskLevel: RiskLevel; reasons: string[]; contributingEventIds: string[] };
  engagement: { engagementStatus: EngagementStatus; consecutiveMisses: number; reasons: string[] };
}

export interface ActionHistoryEntry {
  status: ActionStatus;
  at: string;
  by: string;
  note?: string;
}

export interface ActionInstanceDTO {
  id: string;
  patientId: string;
  actionType: string;
  tier: ActionTier;
  proposedBy: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  requiresImmediateEscalation: boolean;
  flaggedForReview: boolean;
  blockRecord: { reason: "stale_facts" | "safety_service"; details: string[] } | null;
  status: ActionStatus;
  result?: unknown;
  history: ActionHistoryEntry[];
  createdAt: string;
}

export interface WorldEventDTO {
  id: string;
  patientId: string;
  eventType: string;
  payload: Record<string, unknown>;
  validUntil?: string | null;
  occurredAt: string;
  recordedAt: string;
  source: string;
}

export interface OverrideRecordDTO {
  patientId: string;
  actionType: string;
  overriddenBy: string;
  reason: string;
  originalTier: string;
  at: string;
}

export interface ReasoningTraceMetaDTO {
  id: string;
  patientId: string;
  authorId: string;
  createdAt: string;
}

export type TimelineEntry =
  | { kind: "event"; at: string; event: WorldEventDTO }
  | { kind: "action"; at: string; action: ActionInstanceDTO }
  | { kind: "override"; at: string; override: OverrideRecordDTO }
  | { kind: "reasoning_trace"; at: string; trace: ReasoningTraceMetaDTO };

export interface ApprovalQueueItem {
  action: ActionInstanceDTO;
  patient: Patient | undefined;
}

export interface TriageQueueItemDTO {
  item: {
    id: string;
    patientId: string;
    crisisFlagEventId: string;
    escalationActionId: string;
    matchedPattern: string;
    probability: number;
    createdAt: string;
    decision: "confirmed_true" | "dismissed_false_positive" | null;
    decidedBy: string | null;
    decidedAt: string | null;
  };
  patient: Patient | undefined;
  escalationAction: ActionInstanceDTO | undefined;
}
