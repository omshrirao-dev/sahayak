import { describe, it, expect } from "vitest";
import { World } from "../src/index.js";
import { Orchestrator } from "../src/agents/orchestrator.js";
import type { Agent, ProposedActionDraft } from "../src/agents/agentTypes.js";
import type { SafetyClient, VerifyActionInput, VerifyActionResult } from "../src/safety/safetyClient.js";

class FakeSafetyClient implements SafetyClient {
  calls: VerifyActionInput[] = [];
  private safeOverride: boolean | null = null;

  setSafe(safe: boolean) {
    this.safeOverride = safe;
  }

  async verifyAction(input: VerifyActionInput): Promise<VerifyActionResult> {
    this.calls.push(input);
    const safe = this.safeOverride ?? true;
    return {
      safe_to_proceed: safe,
      blocking_reasons: safe ? [] : ["fake block"],
      trust: null,
      crisis: null,
      injection: null,
      contradiction: null,
    };
  }
}

function makeOrchestrator(safety = new FakeSafetyClient()) {
  const world = new World();
  const orchestrator = new Orchestrator({ world, safetyClient: safety });
  return { world, orchestrator, safety };
}

describe("Orchestrator: tier enforcement", () => {
  it("LOW-tier actions auto-execute to completion when safety passes", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test A");
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "CHECK_IN_MISSED",
      payload: { scheduledFor: new Date().toISOString() },
      source: "system",
    });

    const actions = await orchestrator.handleEvent(event);
    const reminder = actions.find((a) => a.actionType === "SEND_CHECK_IN_REMINDER")!;
    expect(reminder.tier).toBe("LOW");
    expect(reminder.status).toBe("completed");
    expect(safety.calls).toHaveLength(actions.length);
  });

  it("MEDIUM-tier actions auto-execute but stay flagged for clinician review", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test B");
    world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: "2026-01-01T00:00:00.000Z" });
    world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: "2026-01-02T00:00:00.000Z" });
    const last = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: "2026-01-03T00:00:00.000Z" });

    const actions = await orchestrator.handleEvent(last);
    const flag = actions.find((a) => a.actionType === "FLAG_MOOD_PATTERN")!;
    expect(flag.tier).toBe("MEDIUM");
    expect(flag.status).toBe("completed");
    expect(flag.flaggedForReview).toBe(true);
  });

  it("HIGH-tier actions are drafted only and never auto-execute", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test C");
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "high", reason: "explicit statement", raisedBy: "agent" },
      source: "agent",
    });

    const actions = await orchestrator.handleEvent(event);
    const escalation = actions.find((a) => a.actionType === "ESCALATE_CRISIS")!;
    expect(escalation.tier).toBe("HIGH");
    expect(escalation.status).toBe("proposed"); // draft only
  });

  it("a HIGH-tier action executes only after explicit clinician approval", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test D");
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "high", reason: "explicit statement", raisedBy: "agent" },
      source: "agent",
    });
    const [escalation] = await orchestrator.handleEvent(event);
    expect(escalation!.status).toBe("proposed");

    const approved = await orchestrator.approveAction(escalation!.id, "clinician:1");
    expect(approved.status).toBe("completed");
  });

  it("never proposes a hard-blocklisted action at all", async () => {
    const neverProposeAgent: Agent = {
      name: "rogueAgent",
      evaluate(): ProposedActionDraft[] {
        return [{ actionType: "DIAGNOSE_PATIENT", payload: {}, reason: "should never be created" }];
      },
    };
    const world = new World();
    const safety = new FakeSafetyClient();
    const orchestrator = new Orchestrator({ world, safetyClient: safety, agents: [neverProposeAgent] });
    const patient = world.admitPatient("Test E");
    const event = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_MISSED", payload: {}, source: "system" });

    const actions = await orchestrator.handleEvent(event);
    expect(actions).toHaveLength(0);
    expect(orchestrator.actionRegistry.getByPatient(patient.id)).toHaveLength(0);
    expect(safety.calls).toHaveLength(0); // never even reaches the safety service
  });

  it("contact-emergency-services is always a HIGH-tier draft, even though it's hard-blocked from full autonomy", async () => {
    const escalationOnlyAgent: Agent = {
      name: "emergencyAgent",
      evaluate(): ProposedActionDraft[] {
        return [{ actionType: "CONTACT_EMERGENCY_SERVICES", payload: {}, reason: "imminent danger" }];
      },
    };
    const world = new World();
    const safety = new FakeSafetyClient();
    const orchestrator = new Orchestrator({ world, safetyClient: safety, agents: [escalationOnlyAgent] });
    const patient = world.admitPatient("Test F");
    const event = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_MISSED", payload: {}, source: "system" });

    const [action] = await orchestrator.handleEvent(event);
    expect(action!.tier).toBe("HIGH");
    expect(action!.requiresImmediateEscalation).toBe(true);
    expect(action!.status).toBe("proposed");
  });
});

