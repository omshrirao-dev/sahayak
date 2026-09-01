import type { Agent, ProposedActionDraft } from "./agentTypes.js";
import type { World } from "../index.js";
import type { BaseEvent, CrisisFlagRaisedPayload, PatientMessageReceivedPayload } from "../events/eventTypes.js";

/**
 * HIGH-tier example agent. Reacts to a raised crisis flag by
 * drafting an escalation for clinician review. Crisis-adjacent
 * actions sit on the hard blocklist's neighbor rule: never
 * autonomous, draft only, always requires explicit human approval
 * (spec 2.2, 4.1). This agent NEVER auto-executes -- the orchestrator
 * enforces that structurally for every HIGH-tier action, but this
 * agent also never drafts free-form clinical language, only a
 * structured summary of what triggered the flag.
 */
export const escalationAgent: Agent = {
  name: "escalationAgent",

  evaluate(_world: World, patientId: string, triggerEvent: BaseEvent): ProposedActionDraft[] {
    if (triggerEvent.eventType === "CRISIS_FLAG_RAISED") {
      const payload = triggerEvent.payload as unknown as CrisisFlagRaisedPayload;
      return [
        {
          actionType: "ESCALATE_CRISIS",
          payload: { patientId, severity: payload.severity, sourceEventId: triggerEvent.id },
          reason: `Crisis flag raised (${payload.severity}): ${payload.reason}`,
          draftedText: `Crisis escalation drafted for clinician review. Severity: ${payload.severity}. Reason: ${payload.reason}`,
        },
      ];
    }

    if (triggerEvent.eventType === "PATIENT_MESSAGE_RECEIVED") {
      const payload = triggerEvent.payload as unknown as PatientMessageReceivedPayload;
      if (!payload.crisisClassifierFlag) return [];
      return [
        {
          actionType: "ESCALATE_CRISIS",
          payload: { patientId, sourceEventId: triggerEvent.id },
          reason: "Inbound message flagged by the independent crisis-language classifier.",
          draftedText: "Crisis escalation drafted for clinician review based on an inbound message flag.",
          inboundPatientText: payload.text,
        },
      ];
    }

    return [];
  },
};
