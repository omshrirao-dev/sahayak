import { describe, it, expect } from "vitest";
import { World } from "../src/index.js";
import { Orchestrator } from "../src/agents/orchestrator.js";
import { FakeSafetyClient } from "./helpers/fakeSafetyClient.js";

function makeOrchestrator(safety = new FakeSafetyClient()) {
  const world = new World();
  const orchestrator = new Orchestrator({ world, safetyClient: safety });
  return { world, orchestrator, safety };
}

describe("Edge Case 1 -- crisis language false negative", () => {
  it("runs the crisis classifier on EVERY inbound patient message, unconditionally", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test EC1-A");

    safety.setCrisis({ is_crisis: true, probability: 0.7, reasoning: "fake: indirect crisis language" });
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_MESSAGE_RECEIVED",
      payload: { text: "I've stopped making plans because I won't be around much longer." },
      source: "patient",
    });

    const actions = await orchestrator.handleEvent(event);

    // The classifier ran unconditionally on this message -- no agent
    // needed to first decide "this looks worth checking." The
    // resulting CRISIS_FLAG_RAISED event is what escalationAgent
    // then reacts to, independent of any per-message agent judgment.
    const escalation = actions.find((a) => a.actionType === "ESCALATE_CRISIS");
    expect(escalation).toBeDefined();
    expect(escalation!.tier).toBe("HIGH");
    expect(escalation!.status).toBe("proposed");

    const riskAfter = world.getRiskLevel(patient.id);
    expect(riskAfter.riskLevel).toBe("Crisis");
  });

  it("produces no crisis flag or escalation when the classifier finds nothing", async () => {
    const { world, orchestrator } = makeOrchestrator(); // default fake: never flags crisis
    const patient = world.admitPatient("Test EC1-B");
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_MESSAGE_RECEIVED",
      payload: { text: "Had a pretty good week overall." },
      source: "patient",
    });

    const actions = await orchestrator.handleEvent(event);
    expect(actions.find((a) => a.actionType === "ESCALATE_CRISIS")).toBeUndefined();
    expect(world.getRiskLevel(patient.id).riskLevel).toBe("Stable");
  });
});

describe("Edge Case 2 -- crisis false positive routes to fast triage, not a full alarm", () => {
  it("enqueues a fast-triage item instead of only creating a full escalation", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test EC2-A");

    safety.setCrisis({ is_crisis: true, probability: 0.4, matched_keyword: null, reasoning: "fake: ML-only, borderline" });
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_MESSAGE_RECEIVED",
      payload: { text: "Ugh, I could just die of embarrassment from that meeting." },
      source: "patient",
    });
    await orchestrator.handleEvent(event);

    const pending = orchestrator.triageQueue.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.patientId).toBe(patient.id);
  });

  it("dismissing a fast-triage item cancels the escalation and records a false positive for that pattern", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test EC2-B");

    safety.setCrisis({ is_crisis: true, probability: 0.55, matched_keyword: "die", reasoning: "fake: matched 'die'" });
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_MESSAGE_RECEIVED",
      payload: { text: "This traffic is literally killing me, I could just die." },
      source: "patient",
    });
    await orchestrator.handleEvent(event);
    const [item] = orchestrator.triageQueue.getPending();

    const escalation = orchestrator.dismissCrisisFlag(item!.id, "clinician:1", "sarcasm, not genuine");
    expect(escalation.status).toBe("cancelled");

    const stats = orchestrator.triageQueue.getPatternStats("die");
    expect(stats.dismissedFalsePositive).toBe(1);
    expect(stats.falsePositiveRate).toBe(1);
  });

  it("confirming a fast-triage item approves and executes the escalation", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test EC2-C");

    safety.setCrisis({ is_crisis: true, probability: 0.95, matched_keyword: "kill myself", reasoning: "fake: explicit" });
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_MESSAGE_RECEIVED",
      payload: { text: "I want to kill myself tonight." },
      source: "patient",
    });
    await orchestrator.handleEvent(event);
    const [item] = orchestrator.triageQueue.getPending();

    const escalation = await orchestrator.confirmCrisisFlag(item!.id, "clinician:1");
    expect(escalation.status).toBe("completed");

    const stats = orchestrator.triageQueue.getPatternStats("kill myself");
    expect(stats.confirmedTrue).toBe(1);
    expect(stats.falsePositiveRate).toBe(0);
  });

  it("a triage item can only be decided once", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test EC2-D");
    safety.setCrisis({ is_crisis: true, probability: 0.5, reasoning: "fake" });
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_MESSAGE_RECEIVED",
      payload: { text: "some message" },
      source: "patient",
    });
    await orchestrator.handleEvent(event);
    const [item] = orchestrator.triageQueue.getPending();

    orchestrator.dismissCrisisFlag(item!.id, "clinician:1");
    expect(() => orchestrator.dismissCrisisFlag(item!.id, "clinician:2")).toThrow(/already decided/);
  });
});

