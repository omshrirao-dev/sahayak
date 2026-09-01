import type {
  BaseEvent,
  CheckInSubmittedPayload,
  ClinicianNoteAddedPayload,
  CrisisFlagRaisedPayload,
  CrisisFlagResolvedPayload,
} from "../events/eventTypes.js";

/**
 * risk_level is NEVER stored -- it is computed live from the event
 * stream every time it's needed (see spec 2.1). This keeps it
 * impossible for risk_level to silently drift from the events that
 * justify it: there is exactly one source of truth.
 *
 * risk_level is independent of care_stage: a patient in
 * "Maintenance" can be "Crisis" just as easily as one in "Intake".
 */
export type RiskLevel = "Stable" | "Watch" | "Crisis";

/** Consecutive declining/low mood check-ins that trigger "Watch". */
const DECLINE_STREAK_THRESHOLD = 3;
const LOW_MOOD_SCORE = 4; // out of 10
const MISSED_CHECK_IN_WATCH_THRESHOLD = 2;

export interface RiskLevelResult {
  riskLevel: RiskLevel;
  reasons: string[];
}

/**
 * Edge Case 3 (memory drift): an event whose `validUntil` has
 * passed is stale. Stale events are excluded from the softer
 * "Watch" signals below -- but NEVER from crisis-flag resolution
 * state, since silently forgetting an unresolved crisis flag would
 * be a safety failure, not a memory-hygiene nicety.
 */
function isStale(event: BaseEvent, now: Date): boolean {
  return !!event.validUntil && new Date(event.validUntil) < now;
}

export function computeRiskLevel(events: BaseEvent[], now: Date = new Date()): RiskLevelResult {
  const reasons: string[] = [];

  // 1. Unresolved crisis flags always win -- highest priority,
  //    independent of staleness rules.
  const crisisFlags = events.filter((e) => e.eventType === "CRISIS_FLAG_RAISED");
  const resolutions = events.filter((e) => e.eventType === "CRISIS_FLAG_RESOLVED");
  const resolvedFlagIds = new Set(
    resolutions.map((e) => (e.payload as unknown as CrisisFlagResolvedPayload).relatedFlagEventId),
  );
  const unresolvedFlags = crisisFlags.filter((e) => !resolvedFlagIds.has(e.id));
  if (unresolvedFlags.length > 0) {
    for (const f of unresolvedFlags) {
      const p = f.payload as unknown as CrisisFlagRaisedPayload;
      reasons.push(`Unresolved crisis flag (${p.severity}): ${p.reason}`);
    }
    return { riskLevel: "Crisis", reasons };
  }

  // 2. Declining/low mood-score streak (most recent N check-ins).
  const checkIns = events
    .filter((e) => e.eventType === "CHECK_IN_SUBMITTED" && !isStale(e, now))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const recentCheckIns = checkIns.slice(0, DECLINE_STREAK_THRESHOLD);
  const allLow =
    recentCheckIns.length === DECLINE_STREAK_THRESHOLD &&
    recentCheckIns.every((e) => (e.payload as unknown as CheckInSubmittedPayload).moodScore <= LOW_MOOD_SCORE);
  const chronologicalScores = [...recentCheckIns]
    .reverse() // oldest first, so we can check decline forward in time
    .map((e) => (e.payload as unknown as CheckInSubmittedPayload).moodScore);
  const isDecliningTrend =
    recentCheckIns.length === DECLINE_STREAK_THRESHOLD &&
    chronologicalScores.every((score, i, arr) => i === 0 || score <= arr[i - 1]!) &&
    chronologicalScores[0]! > chronologicalScores[chronologicalScores.length - 1]!;
  if (allLow || isDecliningTrend) {
    reasons.push(
      `Mood-score pattern over last ${DECLINE_STREAK_THRESHOLD} check-ins: ` +
        recentCheckIns.map((e) => (e.payload as unknown as CheckInSubmittedPayload).moodScore).join(", "),
    );
  }

  // 3. Clinician-flagged decline (only if not stale -- Edge Case 3).
  const clinicianNotes = events.filter(
    (e) => e.eventType === "CLINICIAN_NOTE_ADDED" && !isStale(e, now),
  );
  const latestNote = clinicianNotes[clinicianNotes.length - 1];
  const clinicianFlaggedDecline =
    !!latestNote && (latestNote.payload as unknown as ClinicianNoteAddedPayload).clinicianAssessment === "declining";
  if (clinicianFlaggedDecline) {
    reasons.push("Most recent clinician note flags decline");
  }

  // 4. Missed check-ins.
  const missedCount = events.filter(
    (e) => e.eventType === "CHECK_IN_MISSED" && !isStale(e, now),
  ).length;
  if (missedCount >= MISSED_CHECK_IN_WATCH_THRESHOLD) {
    reasons.push(`${missedCount} missed check-ins`);
  }

  if (reasons.length > 0) {
    return { riskLevel: "Watch", reasons };
  }

  return { riskLevel: "Stable", reasons: ["No decline signals in event stream"] };
}
