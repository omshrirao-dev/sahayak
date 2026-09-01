import type { World } from "../index.js";
import type { BaseEvent, PatientMessageReceivedPayload } from "../events/eventTypes.js";
import { ActionInstance, ActionRegistry } from "../actions/actionStateMachine.js";
import { IdempotencyStore } from "../actions/idempotency.js";
import { OverrideMemory } from "../actions/overrideMemory.js";
import { TriageQueue } from "../actions/triageQueue.js";
import { checkFactFreshness } from "../state-machine/staleness.js";
import { reconfirmFact as reconfirmFactEvent } from "../state-machine/staleness.js";
import { PHIAccessControl } from "../safety/phiAccessControl.js";
import { AuditLog } from "../safety/auditLog.js";
import type { SafetyClient } from "../safety/safetyClient.js";
import { getActionDefinition, type ActionTier } from "./actionSchema.js";
import type { Agent, ProposedActionDraft } from "./agentTypes.js";
import { checkInAgent } from "./checkInAgent.js";
import { patternFlagAgent } from "./patternFlagAgent.js";
import { escalationAgent } from "./escalationAgent.js";
import { createContradictionAgent } from "./contradictionAgent.js";

export type ActionExecutor = (action: ActionInstance) => Promise<unknown>;

async function defaultExecutor(action: ActionInstance): Promise<unknown> {
  return { simulated: true, actionType: action.actionType, patientId: action.patientId };
}

export interface OrchestratorDeps {
  world: World;
  safetyClient: SafetyClient;
  actionRegistry?: ActionRegistry;
  overrideMemory?: OverrideMemory;
  idempotencyStore?: IdempotencyStore;
  triageQueue?: TriageQueue;
  phiAccessControl?: PHIAccessControl;
  auditLog?: AuditLog;
  agents?: Agent[];
  executors?: Record<string, ActionExecutor>;
}

/**
 * Wires events -> agents -> tier resolution -> safety verification ->
 * action lifecycle (spec 6, "Execution"). This is the one place that
 * is allowed to decide whether an action actually runs; agents only
 * ever propose.
 */
