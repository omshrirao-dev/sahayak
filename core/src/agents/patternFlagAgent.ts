import type { Agent, ProposedActionDraft } from "./agentTypes.js";
import type { World } from "../index.js";
import type { BaseEvent } from "../events/eventTypes.js";

/**
 * MEDIUM-tier example agent. Reacts to a new check-in by
 * re-evaluating risk_level; if the live computation lands on
 * "Watch", flags the pattern for clinician review. MEDIUM means this
 * executes autonomously (the flag gets created) but is always
 * surfaced for a human to see -- it never silently disappears into
 * a log (spec 2.2).
 */
export const patternFlagAgent: Agent = {
  name: "patternFlagAgent",

  evaluate(world: World, patientId: string, triggerEvent: BaseEvent): ProposedActionDraft[] {
    if (triggerEvent.eventType !== "CHECK_IN_SUBMITTED" && triggerEvent.eventType !== "CHECK_IN_MISSED") {
      return [];
    }

    const risk = world.getRiskLevel(patientId);
    if (risk.riskLevel !== "Watch") return [];

    return [
      {
        actionType: "FLAG_MOOD_PATTERN",
        payload: { patientId, riskReasons: risk.reasons },
        reason: `risk_level computed as Watch: ${risk.reasons.join("; ")}`,
        draftedText: `Pattern flag: ${risk.reasons.join("; ")}`,
      },
    ];
  },
};
