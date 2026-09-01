import type { BaseEvent, EventType, FactReconfirmedPayload } from "../events/eventTypes.js";
import type { EventStore } from "../events/eventStore.js";

/**
 * Edge Case 3 (agent memory drift / stale data).
 *
 * Every stored fact (event) has an effective freshness window: an
 * explicit `validUntil` if the event set one, otherwise a default
 * age-based window (30 days). Once that window passes, the fact is
 * stale and requires an explicit FACT_RECONFIRMED event -- from a
 * human or a re-verified agent check -- before a MEDIUM or HIGH tier
 * decision may rely on it. This is enforced by the orchestrator
 * (see Orchestrator.checkFactFreshness), not silently handled by
 * whichever computation happens to read the event.
 */
export const DEFAULT_STALENESS_THRESHOLD_DAYS = 30;

export interface FreshnessResult {
  eventId: string;
  isStale: boolean;
  referenceTime: string; // the timestamp freshness was measured from
  reason: string;
}

function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Determines whether `event` is stale as of `now`, given the full
 * set of events for that patient (needed to find any reconfirmations
 * of it). A reconfirmation resets the freshness clock to the
 * reconfirmation's own timestamp -- it does NOT extend the original
 * event's validUntil, since we never mutate history.
 */
export function checkFactFreshness(
  event: BaseEvent,
  patientEvents: BaseEvent[],
  now: Date = new Date(),
  thresholdDays: number = DEFAULT_STALENESS_THRESHOLD_DAYS,
): FreshnessResult {
  const reconfirmations = patientEvents
    .filter((e) => e.eventType === "FACT_RECONFIRMED")
    .filter((e) => (e.payload as unknown as FactReconfirmedPayload).originalEventId === event.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const latestReconfirmation = reconfirmations[0];

  if (latestReconfirmation) {
    const ageMs = now.getTime() - new Date(latestReconfirmation.occurredAt).getTime();
    const stale = ageMs > daysToMs(thresholdDays);
    return {
      eventId: event.id,
      isStale: stale,
      referenceTime: latestReconfirmation.occurredAt,
      reason: stale
        ? `Last reconfirmed ${latestReconfirmation.occurredAt}, which is over ${thresholdDays} days ago.`
        : `Reconfirmed ${latestReconfirmation.occurredAt}, still within the ${thresholdDays}-day window.`,
    };
  }

  if (event.validUntil) {
    const stale = now > new Date(event.validUntil);
    return {
      eventId: event.id,
      isStale: stale,
      referenceTime: event.occurredAt,
      reason: stale
        ? `Explicit validUntil (${event.validUntil}) has passed with no reconfirmation.`
        : `Within its explicit validUntil (${event.validUntil}).`,
    };
  }

  const ageMs = now.getTime() - new Date(event.occurredAt).getTime();
  const stale = ageMs > daysToMs(thresholdDays);
  return {
    eventId: event.id,
    isStale: stale,
    referenceTime: event.occurredAt,
    reason: stale
      ? `No validUntil set and no reconfirmation; older than the default ${thresholdDays}-day threshold.`
      : `Within the default ${thresholdDays}-day freshness window.`,
  };
}

/** Records an explicit human/agent reconfirmation of an existing fact. */
export function reconfirmFact(
  store: EventStore,
  patientId: string,
  originalEventId: string,
  confirmedBy: string,
  note?: string,
): BaseEvent<EventType, FactReconfirmedPayload> {
  return store.append<FactReconfirmedPayload>({
    patientId,
    eventType: "FACT_RECONFIRMED",
    payload: { originalEventId, confirmedBy, note },
    source: confirmedBy.startsWith("clinician") ? "clinician" : "agent",
  });
}
