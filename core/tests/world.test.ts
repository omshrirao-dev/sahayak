import { describe, it, expect } from "vitest";
import { World } from "../src/index.js";

describe("World (integration)", () => {
  it("admits a patient starting in Intake/Stable/Active", () => {
    const world = new World();
    const patient = world.admitPatient("Test Patient A");
    const snapshot = world.getSnapshot(patient.id);
    expect(snapshot.careStage).toBe("Intake");
    expect(snapshot.risk.riskLevel).toBe("Stable");
    expect(snapshot.engagement.engagementStatus).toBe("Active");
  });

  it("keeps risk_level and care_stage as genuinely independent dimensions", () => {
    const world = new World();
    const patient = world.admitPatient("Test Patient B", "Maintenance");
    world.recordEvent({
      patientId: patient.id,
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "high", reason: "explicit statement of intent", raisedBy: "agent" },
      source: "agent",
    });
    const snapshot = world.getSnapshot(patient.id);
    // Patient stays in Maintenance (care_stage untouched) while risk
    // jumps straight to Crisis -- proves the two dimensions don't
    // collapse into one linear pipeline (spec 2.1).
    expect(snapshot.careStage).toBe("Maintenance");
    expect(snapshot.risk.riskLevel).toBe("Crisis");
  });

  it("publishes every recorded event on the bus", () => {
    const world = new World();
    const patient = world.admitPatient("Test Patient C");
    const seen: string[] = [];
    world.bus.subscribe("*", (e) => seen.push(e.eventType));
    world.recordEvent({
      patientId: patient.id,
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 5, responded: true },
      source: "patient",
    });
    expect(seen).toContain("CHECK_IN_SUBMITTED");
  });

  it("rejects an illegal care_stage transition and leaves state intact", () => {
    const world = new World();
    const patient = world.admitPatient("Test Patient D", "Intake");
    const applied = world.requestCareStageTransition(patient.id, "Maintenance", "skip ahead", "clinician:1");
    expect(applied).toBe(false);
    expect(world.getCareStage(patient.id)).toBe("Intake");
  });
});
