import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { World } from "../src/index.js";
import { Orchestrator } from "../src/agents/orchestrator.js";
import { createDashboardApp } from "../src/api/dashboard.js";
import { FakeSafetyClient } from "./helpers/fakeSafetyClient.js";

/**
 * Integration tests for the dashboard REST API -- proves it reflects
 * real backend state accurately (spec 8 Phase 6), using a
 * FakeSafetyClient so this suite stays hermetic and doesn't require
 * the Python service running (that's what eval-harness/ is for).
 */

let world: World;
let orchestrator: Orchestrator;
let safety: FakeSafetyClient;
let server: Server;
let baseUrl: string;

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  world = new World();
  safety = new FakeSafetyClient();
  orchestrator = new Orchestrator({ world, safetyClient: safety });
  const wss = new WebSocketServer({ noServer: true });
  const app = createDashboardApp(world, orchestrator, wss);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe("dashboard API: patients", () => {
  it("reflects a newly admitted patient's live snapshot", async () => {
    const patient = world.admitPatient("Dashboard Test Patient A");
    world.recordEvent({
      patientId: patient.id,
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 8, responded: true },
      source: "patient",
    });

    const { status, body } = await fetchJson("/api/patients");
    expect(status).toBe(200);
    const found = body.find((s: any) => s.patient.id === patient.id);
    expect(found).toBeDefined();
    expect(found.careStage).toBe("Intake");
    expect(found.risk.riskLevel).toBe("Stable");
  });

  it("404s for an unknown patient id", async () => {
    const { status, body } = await fetchJson("/api/patients/does-not-exist");
    expect(status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it("timeline includes events, actions, and reasoning traces in chronological order", async () => {
    const patient = world.admitPatient("Dashboard Test Patient B");
    const e1 = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: "2026-06-01T00:00:00.000Z" });
    const e2 = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: "2026-06-02T00:00:00.000Z" });
    const e3 = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: "2026-06-03T00:00:00.000Z" });
    await orchestrator.handleEvent(e1);
    await orchestrator.handleEvent(e2);
    await orchestrator.handleEvent(e3);

    const { status, body } = await fetchJson(`/api/patients/${patient.id}/timeline`);
    expect(status).toBe(200);
    const kinds = body.map((entry: any) => entry.kind);
    expect(kinds).toContain("event");
    expect(kinds).toContain("action"); // the MEDIUM-tier FLAG_MOOD_PATTERN
    expect(kinds).toContain("reasoning_trace");
    const timestamps = body.map((entry: any) => entry.at);
    expect([...timestamps].sort()).toEqual(timestamps); // chronological
  });
});

describe("dashboard API: approval queue + actions", () => {
  it("lists a HIGH-tier drafted action and approving it executes it", async () => {
    const patient = world.admitPatient("Dashboard Test Patient C");
    const flagEvent = world.recordEvent({
      patientId: patient.id,
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "high", reason: "explicit statement", raisedBy: "agent" },
      source: "agent",
    });
    await orchestrator.handleEvent(flagEvent);

    const { body: queue } = await fetchJson("/api/approval-queue");
    const item = queue.find((q: any) => q.patient?.id === patient.id);
    expect(item).toBeDefined();
    expect(item.action.status).toBe("proposed");

    const { status, body: approved } = await fetchJson(`/api/actions/${item.action.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ by: "clinician:test" }),
    });
    expect(status).toBe(200);
    expect(approved.status).toBe("completed");

    const { body: queueAfter } = await fetchJson("/api/approval-queue");
    expect(queueAfter.find((q: any) => q.action.id === item.action.id)).toBeUndefined();
  });

  it("overriding an action cancels it and the override shows up on the timeline", async () => {
    const patient = world.admitPatient("Dashboard Test Patient D");
    const flagEvent = world.recordEvent({
      patientId: patient.id,
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "low", reason: "borderline", raisedBy: "agent" },
      source: "agent",
    });
    const [action] = await orchestrator.handleEvent(flagEvent);

    const { status, body } = await fetchJson(`/api/actions/${action!.id}/override`, {
      method: "POST",
      body: JSON.stringify({ by: "clinician:test", reason: "false positive" }),
    });
    expect(status).toBe(200);
    expect(body.status).toBe("cancelled");

    const { body: timeline } = await fetchJson(`/api/patients/${patient.id}/timeline`);
    const overrideEntry = timeline.find((e: any) => e.kind === "override");
    expect(overrideEntry?.override.reason).toBe("false positive");
  });
});

describe("dashboard API: fast triage queue", () => {
  it("confirming a triage item approves the underlying escalation", async () => {
    safety.setCrisis({ is_crisis: true, probability: 0.8, reasoning: "test crisis" });
    const patient = world.admitPatient("Dashboard Test Patient E");
    const msgEvent = world.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_MESSAGE_RECEIVED",
      payload: { text: "test message" },
      source: "patient",
    });
    await orchestrator.handleEvent(msgEvent);
    safety.setCrisis({ is_crisis: false }); // reset for other tests

    const { body: triage } = await fetchJson("/api/triage-queue");
    const item = triage.find((t: any) => t.patient?.id === patient.id);
    expect(item).toBeDefined();

    const { status, body } = await fetchJson(`/api/triage/${item.item.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ by: "clinician:test" }),
    });
    expect(status).toBe(200);
    expect(body.status).toBe("completed");
  });
});

describe("dashboard API: reasoning traces (Edge Case 7)", () => {
  it("denies access without a grant and allows it after one", async () => {
    const patient = world.admitPatient("Dashboard Test Patient F");
    const entry = orchestrator.auditLog.writeReasoningTrace(patient.id, "testAgent", "secret reasoning content");

    const denied = await fetchJson(`/api/reasoning-traces/${entry.id}?requesterId=clinician:outsider`);
    expect(denied.status).toBe(403);

    orchestrator.phiAccessControl.grantAccess(patient.id, "clinician:owner");
    const granted = await fetchJson(`/api/reasoning-traces/${entry.id}?requesterId=clinician:owner`);
    expect(granted.status).toBe(200);
    expect(granted.body.content).toBe("secret reasoning content");
  });
});

describe("dashboard API: demo interactivity", () => {
  it("simulate-message runs the real orchestrator and returns resulting actions", async () => {
    const patient = world.admitPatient("Dashboard Test Patient G");
    const { status, body } = await fetchJson(`/api/patients/${patient.id}/simulate-message`, {
      method: "POST",
      body: JSON.stringify({ text: "just checking in" }),
    });
    expect(status).toBe(200);
    expect(body.event.eventType).toBe("PATIENT_MESSAGE_RECEIVED");
    expect(Array.isArray(body.actions)).toBe(true);
  });
});
