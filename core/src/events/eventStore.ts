import { randomUUID } from "node:crypto";
import type { BaseEvent, EventSource, EventType } from "./eventTypes.js";

/**
 * Immutable, append-only event log.
 *
 * Phase 1 ships an in-memory implementation so the world-state model
 * can be built and tested without a live Supabase/Postgres instance.
 * It implements the same EventStore interface a Postgres-backed
 * store (writing to the `events` table in schema.sql) would --
 * swapping the backing store later does not change any consumer.
 *
 * Append-only is enforced structurally: there is no update/delete
 * method. Corrections must be new events (event sourcing), never
 * mutations of history.
 */
export interface AppendEventInput<P = Record<string, unknown>> {
  patientId: string;
  eventType: EventType;
  payload: P;
  source: EventSource;
  /** Defaults to now(). Lets tests/seed scripts backdate events. */
  occurredAt?: string;
  /** Edge Case 3: when this fact should be considered stale. */
  validUntil?: string | null;
}

export interface EventStore {
  append<P = Record<string, unknown>>(input: AppendEventInput<P>): BaseEvent<EventType, P>;
  getByPatient(patientId: string): BaseEvent[];
  getAll(): BaseEvent[];
  getByPatientAndType(patientId: string, eventType: EventType): BaseEvent[];
}

export class InMemoryEventStore implements EventStore {
  private events: BaseEvent[] = [];

  append<P = Record<string, unknown>>(input: AppendEventInput<P>): BaseEvent<EventType, P> {
    const now = new Date().toISOString();
    const event: BaseEvent<EventType, P> = {
      id: randomUUID(),
      patientId: input.patientId,
      eventType: input.eventType,
      payload: input.payload,
      validUntil: input.validUntil ?? null,
      occurredAt: input.occurredAt ?? now,
      recordedAt: now,
      source: input.source,
    };
    this.events.push(event as BaseEvent);
    return event;
  }

  getByPatient(patientId: string): BaseEvent[] {
    return this.events
      .filter((e) => e.patientId === patientId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  getAll(): BaseEvent[] {
    return [...this.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  getByPatientAndType(patientId: string, eventType: EventType): BaseEvent[] {
    return this.getByPatient(patientId).filter((e) => e.eventType === eventType);
  }
}
