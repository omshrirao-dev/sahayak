import { randomUUID } from "node:crypto";
import type { ActionTier } from "../agents/actionSchema.js";

/**
 * Edge Case 5 (action invalidated by new information): actions are
 * NOT append-only log entries. They carry a real lifecycle so a
 * HIGH-priority event (e.g. a crisis flag) arriving while a lower-
 * priority action is in-flight can supersede or cancel it instead of
 * letting it execute against stale context.
 */
export type ActionStatus = "proposed" | "approved" | "executing" | "completed" | "superseded" | "cancelled";

const TERMINAL_STATUSES: ActionStatus[] = ["completed", "superseded", "cancelled"];

/** proposed -> approved -> executing -> completed, with cancel/supersede possible from any non-terminal state. */
const ALLOWED_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  proposed: ["approved", "cancelled", "superseded"],
  approved: ["executing", "cancelled", "superseded"],
  executing: ["completed", "cancelled", "superseded"],
  completed: [],
  superseded: [],
  cancelled: [],
};

export interface ActionHistoryEntry {
  status: ActionStatus;
  at: string;
  by: string;
  note?: string;
}

export interface ActionInstanceInit {
  patientId: string;
  actionType: string;
  tier: ActionTier;
  proposedBy: string; // agent name, e.g. "checkInAgent"
  payload: Record<string, unknown>;
  idempotencyKey: string;
  /** True only for the hard-blocklist "draft_and_escalate_only" case. */
  requiresImmediateEscalation?: boolean;
  /** True when a MEDIUM-tier action executes autonomously but still needs clinician eyes. */
  flaggedForReview?: boolean;
}

/**
 * A single proposed/in-flight/completed action. Mutates its own
 * status through guarded transitions -- illegal transitions throw
 * rather than silently no-op, since callers (the orchestrator) need
 * to know immediately if they're trying something the lifecycle
 * doesn't allow (e.g. approving an already-cancelled action).
 */
export class ActionInstance {
  readonly id: string;
  readonly patientId: string;
  readonly actionType: string;
  readonly tier: ActionTier;
  readonly proposedBy: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly requiresImmediateEscalation: boolean;
  flaggedForReview: boolean;
  status: ActionStatus = "proposed";
  result: unknown = undefined;
  readonly history: ActionHistoryEntry[];
  readonly createdAt: string;

  constructor(init: ActionInstanceInit) {
    this.id = randomUUID();
    this.patientId = init.patientId;
    this.actionType = init.actionType;
    this.tier = init.tier;
    this.proposedBy = init.proposedBy;
    this.payload = init.payload;
    this.idempotencyKey = init.idempotencyKey;
    this.requiresImmediateEscalation = init.requiresImmediateEscalation ?? false;
    this.flaggedForReview = init.flaggedForReview ?? false;
    this.createdAt = new Date().toISOString();
    this.history = [{ status: "proposed", at: this.createdAt, by: init.proposedBy }];
  }

  get isTerminal(): boolean {
    return TERMINAL_STATUSES.includes(this.status);
  }

  private transition(to: ActionStatus, by: string, note?: string): void {
    const allowed = ALLOWED_TRANSITIONS[this.status];
    if (!allowed.includes(to)) {
      throw new Error(
        `Illegal action transition for ${this.id}: ${this.status} -> ${to} (allowed: ${allowed.join(", ") || "none, terminal"})`,
      );
    }
    this.status = to;
    this.history.push({ status: to, at: new Date().toISOString(), by, note });
  }

  approve(by: string, note?: string): void {
    this.transition("approved", by, note);
  }

  startExecuting(by = "system"): void {
    this.transition("executing", by);
  }

  complete(result: unknown, by = "system"): void {
    this.result = result;
    this.transition("completed", by);
  }

  cancel(reason: string, by: string): void {
    this.transition("cancelled", by, reason);
  }

  /** Edge Case 5: a higher-priority event invalidates this action. */
  supersede(reason: string, by = "system"): void {
    this.transition("superseded", by, reason);
  }

  /**
   * Records that a clinician overrode this action AFTER it already
   * completed (only possible for LOW/MEDIUM, which auto-execute).
   * There's no "cancel" for something that already happened -- this
   * just appends an audit-trail note without touching `status`, so
   * the override is still visible on the action's own history in
   * addition to being recorded in OverrideMemory.
   */
  annotateOverrideAfterCompletion(by: string, reason: string): void {
    this.history.push({ status: this.status, at: new Date().toISOString(), by, note: `Overridden after completion: ${reason}` });
  }
}

export class ActionRegistry {
  private actions = new Map<string, ActionInstance>();

  propose(init: ActionInstanceInit): ActionInstance {
    const action = new ActionInstance(init);
    this.actions.set(action.id, action);
    return action;
  }

  getById(id: string): ActionInstance | undefined {
    return this.actions.get(id);
  }

  getByPatient(patientId: string): ActionInstance[] {
    return [...this.actions.values()]
      .filter((a) => a.patientId === patientId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getAll(): ActionInstance[] {
    return [...this.actions.values()];
  }

  /**
   * Edge Case 5: called when a HIGH-priority event (e.g. a crisis
   * flag) arrives for a patient. Supersedes every non-terminal
   * action for that patient EXCEPT ones matching `exceptActionId`
   * (typically the new escalation action itself, if already
   * created) so the new higher-priority action isn't accidentally
   * superseded by its own trigger.
   */
  supersedeAllInFlightForPatient(
    patientId: string,
    reason: string,
    by = "system",
    exceptActionId?: string,
  ): ActionInstance[] {
    const superseded: ActionInstance[] = [];
    for (const action of this.getByPatient(patientId)) {
      if (action.id === exceptActionId || action.isTerminal) continue;
      action.supersede(reason, by);
      superseded.push(action);
    }
    return superseded;
  }
}