describe("Orchestrator: safety-service integration", () => {
  it("never executes an action the safety service flags as unsafe, regardless of tier", async () => {
    const safety = new FakeSafetyClient();
    safety.setSafe(false);
    const { world, orchestrator } = makeOrchestrator(safety);
    const patient = world.admitPatient("Test G");
    const event = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_MISSED", payload: {}, source: "system" });

    const [action] = await orchestrator.handleEvent(event);
    expect(action!.tier).toBe("LOW"); // tier itself is unaffected
    expect(action!.status).toBe("proposed"); // but it never got to execute
    expect(action!.flaggedForReview).toBe(true);
  });

  it("passes the drafted text and tier through to the safety client", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test H");
    const event = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_MISSED", payload: {}, source: "system" });

    await orchestrator.handleEvent(event);
    expect(safety.calls[0]).toMatchObject({ action_type: "SEND_CHECK_IN_REMINDER", tier: "LOW" });
    expect(safety.calls[0]!.drafted_text).toBeTruthy();
  });
});

describe("Orchestrator: Edge Case 5 -- action invalidated by new information", () => {
  it("supersedes a lower-priority in-flight action when a crisis flag arrives", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test I");

    // Propose a HIGH-tier action first so it stays "proposed" (in-flight).
    const firstEvent = world.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_MESSAGE_RECEIVED",
      payload: { text: "some earlier flagged message", crisisClassifierFlag: true },
      source: "patient",
    });
    world.recordEvent({
      patientId: patient.id,
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "low", reason: "earlier flag", raisedBy: "agent" },
      source: "agent",
    });
    const [firstAction] = await orchestrator.handleEvent(firstEvent);
    expect(firstAction!.status).toBe("proposed");

    // A second, higher-severity crisis flag arrives.
    const secondFlag = world.recordEvent({
      patientId: patient.id,
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "high", reason: "new explicit statement", raisedBy: "agent" },
      source: "agent",
    });
    await orchestrator.handleEvent(secondFlag);

    expect(firstAction!.status).toBe("superseded");
  });
});

describe("Orchestrator: overrides and self-correcting downgrade (Edge Case 8 + spec 2.2)", () => {
  it("overriding a proposed action cancels it and records permanent context", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test J");
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "low", reason: "borderline flag", raisedBy: "agent" },
      source: "agent",
    });
    const [action] = await orchestrator.handleEvent(event);

    const result = orchestrator.overrideAction(action!.id, "clinician:1", "false positive, sarcasm");
    expect(result.status).toBe("cancelled");
    expect(orchestrator.overrideMemory.getOverrideHistory(patient.id, "ESCALATE_CRISIS")).toHaveLength(1);
  });

  it("downgrades a MEDIUM action type to HIGH after 2 consecutive overrides for that patient", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test K");

    const baseMs = new Date("2026-01-01T00:00:00.000Z").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    let dayCounter = 0;
    function nextDayIso(): string {
      dayCounter += 1;
      return new Date(baseMs + dayCounter * dayMs).toISOString();
    }
    function recordMood(moodScore: number) {
      return world.recordEvent({
        patientId: patient.id,
        eventType: "CHECK_IN_SUBMITTED",
        payload: { moodScore, responded: true },
        source: "patient",
        occurredAt: nextDayIso(),
      });
    }
    async function triggerPatternFlag() {
      recordMood(8);
      recordMood(5);
      const last = recordMood(3);
      return orchestrator.handleEvent(last);
    }

    const round1 = await triggerPatternFlag();
    const flag1 = round1.find((a) => a.actionType === "FLAG_MOOD_PATTERN")!;
    expect(flag1.tier).toBe("MEDIUM");
    orchestrator.overrideAction(flag1.id, "clinician:1", "not relevant, noise");

    // Force risk back to Watch for a second round by re-declining after a stable blip.
    recordMood(9);
    const round2 = await triggerPatternFlag();
    const flag2 = round2.find((a) => a.actionType === "FLAG_MOOD_PATTERN")!;
    expect(flag2.tier).toBe("MEDIUM");
    orchestrator.overrideAction(flag2.id, "clinician:1", "still not relevant");

    expect(orchestrator.overrideMemory.isDowngraded(patient.id, "FLAG_MOOD_PATTERN")).toBe(true);

    recordMood(9);
    const round3 = await triggerPatternFlag();
    const flag3 = round3.find((a) => a.actionType === "FLAG_MOOD_PATTERN")!;
    expect(flag3.tier).toBe("HIGH"); // downgraded -- now requires explicit approval
    expect(flag3.status).toBe("proposed");
  });
});