describe("Edge Case 3 -- agent memory drift (stale data requires reconfirmation)", () => {
  it("blocks a MEDIUM-tier action based on facts older than the default 30-day threshold", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test EC3-A");

    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: daysAgo(47) });
    world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: daysAgo(46) });
    const last = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: daysAgo(45) });

    const actions = await orchestrator.handleEvent(last);
    const flag = actions.find((a) => a.actionType === "FLAG_MOOD_PATTERN")!;

    expect(flag.tier).toBe("MEDIUM");
    expect(flag.status).toBe("proposed"); // blocked, NOT auto-executed despite being MEDIUM
    expect(flag.flaggedForReview).toBe(true);
    expect(flag.blockRecord?.reason).toBe("stale_facts");
  });

  it("executes normally once every stale source fact is explicitly reconfirmed", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test EC3-B");

    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    const e1 = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: daysAgo(47) });
    const e2 = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: daysAgo(46) });
    const e3 = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: daysAgo(45) });

    const firstAttempt = await orchestrator.handleEvent(e3);
    const blockedFlag = firstAttempt.find((a) => a.actionType === "FLAG_MOOD_PATTERN")!;
    expect(blockedFlag.status).toBe("proposed");

    for (const e of [e1, e2, e3]) {
      orchestrator.reconfirmFact(patient.id, e.id, "clinician:1", "verified still accurate");
    }

    // Re-propose using the same trigger event -- now every source fact is fresh.
    const secondAttempt = await orchestrator.handleEvent(e3);
    const freshFlag = secondAttempt.find((a) => a.actionType === "FLAG_MOOD_PATTERN")!;
    expect(freshFlag.status).toBe("completed");
    expect(freshFlag.blockRecord).toBeNull();
  });

  it("does not block LOW-tier actions on fact freshness", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test EC3-C");
    const event = world.recordEvent({
      patientId: patient.id,
      eventType: "CHECK_IN_MISSED",
      payload: { scheduledFor: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() },
      source: "system",
    });
    const actions = await orchestrator.handleEvent(event);
    const reminder = actions.find((a) => a.actionType === "SEND_CHECK_IN_REMINDER")!;
    expect(reminder.status).toBe("completed");
  });
});

