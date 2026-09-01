import { describe, it, expect } from "vitest";
import { InMemoryEventStore } from "../src/events/eventStore.js";

describe("InMemoryEventStore", () => {
  it("assigns an id and timestamps on append", () => {
    const store = new InMemoryEventStore();
    const event = store.append({
      patientId: "p1",
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 7, responded: true },
      source: "patient",
    });
    expect(event.id).toBeTruthy();
    expect(event.recordedAt).toBeTruthy();
    expect(event.occurredAt).toBeTruthy();
  });

  it("is append-only: getByPatient returns events in occurredAt order and exposes no mutation methods", () => {
    const store = new InMemoryEventStore();
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 5, responded: true },
      source: "patient",
      occurredAt: "2026-01-02T00:00:00.000Z",
    });
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 6, responded: true },
      source: "patient",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    const events = store.getByPatient("p1");
    expect(events).toHaveLength(2);
    expect(events[0]!.occurredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(events[1]!.occurredAt).toBe("2026-01-02T00:00:00.000Z");
    expect((store as unknown as { update?: unknown }).update).toBeUndefined();
    expect((store as unknown as { delete?: unknown }).delete).toBeUndefined();
  });

  it("isolates events by patient", () => {
    const store = new InMemoryEventStore();
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 7, responded: true },
      source: "patient",
    });
    store.append({
      patientId: "p2",
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 3, responded: true },
      source: "patient",
    });
    expect(store.getByPatient("p1")).toHaveLength(1);
    expect(store.getByPatient("p2")).toHaveLength(1);
    expect(store.getAll()).toHaveLength(2);
  });

  it("filters by patient and event type", () => {
    const store = new InMemoryEventStore();
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_SUBMITTED",
      payload: { moodScore: 7, responded: true },
      source: "patient",
    });
    store.append({
      patientId: "p1",
      eventType: "CHECK_IN_MISSED",
      payload: { scheduledFor: "2026-01-01T00:00:00.000Z" },
      source: "system",
    });
    expect(store.getByPatientAndType("p1", "CHECK_IN_SUBMITTED")).toHaveLength(1);
    expect(store.getByPatientAndType("p1", "CHECK_IN_MISSED")).toHaveLength(1);
  });
});
