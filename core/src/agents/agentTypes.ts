import type { World } from "../index.js";
import type { BaseEvent } from "../events/eventTypes.js";
import type { ContradictionCheckInput } from "../safety/safetyClient.js";

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
  /**
   * Edge Case 3: ids of the events this proposal is based on. For
   * MEDIUM/HIGH tier actions, the orchestrator blocks execution
   * until every one of these is fresh (see state-machine/staleness.ts).
   */
  sourceEventIds?: string[];
  /**
   * Edge Case 4: two data sources to compare via the safety
   * service's contradiction detector. If the result is CONTRADICT,
   * verify-action reports the action unsafe to proceed -- so only
   * set this on an action that SHOULD be blocked by a contradiction
   * (e.g. a care-plan change), never on the dedicated
   * contradiction-flagging agent itself, which needs to always
   * execute in order to actually surface the contradiction.
   */
  contradictionCheck?: ContradictionCheckInput;
}

export interface Agent {
  name: string;
  /** Returns zero or more proposed actions in reaction to a triggering event. */
  evaluate(
    world: World,
    patientId: string,
    triggerEvent: BaseEvent,
  ): ProposedActionDraft[] | Promise<ProposedActionDraft[]>;
}