describe("Edge Case 4 -- contradictory data sources are surfaced, never blended", () => {
  it("flags a CONTRADICT verdict between a clinician note and check-in data, verbatim", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test EC4-A");

    world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient" });
    safety.setContradiction({ label: "CONTRADICT", reasoning: "fake: clinician says stable, check-ins show decline" });

    const noteEvent = world.recordEvent({
      patientId: patient.id,
      eventType: "CLINICIAN_NOTE_ADDED",
      payload: { text: "Patient reports doing well and is fully engaged.", clinicianAssessment: "stable", clinicianId: "demo-1" },
      source: "clinician",
    });

    const actions = await orchestrator.handleEvent(noteEvent);
    const flag = actions.find((a) => a.actionType === "FLAG_DATA_CONTRADICTION")!;

    expect(flag).toBeDefined();
    expect(flag.tier).toBe("MEDIUM");
    expect(flag.status).toBe("completed"); // the flag itself always executes -- it's what surfaces the problem
    expect(flag.payload.sourceA).toContain("Patient reports doing well");
    expect(flag.payload.sourceB).toContain("3"); // the raw check-in data, not an averaged/blended summary
    expect(flag.payload.contradictionLabel).toBe("CONTRADICT");
  });

  it("does not flag anything when sources agree", async () => {
    const { world, orchestrator, safety } = makeOrchestrator();
    const patient = world.admitPatient("Test EC4-B");
    world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient" });
    safety.setContradiction({ label: "AGREE" });

    const noteEvent = world.recordEvent({
      patientId: patient.id,
      eventType: "CLINICIAN_NOTE_ADDED",
      payload: { text: "Patient is doing well, consistent with check-ins.", clinicianAssessment: "stable", clinicianId: "demo-1" },
      source: "clinician",
    });
    const actions = await orchestrator.handleEvent(noteEvent);
    expect(actions.find((a) => a.actionType === "FLAG_DATA_CONTRADICTION")).toBeUndefined();
  });
});

describe("Edge Case 7 -- PHI leakage through logs/reasoning traces", () => {
  it("every proposed action writes a reasoning trace, readable only with PHI access", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test EC7-A");
    const event = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_MISSED", payload: {}, source: "system" });
    await orchestrator.handleEvent(event);

    const traces = orchestrator.auditLog.listEntriesForPatient(patient.id);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[0]!.authorId).toBe("checkInAgent");

    // No access granted yet -- reading the trace must fail exactly
    // like reading the underlying patient record would.
    expect(() => orchestrator.readReasoningTrace(traces[0]!.id, "clinician:outsider")).toThrow(/does not have access/);

    orchestrator.phiAccessControl.grantAccess(patient.id, "clinician:owner");
    expect(orchestrator.readReasoningTrace(traces[0]!.id, "clinician:owner")).toContain("missed a scheduled check-in");
  });

  it("denies reasoning-trace reads to a principal without PHI access, using the same ACL as the patient record", async () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test EC7-B");
    const entry = orchestrator.auditLog.writeReasoningTrace(patient.id, "checkInAgent", "proposed a routine reminder");

    expect(() => orchestrator.readReasoningTrace(entry.id, "clinician:outsider")).toThrow(/does not have access/);

    orchestrator.phiAccessControl.grantAccess(patient.id, "clinician:owner");
    const content = orchestrator.readReasoningTrace(entry.id, "clinician:owner");
    expect(content).toBe("proposed a routine reminder");
  });

  it("stores reasoning traces encrypted at rest -- the raw record never contains the plaintext", () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test EC7-C");
    const secretReasoning = "risk_level computed as Watch: mood scores declining sharply";
    const entry = orchestrator.auditLog.writeReasoningTrace(patient.id, "patternFlagAgent", secretReasoning);

    const raw = orchestrator.auditLog.getRawEntry(entry.id)!;
    const rawSerialized = JSON.stringify(raw);
    expect(rawSerialized).not.toContain(secretReasoning);
    expect(raw.encrypted.ciphertext).toBeTruthy();
  });

  it("logs every read attempt, granted or denied, to the access ledger", () => {
    const { world, orchestrator } = makeOrchestrator();
    const patient = world.admitPatient("Test EC7-D");
    const entry = orchestrator.auditLog.writeReasoningTrace(patient.id, "escalationAgent", "crisis escalation reasoning");

    expect(() => orchestrator.readReasoningTrace(entry.id, "clinician:outsider")).toThrow();
    orchestrator.phiAccessControl.grantAccess(patient.id, "clinician:owner");
    orchestrator.readReasoningTrace(entry.id, "clinician:owner");

    const log = orchestrator.auditLog.getAccessLog(patient.id);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ requesterId: "clinician:outsider", granted: false });
    expect(log[1]).toMatchObject({ requesterId: "clinician:owner", granted: true });
  });
});