export class Orchestrator {
  private world: World;
  private safetyClient: SafetyClient;
  readonly actionRegistry: ActionRegistry;
  readonly overrideMemory: OverrideMemory;
  readonly triageQueue: TriageQueue;
  readonly phiAccessControl: PHIAccessControl;
  readonly auditLog: AuditLog;
  private idempotencyStore: IdempotencyStore;
  private agents: Agent[];
  private executors: Record<string, ActionExecutor>;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: OrchestratorDeps) {
    this.world = deps.world;
    this.safetyClient = deps.safetyClient;
    this.actionRegistry = deps.actionRegistry ?? new ActionRegistry();
    this.overrideMemory = deps.overrideMemory ?? new OverrideMemory();
    this.idempotencyStore = deps.idempotencyStore ?? new IdempotencyStore();
    this.triageQueue = deps.triageQueue ?? new TriageQueue();
    this.phiAccessControl = deps.phiAccessControl ?? new PHIAccessControl();
    this.auditLog = deps.auditLog ?? new AuditLog(this.phiAccessControl);
    this.executors = deps.executors ?? {};
    this.agents = deps.agents ?? [
      checkInAgent,
      patternFlagAgent,
      escalationAgent,
      createContradictionAgent(this.safetyClient),
    ];
  }

  /**
   * Opt-in live wiring: subscribes to the world's event bus so every
   * published event automatically reaches handleEvent(). NOT called
   * from the constructor -- tests and seed scripts call handleEvent()
   * directly and await it for deterministic ordering; only a real
   * running process should call start() and let the bus drive things.
   */
  start(): void {
    if (this.unsubscribe) return; // already started
    this.unsubscribe = this.world.bus.subscribe("*", (event) => {
      void this.handleEvent(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async handleEvent(event: BaseEvent): Promise<ActionInstance[]> {
    const created: ActionInstance[] = [];

    // Edge Case 1 (crisis false negative): a dedicated, conservative
    // classifier runs on EVERY inbound patient message, unconditionally
    // -- not gated on any agent deciding to check. This is what makes
    // it a redundant safety net rather than a single point of failure.
    if (event.eventType === "PATIENT_MESSAGE_RECEIVED") {
      const payload = event.payload as unknown as PatientMessageReceivedPayload;
      const crisisResult = await this.safetyClient.checkCrisis(payload.text);
      if (crisisResult.is_crisis) {
        const flagEvent = this.world.recordEvent({
          patientId: event.patientId,
          eventType: "CRISIS_FLAG_RAISED",
          payload: {
            severity: crisisResult.probability >= 0.9 ? "high" : "medium",
            reason: crisisResult.reasoning,
            raisedBy: "agent",
          },
          source: "agent",
        });

        // Edge Case 2 (false positives): route to the FAST triage
        // queue for a quick confirm/dismiss, not straight into a
        // full escalation review. We enqueue before recursing into
        // handleEvent() so the queue entry exists even if downstream
        // processing throws.
        const nested = await this.handleEvent(flagEvent);
        const escalation = nested.find((a) => a.actionType === "ESCALATE_CRISIS");
        if (escalation) {
          this.triageQueue.enqueue({
            patientId: event.patientId,
            crisisFlagEventId: flagEvent.id,
            escalationActionId: escalation.id,
            matchedPattern: crisisResult.matched_keyword,
            probability: crisisResult.probability,
          });
        }
        created.push(...nested);
      }
    }

    // Edge Case 5: a crisis flag is a HIGH-priority event. Supersede
    // every non-terminal action already in flight for this patient
    // BEFORE agents get a chance to propose anything new, so a
    // stale LOW/MEDIUM action can never execute against
    // now-outdated context.
    if (event.eventType === "CRISIS_FLAG_RAISED") {
      this.actionRegistry.supersedeAllInFlightForPatient(
        event.patientId,
        `Superseded by crisis flag (event ${event.id})`,
        "system",
      );
    }

    for (const agent of this.agents) {
      const drafts = await agent.evaluate(this.world, event.patientId, event);
      for (const draft of drafts) {
        const action = await this.proposeAndRoute(agent.name, event.patientId, draft, event.id);
        if (action) created.push(action);
      }
    }
    return created;
  }

  private resolveTier(patientId: string, draft: ProposedActionDraft): {
    tier: ActionTier;
    hardBlocked: boolean;
    requiresImmediateEscalation: boolean;
  } {
    const definition = getActionDefinition(draft.actionType);

    if (definition.hardBlock === "never_propose") {
      return { tier: definition.tier, hardBlocked: true, requiresImmediateEscalation: false };
    }

    let tier = definition.tier;
    // Self-correcting downgrade rule (spec 2.2): 2+ consecutive
    // clinician overrides of this (patient, actionType) pair force
    // it back to HIGH until a human manually restores autonomy.
    if (tier === "MEDIUM" && this.overrideMemory.isDowngraded(patientId, draft.actionType)) {
      tier = "HIGH";
    }

    const requiresImmediateEscalation = definition.hardBlock === "draft_and_escalate_only";
    if (requiresImmediateEscalation) {
      tier = "HIGH";
    }

    return { tier, hardBlocked: false, requiresImmediateEscalation };
  }

  /**
   * Edge Case 3 (memory drift): for a MEDIUM/HIGH-tier proposal that
   * names its source facts, every one of them must be fresh (see
   * state-machine/staleness.ts) before the action may execute. LOW
   * tier is exempt -- those actions are routine/templated and don't
   * lean on judgment calls about older facts.
   */
  private checkSourceFreshness(patientId: string, tier: ActionTier, sourceEventIds?: string[]): string[] {
    if (tier === "LOW" || !sourceEventIds || sourceEventIds.length === 0) return [];
    const patientEvents = this.world.store.getByPatient(patientId);
    const staleNotes: string[] = [];
    for (const id of sourceEventIds) {
      const event = patientEvents.find((e) => e.id === id);
      if (!event) continue; // nothing to check freshness of if the source event isn't found
      const freshness = checkFactFreshness(event, patientEvents);
      if (freshness.isStale) {
        staleNotes.push(`Event ${id} is stale: ${freshness.reason}`);
      }
    }
    return staleNotes;
  }

  /**
   * Turns one agent's proposal into a real ActionInstance, verifies
   * it with the safety service, and -- for LOW/MEDIUM tiers that
   * pass verification -- executes it immediately. HIGH-tier actions
   * (and anything that fails safety verification or freshness
   * checks, regardless of tier) stay in "proposed" and wait for
   * approveAction()/overrideAction() from a human.
   */
  async proposeAndRoute(
    agentName: string,
    patientId: string,
    draft: ProposedActionDraft,
    /**
     * Id of the event that triggered this proposal, when there is
     * one (there always is via handleEvent(); direct callers/tests
     * may omit it). Anchoring the idempotency key to the triggering
     * event -- rather than to the drafted payload's content -- means
     * two genuinely different real-world occurrences that happen to
     * produce textually identical drafts (e.g. the same mood-score
     * pattern recurring weeks apart) never collide, while retries of
     * the SAME failed attempt for the SAME event still correctly
     * dedupe.
     */
    triggerEventId?: string,
  ): Promise<ActionInstance | null> {
    const { tier, hardBlocked, requiresImmediateEscalation } = this.resolveTier(patientId, draft);
    if (hardBlocked) {
      // Hard blocklist (spec 4.1): the action is never even drafted.
      return null;
    }

    const idempotencyKey = `${patientId}:${draft.actionType}:${triggerEventId ?? JSON.stringify(draft.payload)}`;
    const action = this.actionRegistry.propose({
      patientId,
      actionType: draft.actionType,
      tier,
      proposedBy: agentName,
      payload: draft.payload,
      idempotencyKey,
      requiresImmediateEscalation,
    });

    // Edge Case 7: the reasoning behind this proposal is written to
    // the same access-controlled, encrypted store as PHI -- never a
    // plain console.log or an unguarded log line.
    this.auditLog.writeReasoningTrace(patientId, agentName, draft.reason);

    const staleFacts = this.checkSourceFreshness(patientId, tier, draft.sourceEventIds);
    if (staleFacts.length > 0) {
      action.flaggedForReview = true;
      action.blockRecord = { reason: "stale_facts", details: staleFacts };
      return action; // Edge Case 3: never execute on unconfirmed stale facts
    }

    const safetyResult = await this.safetyClient.verifyAction({
      action_type: draft.actionType,
      tier,
      drafted_text: draft.draftedText,
      inbound_patient_text: draft.inboundPatientText,
      contradiction_check: draft.contradictionCheck,
    });

    if (!safetyResult.safe_to_proceed) {
      // Never silently execute something the safety service flagged
      // -- regardless of tier, it stays "proposed" for a human.
      action.flaggedForReview = true;
      action.blockRecord = { reason: "safety_service", details: safetyResult.blocking_reasons };
      return action;
    }

    if (tier === "HIGH" || requiresImmediateEscalation) {
      return action; // draft only, per spec 2.2
    }

    if (tier === "MEDIUM") {
      action.flaggedForReview = true; // autonomous, but always surfaced
    }

    await this.executeAction(action, "system");
    return action;
  }

  /** Clinician approves a HIGH-tier (or otherwise still-proposed) action -- it now executes. */
  async approveAction(actionId: string, by: string): Promise<ActionInstance> {
    const action = this.requireAction(actionId);
    action.approve(by);
    this.overrideMemory.recordConfirmation(action.patientId, action.actionType);
    await this.executeAction(action, by);
    return action;
  }

  /**
   * Clinician overrides/rejects an action and records permanent
   * context (Edge Case 8). For a still-in-flight action (HIGH-tier
   * drafts, mainly) this cancels it. A LOW/MEDIUM action may have
   * already auto-executed to completion by the time a clinician
   * reviews it -- there's nothing left to cancel, so we annotate the
   * completed action instead. Either way, the override itself is
   * always recorded in OverrideMemory, which is what actually drives
   * the self-correcting downgrade rule.
   */
  overrideAction(actionId: string, by: string, reason: string): ActionInstance {
    const action = this.requireAction(actionId);
    this.overrideMemory.recordOverride(action.patientId, action.actionType, by, reason, action.tier);
    if (action.isTerminal) {
      action.annotateOverrideAfterCompletion(by, reason);
    } else {
      action.cancel(reason, by);
    }
    return action;
  }

  /**
   * Edge Case 3: records an explicit reconfirmation of a stale fact.
   * Does not retroactively un-block any already-blocked action --
   * the agent needs to re-propose (e.g. via a fresh handleEvent()
   * call, or by re-running proposeAndRoute with the same draft),
   * which will then find the fact fresh.
   */
  reconfirmFact(patientId: string, originalEventId: string, by: string, note?: string): ReturnType<typeof reconfirmFactEvent> {
    return reconfirmFactEvent(this.world.store, patientId, originalEventId, by, note);
  }

  /** Edge Case 2: clinician confirms a fast-triage crisis flag was a genuine positive -- the drafted escalation proceeds. */
  async confirmCrisisFlag(triageItemId: string, by: string): Promise<ActionInstance> {
    const item = this.triageQueue.confirm(triageItemId, by);
    return this.approveAction(item.escalationActionId, by);
  }

  /** Edge Case 2: clinician dismisses a fast-triage crisis flag as a false positive -- recorded per-pattern for recalibration. */
  dismissCrisisFlag(triageItemId: string, by: string, note = "Dismissed as false positive via fast triage"): ActionInstance {
    const item = this.triageQueue.dismiss(triageItemId, by);
    return this.overrideAction(item.escalationActionId, by, note);
  }

  /** Edge Case 7: reads a reasoning trace under the same access control as the underlying patient record. */
  readReasoningTrace(entryId: string, requesterId: string): string {
    return this.auditLog.readReasoningTrace(entryId, requesterId);
  }

  private requireAction(actionId: string): ActionInstance {
    const action = this.actionRegistry.getById(actionId);
    if (!action) throw new Error(`Unknown action: ${actionId}`);
    return action;
  }

  private async executeAction(action: ActionInstance, by: string): Promise<void> {
    if (action.status === "proposed") action.approve(by);
    action.startExecuting(by);
    const executor = this.executors[action.actionType] ?? defaultExecutor;
    try {
      const result = await this.idempotencyStore.run({
        key: action.idempotencyKey,
        // Edge Case 6: no external state to check for the simulated
        // default executor. A real executor (e.g. EHR update) should
        // supply verifyCurrentState to check before ever calling
        // execute() again for the same key.
        verifyCurrentState: async () => null,
        execute: () => executor(action),
      });
      action.complete(result, by);
    } catch (err) {
      action.cancel(`Execution failed: ${err instanceof Error ? err.message : String(err)}`, "system");
    }
  }
}
