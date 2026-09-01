import { createMachine, createActor, type Actor } from "xstate";

/**
 * care_stage is the one world-state dimension stored as an explicit
 * field (see db/schema.sql) rather than computed live from events --
 * it changes slowly and clinicians reason about it directly.
 *
 * XState gives us an explicit, visualizable, testable machine and
 * -- critically -- a place to put transition GUARDS so illegal
 * jumps (e.g. Discharged -> Intake) are rejected at the model layer,
 * not left to callers to remember.
 */
export type CareStage = "Intake" | "Active Care" | "Maintenance" | "Discharged";

export interface CareStageContext {
  patientId: string;
}

export interface CareStageHistoryEntry {
  fromStage: CareStage | null;
  toStage: CareStage;
  reason: string;
  changedBy: string;
  changedAt: string;
}

export type CareStageEvent = {
  type: "TRANSITION";
  toStage: CareStage;
  reason: string;
  changedBy: string;
};

export function createCareStageMachine(patientId: string, initialStage: CareStage = "Intake") {
  return createMachine({
    id: `care-stage-${patientId}`,
    types: {} as {
      context: CareStageContext;
      events: CareStageEvent;
    },
    context: { patientId },
    initial: initialStage,
    states: {
      Intake: {
        on: {
          TRANSITION: [
            {
              guard: ({ event }) => event.toStage === "Active Care",
              target: "Active Care",
            },
            {
              guard: ({ event }) => event.toStage === "Discharged",
              target: "Discharged",
            },
          ],
        },
      },
      "Active Care": {
        on: {
          TRANSITION: [
            { guard: ({ event }) => event.toStage === "Maintenance", target: "Maintenance" },
            { guard: ({ event }) => event.toStage === "Discharged", target: "Discharged" },
          ],
        },
      },
      Maintenance: {
        on: {
          TRANSITION: [
            { guard: ({ event }) => event.toStage === "Active Care", target: "Active Care" },
            { guard: ({ event }) => event.toStage === "Discharged", target: "Discharged" },
          ],
        },
      },
      Discharged: {
        type: "final",
      },
    },
  });
}

/**
 * Wraps an XState actor for a single patient's care_stage and keeps
 * the append-only history array (mirrors care_stage_history in the
 * DB schema). Illegal transitions are silently rejected by XState's
 * guards (no matching transition = no state change); callers should
 * check `didTransition` to know whether the request took effect.
 */
export class CareStageService {
  private actor: Actor<ReturnType<typeof createCareStageMachine>>;
  private history: CareStageHistoryEntry[] = [];

  constructor(
    private patientId: string,
    initialStage: CareStage = "Intake",
  ) {
    const machine = createCareStageMachine(patientId, initialStage);
    this.actor = createActor(machine);
    this.actor.start();
  }

  get currentStage(): CareStage {
    return this.actor.getSnapshot().value as CareStage;
  }

  getHistory(): CareStageHistoryEntry[] {
    return [...this.history];
  }

  /** Returns true if the transition was legal and applied. */
  requestTransition(toStage: CareStage, reason: string, changedBy: string): boolean {
    const fromStage = this.currentStage;
    if (this.actor.getSnapshot().status === "done") {
      // Discharged is terminal; the actor has already stopped and
      // sending it an event would just warn to stderr for nothing.
      return false;
    }
    this.actor.send({ type: "TRANSITION", toStage, reason, changedBy });
    const applied = this.currentStage === toStage && fromStage !== toStage;
    if (applied) {
      this.history.push({
        fromStage,
        toStage,
        reason,
        changedBy,
        changedAt: new Date().toISOString(),
      });
    }
    return applied;
  }
}
