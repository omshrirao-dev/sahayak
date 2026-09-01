import type { World } from "../index.js";
import type { BaseEvent } from "../events/eventTypes.js";

/**
 * What an agent hands back to the orchestrator: an intent to act,
 * not yet a real ActionInstance. The orchestrator is solely
 * responsible for tier resolution (including override-driven
 * downgrades), safety verification, and lifecycle management --
 * agents never decide their own autonomy level.
 */
export interface ProposedActionDraft {
  actionType: string;
  payload: Record<string, unknown>;
  reason: string;
  /** Patient-facing or clinician-facing text, if any -- goes through the trust classifier. */
  draftedText?: string;
  /** The inbound patient text that triggered this proposal, if any -- goes through crisis + injection checks. */
  inboundPatientText?: string;
}

export interface Agent {
  name: string;
  /** Returns zero or more proposed actions in reaction to a triggering event. */
  evaluate(world: World, patientId: string, triggerEvent: BaseEvent): ProposedActionDraft[];
}
