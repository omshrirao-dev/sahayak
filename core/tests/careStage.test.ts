import { describe, it, expect } from "vitest";
import { CareStageService } from "../src/state-machine/careStage.js";

describe("CareStageService", () => {
  it("starts at Intake by default", () => {
    const svc = new CareStageService("p1");
    expect(svc.currentStage).toBe("Intake");
  });

  it("allows the legal Intake -> Active Care -> Maintenance -> Discharged path", () => {
    const svc = new CareStageService("p1");
    expect(svc.requestTransition("Active Care", "starting treatment", "clinician:1")).toBe(true);
    expect(svc.currentStage).toBe("Active Care");
    expect(svc.requestTransition("Maintenance", "stabilized", "clinician:1")).toBe(true);
    expect(svc.currentStage).toBe("Maintenance");
    expect(svc.requestTransition("Discharged", "completed care", "clinician:1")).toBe(true);
    expect(svc.currentStage).toBe("Discharged");
  });

  it("allows relapse from Maintenance back to Active Care", () => {
    const svc = new CareStageService("p1", "Maintenance");
    expect(svc.requestTransition("Active Care", "relapse", "agent:pattern-flag")).toBe(true);
    expect(svc.currentStage).toBe("Active Care");
  });

  it("rejects illegal transitions and leaves state unchanged", () => {
    const svc = new CareStageService("p1", "Intake");
    expect(svc.requestTransition("Maintenance", "skip ahead", "clinician:1")).toBe(false);
    expect(svc.currentStage).toBe("Intake");
  });

  it("rejects any transition out of Discharged (terminal state)", () => {
    const svc = new CareStageService("p1", "Discharged");
    expect(svc.requestTransition("Active Care", "re-admit", "clinician:1")).toBe(false);
    expect(svc.currentStage).toBe("Discharged");
  });

  it("records history only for applied transitions", () => {
    const svc = new CareStageService("p1", "Intake");
    svc.requestTransition("Maintenance", "illegal skip", "clinician:1"); // rejected
    svc.requestTransition("Active Care", "legal", "clinician:1"); // applied
    const history = svc.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStage: "Intake", toStage: "Active Care" });
  });
});
