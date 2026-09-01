import type { Agent, ProposedActionDraft } from "./agentTypes.js";
import type { World } from "../index.js";
import type { BaseEvent, CheckInSubmittedPayload, ClinicianNoteAddedPayload } from "../events/eventTypes.js";
import type { SafetyClient } from "../safety/safetyClient.js";

const RECENT_CHECK_IN_COUNT = 3;

const LOW_MOOD_SCORE = 4;

/**
 * Describes the trend in words ("declining"/"improving"/"stable"),
 * not just the raw numbers. The contradiction detector is a lexicon-
 * assisted classifier (see safety-service/app/contradiction_detector.py)
 * that reads for polarity cue words like "declining" or "stable" --
 * a bare number list ("scores are 3, 2, 3") carries none of that
 * signal and under-triggers CONTRADICT even when the trend plainly
 * disagrees with a clinician note. The numbers stay in the text
 * verbatim alongside the description; this adds a factual descriptor
 * computed from the check-in data itself, it doesn't blend it with
 * the clinician's note.
 */
function summarizeRecentCheckIns(world: World, patientId: string): { text: string; eventIds: string[] } {
  const checkIns = world.store
    .getByPatientAndType(patientId, "CHECK_IN_SUBMITTED")
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, RECENT_CHECK_IN_COUNT);
  const chronological = [...checkIns].reverse();
  const scores = chronological.map((e) => (e.payload as unknown as CheckInSubmittedPayload).moodScore);

  let trend = "stable";
  if (scores.length >= 2) {
    if (scores[scores.length - 1]! < scores[0]!) trend = "declining";
    else if (scores[scores.length - 1]! > scores[0]!) trend = "improving";
  }
  const lowNote = scores.length > 0 && scores.every((s) => s <= LOW_MOOD_SCORE) ? " and trending low" : "";

  return {
    text:
      scores.length > 0
        ? `Check-in data: mood scores are ${trend}${lowNote} (most recent: ${scores.join(", ")}).`
        : "Check-in data: none recorded.",
    eventIds: checkIns.map((e) => e.id),
  };
}

/**
 * MEDIUM-tier agent for Edge Case 4 (contradictory data sources).
 * Reacts to a new clinician note by comparing it against the
 * patient's recent check-in data via the safety service's
 * contradiction detector. On CONTRADICT, it drafts a
 * FLAG_DATA_CONTRADICTION action that surfaces BOTH sources
 * side-by-side, verbatim -- it never averages or blends them into
 * a single "resolved" summary. This action deliberately does NOT
 * set `contradictionCheck` on its own draft (that field would make
 * the orchestrator's own verify-action call block THIS action --
 * see agentTypes.ts) because the whole point of this agent is to
 * always execute and surface what it found, not to be blocked by it.
 *
 * Constructed with a SafetyClient because it needs to call the
 * contradiction endpoint directly during evaluate(), unlike the
 * synchronous agents that only describe what they want and let the
 * orchestrator run the (also-independent) safety checks afterward.
 */
export function createContradictionAgent(safetyClient: SafetyClient): Agent {
  return {
    name: "contradictionAgent",

    async evaluate(world: World, patientId: string, triggerEvent: BaseEvent): Promise<ProposedActionDraft[]> {
      if (triggerEvent.eventType !== "CLINICIAN_NOTE_ADDED") return [];

      const notePayload = triggerEvent.payload as unknown as ClinicianNoteAddedPayload;
      const sourceA = `Clinician note: ${notePayload.text}`;
      const { text: sourceB, eventIds: checkInEventIds } = summarizeRecentCheckIns(world, patientId);

      if (checkInEventIds.length === 0) return []; // nothing to compare against yet

      const result = await safetyClient.checkContradiction(sourceA, sourceB);
      if (result.label !== "CONTRADICT") return [];

      return [
        {
          actionType: "FLAG_DATA_CONTRADICTION",
          payload: {
            patientId,
            clinicianNoteEventId: triggerEvent.id,
            checkInEventIds,
            sourceA,
            sourceB,
            contradictionLabel: result.label,
            contradictionReasoning: result.reasoning,
          },
          reason: `Clinician note and check-in data CONTRADICT (${result.reasoning}); surfacing to a human rather than resolving automatically.`,
          draftedText: `Data contradiction detected. ${sourceA} | ${sourceB}`,
        },
      ];
    },
  };
}
