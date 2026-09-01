import { describe, it, expect } from "vitest";
import { ActionRegistry } from "../src/actions/actionStateMachine.js";

function propose(registry: ActionRegistry, patientId = "p1") {
  return registry.propose({
    patientId,
    actionType: "FLAG_MOOD_PATTERN",
    tier: "MEDIUM",
    proposedBy: "patternFlagAgent",
    payload: {},
    idempotencyKey: `${patientId}:FLAG_MOOD_PATTERN:1`,
  });
}

describe("ActionInstance lifecycle", () => {
  it("starts proposed and walks the full happy path", () => {
    const registry = new ActionRegistry();
    const action = propose(registry);
    expect(action.status).toBe("proposed");
    action.approve("clinician:1");
    expect(action.status).toBe("approved");
    action.startExecuting();
    expect(action.status).toBe("executing");
    action.complete({ ok: true });
    expect(action.status).toBe("completed");
    expect(action.isTerminal).toBe(true);
  });

  it("rejects illegal transitions", () => {
    const registry = new ActionRegistry();
    const action = propose(registry);
    expect(() => action.startExecuting()).toThrow(/Illegal action transition/);
    expect(() => action.complete({})).toThrow(/Illegal action transition/);
  });

  it("rejects any transition once terminal", () => {
    const registry = new ActionRegistry();
    const action = propose(registry);
    action.cancel("clinician rejected", "clinician:1");
    expect(action.isTerminal).toBe(true);
    expect(() => action.approve("clinician:1")).toThrow(/Illegal action transition/);
  });

  it("records a full history entry per transition", () => {
    const registry = new ActionRegistry();
    const action = propose(registry);
    action.approve("clinician:1", "looks right");
    expect(action.history).toHaveLength(2);
    expect(action.history[1]).toMatchObject({ status: "approved", by: "clinician:1", note: "looks right" });
  });
});

describe("ActionRegistry.supersedeAllInFlightForPatient (Edge Case 5)", () => {
  it("supersedes non-terminal actions for a patient when a higher-priority event arrives", () => {
    const registry = new ActionRegistry();
    const a = propose(registry, "p1");
    const b = registry.propose({
      patientId: "p1",
      actionType: "SEND_CHECK_IN_REMINDER",
      tier: "LOW",
      proposedBy: "checkInAgent",
      payload: {},
      idempotencyKey: "p1:SEND_CHECK_IN_REMINDER:1",
    });
    const alreadyDone = propose(registry, "p1");
    alreadyDone.approve("clinician:1");
    alreadyDone.startExecuting();
    alreadyDone.complete({});

    const superseded = registry.supersedeAllInFlightForPatient("p1", "crisis flag arrived", "system");

    expect(superseded.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(a.status).toBe("superseded");
    expect(b.status).toBe("superseded");
    expect(alreadyDone.status).toBe("completed"); // terminal actions are left alone
  });

  it("does not touch actions belonging to other patients", () => {
    const registry = new ActionRegistry();
    const other = propose(registry, "p2");
    registry.supersedeAllInFlightForPatient("p1", "reason", "system");
    expect(other.status).toBe("proposed");
  });

  it("can exclude a specific action id (e.g. the new escalation action itself)", () => {
    const registry = new ActionRegistry();
    const inFlight = propose(registry, "p1");
    const escalation = propose(registry, "p1");
    registry.supersedeAllInFlightForPatient("p1", "reason", "system", escalation.id);
    expect(inFlight.status).toBe("superseded");
    expect(escalation.status).toBe("proposed");
  });
});
