import type { Agent, ProposedActionDraft } from "./agentTypes.js";
import type { World } from "../index.js";
import type { BaseEvent, CrisisFlagRaisedPayload } from "../events/eventTypes.js";

/**
 * HIGH-tier example agent. Reacts to a raised crisis flag by
 * drafting an escalation for clinician review. Crisis-adjacent
 * actions sit on the hard blocklist's neighbor rule: never
 * autonomous, draft only, always requires explicit human approval
 * (spec 2.2, 4.1). This agent NEVER auto-executes -- the orchestrator
 * enforces that structurally for every HIGH-tier action, but this
 * agent also never drafts free-form clinical language, only a
 * structured summary of what triggered the flag.
 *
 * Deliberately reacts ONLY to CRISIS_FLAG_RAISED, not directly to
 * inbound patient messages -- the independent crisis-language check
 * on every message (Edge Case 1) lives in the orchestrator itself
 * (Orchestrator.handleEvent), which raises CRISIS_FLAG_RAISED when
 * it fires. That keeps the "redundant safety net" property real:
 * this agent's escalation path is driven by the same event whether
 * the flag came from the always-on classifier or from any other
 * source (e.g. a clinician manually raising one).
 */
export const escalationAgent: Agent = {
  name: "escalationAgent",

  evaluate(_world: World, patientId: string, triggerEvent: BaseEvent): ProposedActionDraft[] {
    if (triggerEvent.eventType !== "CRISIS_FLAG_RAISED") return [];

    const payload = triggerEvent.payload as unknown as CrisisFlagRaisedPayload;
    return [
      {
        actionType: "ESCALATE_CRISIS",
        payload: { patientId, severity: payload.severity, sourceEventId: triggerEvent.id },
        reason: `Crisis flag raised (${payload.severity}): ${payload.reason}`,
        draftedText: `Crisis escalation drafted for clinician review. Severity: ${payload.severity}. Reason: ${payload.reason}`,
      },
    ];
  },
};
