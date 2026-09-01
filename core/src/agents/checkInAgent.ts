import type { Agent, ProposedActionDraft } from "./agentTypes.js";
import type { World } from "../index.js";
import type { BaseEvent } from "../events/eventTypes.js";

/**
 * LOW-tier example agent. Reacts to a missed check-in by drafting a
 * routine, template-based reminder -- exactly the kind of low-risk,
 * fully-templated action the allow-list model designates for full
 * autonomy (spec 2.2, 4.1: "Agents NEVER generate free-form clinical
 * language").
 */
export const checkInAgent: Agent = {
  name: "checkInAgent",

  evaluate(_world: World, patientId: string, triggerEvent: BaseEvent): ProposedActionDraft[] {
    if (triggerEvent.eventType !== "CHECK_IN_MISSED") return [];

    return [
      {
        actionType: "SEND_CHECK_IN_REMINDER",
        payload: { patientId, scheduledFor: triggerEvent.occurredAt },
        reason: "Patient missed a scheduled check-in.",
        draftedText: "Hi, just a reminder to complete your check-in when you have a moment. No rush!",
      },
    ];
  },
};
