/**
 * The allow-list (spec 2.2). Every action type an agent can ever
 * propose must appear here with an explicit tier. There is
 * deliberately no way to mark an action type "autonomous" implicitly
 * -- getActionDefinition() below defaults anything NOT in this
 * registry to HIGH, so a newly-invented action type is safe by
 * construction until a human explicitly reviews and classifies it.
 */
export type ActionTier = "LOW" | "MEDIUM" | "HIGH";

/**
 * Hard blocklist (spec 4.1): never autonomous regardless of tier,
 * regardless of override history, regardless of anything else.
 *
 *  - "never_propose": agents may not even draft this action type.
 *    The orchestrator rejects the proposal outright.
 *  - "draft_and_escalate_only": the one exception (contact emergency
 *    services) -- a draft CAN be created, but it always sits at HIGH
 *    tier with an immediate-escalation flag and can never
 *    auto-execute, no matter what tier logic would otherwise say.
 */
export type HardBlockPolicy = "never_propose" | "draft_and_escalate_only";

export interface ActionTypeDefinition {
  actionType: string;
  tier: ActionTier;
  description: string;
  hardBlock?: HardBlockPolicy;
}

const DEFAULT_HIGH_TIER_DESCRIPTION =
  "Unclassified action type -- defaults to HIGH per allow-list policy (spec 2.2). " +
  "A human must explicitly review and add this action type to LOW or MEDIUM before it can run autonomously.";

/**
 * The allow-list itself. Add new action types here only after
 * explicit review -- see the module doc above.
 */
const ACTION_REGISTRY: Record<string, ActionTypeDefinition> = {
  // ---- LOW: full autonomy, executes immediately, logged. ----
  SEND_CHECK_IN_REMINDER: {
    actionType: "SEND_CHECK_IN_REMINDER",
    tier: "LOW",
    description: "Send a scheduled, template-based check-in reminder to the patient.",
  },
  LOG_PATIENT_RESPONSE: {
    actionType: "LOG_PATIENT_RESPONSE",
    tier: "LOW",
    description: "Record a patient's check-in response into their event history.",
  },

  // ---- MEDIUM: autonomous but flagged for clinician review. ----
  FLAG_MOOD_PATTERN: {
    actionType: "FLAG_MOOD_PATTERN",
    tier: "MEDIUM",
    description: "Flag a declining mood-score pattern for clinician awareness.",
  },
  SUGGEST_FOLLOWUP_FREQUENCY_CHANGE: {
    actionType: "SUGGEST_FOLLOWUP_FREQUENCY_CHANGE",
    tier: "MEDIUM",
    description: "Suggest increasing/decreasing check-in frequency based on engagement pattern.",
  },

  // ---- HIGH: draft only, never executes without explicit approval. ----
  ESCALATE_CRISIS: {
    actionType: "ESCALATE_CRISIS",
    tier: "HIGH",
    description: "Draft a crisis escalation for clinician review after a crisis-language flag.",
  },
  PROPOSE_CARE_PLAN_CHANGE: {
    actionType: "PROPOSE_CARE_PLAN_CHANGE",
    tier: "HIGH",
    description: "Draft a proposed change to a patient's care plan or care_stage.",
  },

  // ---- Hard blocklist (spec 4.1): never autonomous, ever. ----
  DIAGNOSE_PATIENT: {
    actionType: "DIAGNOSE_PATIENT",
    tier: "HIGH",
    description: "Diagnosing a patient. Agents may never do this, drafted or otherwise.",
    hardBlock: "never_propose",
  },
  ADJUST_MEDICATION: {
    actionType: "ADJUST_MEDICATION",
    tier: "HIGH",
    description: "Prescribing or adjusting medication. Agents may never do this, drafted or otherwise.",
    hardBlock: "never_propose",
  },
  DISCHARGE_PATIENT_AUTONOMOUSLY: {
    actionType: "DISCHARGE_PATIENT_AUTONOMOUSLY",
    tier: "HIGH",
    description: "Discharging a patient. Agents may never do this, drafted or otherwise.",
    hardBlock: "never_propose",
  },
  CONTACT_EMERGENCY_SERVICES: {
    actionType: "CONTACT_EMERGENCY_SERVICES",
    tier: "HIGH",
    description:
      "Contacting emergency services on a patient's behalf. Draft-only: a human must place the call.",
    hardBlock: "draft_and_escalate_only",
  },
};

export function getActionDefinition(actionType: string): ActionTypeDefinition {
  return (
    ACTION_REGISTRY[actionType] ?? {
      actionType,
      tier: "HIGH",
      description: DEFAULT_HIGH_TIER_DESCRIPTION,
    }
  );
}

export function isKnownActionType(actionType: string): boolean {
  return actionType in ACTION_REGISTRY;
}

export function listActionRegistry(): ActionTypeDefinition[] {
  return Object.values(ACTION_REGISTRY);
}
