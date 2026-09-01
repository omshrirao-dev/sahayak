/**
 * All event types the Phase 1 world-state model reacts to.
 * Every event is immutable once recorded (see eventStore.ts).
 *
 * Keep this list append-only in spirit: adding a new EventType is
 * fine, renaming/removing one breaks replay of historical events.
 */
export const EVENT_TYPES = [
  "PATIENT_ADMITTED",
  "CARE_STAGE_TRANSITION_REQUESTED",
  "CHECK_IN_SUBMITTED",
  "CHECK_IN_MISSED",
  "PATIENT_MESSAGE_RECEIVED",
  "CLINICIAN_NOTE_ADDED",
  "CRISIS_FLAG_RAISED",
  "CRISIS_FLAG_RESOLVED",
  "ASSESSMENT_SCHEDULED",
  "ASSESSMENT_COMPLETED",
  "ENGAGEMENT_PING_SENT",
  "ENGAGEMENT_PING_RESPONDED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Who/what originated the event. */
export type EventSource = "patient" | "clinician" | "agent" | "system";

/**
 * Base shape shared by every event. `payload` is intentionally
 * loosely typed here (see per-event payload interfaces below) --
 * events are stored as jsonb and validated at the edges, not
 * force-fit into one rigid discriminated union at the DB layer.
 */
export interface BaseEvent<T extends EventType = EventType, P = Record<string, unknown>> {
  id: string;
  patientId: string;
  eventType: T;
  payload: P;
  /**
   * Edge Case 3 (memory drift): when set, this event's fact is
   * considered stale after this timestamp and MUST be re-confirmed
   * before a MEDIUM/HIGH tier decision may rely on it.
   */
  validUntil?: string | null;
  occurredAt: string;
  recordedAt: string;
  source: EventSource;
}

export interface CheckInSubmittedPayload {
  moodScore: number; // 1-10, 1 = worst
  responded: true;
  notes?: string;
}

export interface CheckInMissedPayload {
  scheduledFor: string;
}

export interface PatientMessageReceivedPayload {
  text: string;
  /**
   * Set by the Python safety service's crisis classifier
   * (Edge Case 1/2). Independent of any agent's own read of the
   * message -- see safety/safetyClient.ts in Phase 3.
   */
  crisisClassifierFlag?: boolean;
}

export interface ClinicianNoteAddedPayload {
  text: string;
  clinicianAssessment: "stable" | "improving" | "declining" | "unspecified";
  clinicianId: string;
}

export interface CrisisFlagRaisedPayload {
  severity: "low" | "medium" | "high";
  reason: string;
  raisedBy: EventSource;
}

export interface CrisisFlagResolvedPayload {
  resolution: "confirmed_false_positive" | "confirmed_true_escalated" | "resolved_stable";
  resolvedBy: string;
  relatedFlagEventId: string;
}

export interface AssessmentCompletedPayload {
  instrument: string; // e.g. "PHQ-9"
  score: number;
}

export interface CareStageTransitionRequestedPayload {
  toStage: "Intake" | "Active Care" | "Maintenance" | "Discharged";
  reason: string;
  requestedBy: EventSource;
}

export interface EngagementPingRespondedPayload {
  pingEventId: string;
}
