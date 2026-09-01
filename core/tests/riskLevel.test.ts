import { describe, it, expect } from "vitest";
import { InMemoryEventStore } from "../src/events/eventStore.js";
import { computeRiskLevel } from "../src/state-machine/riskLevel.js";

function checkIn(store: InMemoryEventStore, patientId: string, moodScore: number, occurredAt: string) {
  store.append({
    patientId,
    eventType: "CHECK_IN_SUBMITTED",
    payload: { moodScore, responded: true },
    source: "patient",
    occurredAt,
  });
}

describe("computeRiskLevel", () => {
  it("defaults to Stable with no signal", () => {
    const store = new InMemoryEventStore();
    checkIn(store, "p1", 8, "2026-01-01T00:00:00.000Z");
    const result = computeRiskLevel(store.getByPatient("p1"));
    expect(result.riskLevel).toBe("Stable");
  });

  it("escalates to Watch on 3 consecutive low mood scores", () => {
    const store = new InMemoryEventStore();
    checkIn(store, "p1", 3, "2026-01-01T00:00:00.000Z");
    checkIn(store, "p1", 3, "2026-01-02T00:00:00.000Z");
    checkIn(store, "p1", 3, "2026-01-03T00:00:00.000Z");
    const result = computeRiskLevel(store.getByPatient("p1"));
    expect(result.riskLevel).toBe("Watch");
  });

  it("escalates to Watch on a declining mood-score trend even if not all low", () => {
    const store = new InMemoryEventStore();
    checkIn(store, "p1", 9, "2026-01-01T00:00:00.000Z");
    checkIn(store, "p1", 7, "2026-01-02T00:00:00.000Z");
    checkIn(store, "p1", 6, "2026-01-03T00:00:00.000Z");
    const result = computeRiskLevel(store.getByPatient("p1"));
    expect(result.riskLevel).toBe("Watch");
  });

  it("escalates to Crisis on an unresolved crisis flag, overriding good mood scores", () => {
    const store = new InMemoryEventStore();
    checkIn(store, "p1", 9, "2026-01-01T00:00:00.000Z");
    store.append({
      patientId: "p1",
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "high", reason: "crisis-language classifier match", raisedBy: "agent" },
      source: "agent",
    });
    const result = computeRiskLevel(store.getByPatient("p1"));
    expect(result.riskLevel).toBe("Crisis");
  });

  it("returns to non-Crisis once the flag is resolved as a false positive", () => {
    const store = new InMemoryEventStore();
    const flag = store.append({
      patientId: "p1",
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "medium", reason: "sarcastic phrase flagged", raisedBy: "agent" },
      source: "agent",
    });
    store.append({
      patientId: "p1",
      eventType: "CRISIS_FLAG_RESOLVED",
      payload: {
        resolution: "confirmed_false_positive",
        resolvedBy: "clinician:1",
        relatedFlagEventId: flag.id,
      },
      source: "clinician",
    });
    const result = computeRiskLevel(store.getByPatient("p1"));
    expect(result.riskLevel).not.toBe("Crisis");
  });

  it("does not average risk with a Crisis flag present alongside stable check-ins (Edge Case 4 pattern)", () => {
    // Two data sources disagree: check-ins look fine, but a crisis
    // flag is unresolved. Risk level must reflect the crisis, not a
    // blended/averaged middle ground.
    const store = new InMemoryEventStore();
    checkIn(store, "p1", 9, "2026-01-01T00:00:00.000Z");
    checkIn(store, "p1", 9, "2026-01-02T00:00:00.000Z");
    store.append({
      patientId: "p1",
      eventType: "CRISIS_FLAG_RAISED",
      payload: { severity: "high", reason: "explicit crisis language in message", raisedBy: "agent" },
      source: "agent",
    });
    const result = computeRiskLevel(store.getByPatient("p1"));
    expect(result.riskLevel).toBe("Crisis");
  });

  it("ignores a stale clinician note when computing Watch (Edge Case 3)", () => {
    const store = new InMemoryEventStore();
    const past = new Date(Date.now() - 1000).toISOString();
    store.append({
      patientId: "p1",
      eventType: "CLINICIAN_NOTE_ADDED",
      payload: { text: "declining", clinicianAssessment: "declining", clinicianId: "c1" },
      source: "clinician",
      validUntil: past, // already stale
    });
    const result = computeRiskLevel(store.getByPatient("p1"));
    expect(result.riskLevel).toBe("Stable");
  });
});
