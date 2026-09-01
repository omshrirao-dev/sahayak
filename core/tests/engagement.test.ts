import { describe, it, expect } from "vitest";
import { InMemoryEventStore } from "../src/events/eventStore.js";
import { computeEngagementStatus } from "../src/state-machine/engagement.js";

describe("computeEngagementStatus", () => {
  it("is Active with no touch-points yet", () => {
    const store = new InMemoryEventStore();
    const result = computeEngagementStatus(store.getByPatient("p1"));
    expect(result.engagementStatus).toBe("Active");
  });

  it("is Active after a responded check-in", () => {
    const store = new InMemoryEventStore();
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 7, responded: true },
      source: "patient",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    const result = computeEngagementStatus(store.getByPatient("p1"));
    expect(result.engagementStatus).toBe("Active");
  });

  it("becomes Unresponsive after 2 consecutive misses", () => {
    const store = new InMemoryEventStore();
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_MISSED",
      payload: { scheduledFor: "2026-01-01" },
      source: "system",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_MISSED",
      payload: { scheduledFor: "2026-01-02" },
      source: "system",
      occurredAt: "2026-01-02T00:00:00.000Z",
    });
    const result = computeEngagementStatus(store.getByPatient("p1"));
    expect(result.engagementStatus).toBe("Unresponsive");
    expect(result.consecutiveMisses).toBe(2);
  });

  it("becomes Disengaged after 4 consecutive misses", () => {
    const store = new InMemoryEventStore();
    for (let i = 1; i <= 4; i++) {
      store.append({
        patientId: "p1",
        eventType: "CHECK_IN_MISSED",
        payload: { scheduledFor: `2026-01-0${i}` },
        source: "system",
        occurredAt: `2026-01-0${i}T00:00:00.000Z`,
      });
    }
    const result = computeEngagementStatus(store.getByPatient("p1"));
    expect(result.engagementStatus).toBe("Disengaged");
  });

  it("resets the streak on a subsequent response, even after prior misses", () => {
    const store = new InMemoryEventStore();
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_MISSED",
      payload: { scheduledFor: "2026-01-01" },
      source: "system",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_MISSED",
      payload: { scheduledFor: "2026-01-02" },
      source: "system",
      occurredAt: "2026-01-02T00:00:00.000Z",
    });
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 6, responded: true },
      source: "patient",
      occurredAt: "2026-01-03T00:00:00.000Z",
    });
    const result = computeEngagementStatus(store.getByPatient("p1"));
    expect(result.engagementStatus).toBe("Active");
    expect(result.consecutiveMisses).toBe(0);
  });

  it("treats a responded engagement ping as a response, not a miss", () => {
    const store = new InMemoryEventStore();
    const ping = store.append({
      patientId: "p1",
      eventType: "ENGAGEMENT_PING_SENT",
      payload: {},
      source: "agent",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    store.append({
      patientId: "p1",
      eventType: "ENGAGEMENT_PING_RESPONDED",
      payload: { pingEventId: ping.id },
      source: "patient",
      occurredAt: "2026-01-01T01:00:00.000Z",
    });
    const result = computeEngagementStatus(store.getByPatient("p1"));
    expect(result.engagementStatus).toBe("Active");
  });
});
