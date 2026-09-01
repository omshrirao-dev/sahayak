import type { BaseEvent, EngagementPingRespondedPayload } from "../events/eventTypes.js";

/**
 * engagement_status, like risk_level, is computed live from the
 * event stream (spec 2.1) -- never stored. It tracks whether the
 * patient is participating in their own care, independent of both
 * care_stage and risk_level.
 */
export type EngagementStatus = "Active" | "Unresponsive" | "Disengaged";

const UNRESPONSIVE_STREAK_THRESHOLD = 2;
const DISENGAGED_STREAK_THRESHOLD = 4;

export interface EngagementResult {
  engagementStatus: EngagementStatus;
  consecutiveMisses: number;
  reasons: string[];
}

/**
 * Every check-in / engagement-ping-cycle contributes one "touch
 * point": either a response (submitted check-in, or a ping that
 * got a response) or a miss (missed check-in, or a ping with no
 * recorded response). We look at the longest CURRENT streak of
 * consecutive misses, most recent first.
 */
export function computeEngagementStatus(events: BaseEvent[]): EngagementResult {
  const respondedPingIds = new Set(
    events
      .filter((e) => e.eventType === "ENGAGEMENT_PING_RESPONDED")
      .map((e) => (e.payload as unknown as EngagementPingRespondedPayload).pingEventId),
  );

  type TouchPoint = { occurredAt: string; responded: boolean };
  const touchPoints: TouchPoint[] = [];

  for (const e of events) {
    if (e.eventType === "CHECK_IN_SUBMITTED") {
      touchPoints.push({ occurredAt: e.occurredAt, responded: true });
    } else if (e.eventType === "CHECK_IN_MISSED") {
      touchPoints.push({ occurredAt: e.occurredAt, responded: false });
    } else if (e.eventType === "ENGAGEMENT_PING_SENT") {
      touchPoints.push({ occurredAt: e.occurredAt, responded: respondedPingIds.has(e.id) });
    }
  }

  touchPoints.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)); // most recent first

  let consecutiveMisses = 0;
  for (const tp of touchPoints) {
    if (tp.responded) break;
    consecutiveMisses++;
  }

  if (consecutiveMisses >= DISENGAGED_STREAK_THRESHOLD) {
    return {
      engagementStatus: "Disengaged",
      consecutiveMisses,
      reasons: [`${consecutiveMisses} consecutive missed touch-points (>= ${DISENGAGED_STREAK_THRESHOLD})`],
    };
  }
  if (consecutiveMisses >= UNRESPONSIVE_STREAK_THRESHOLD) {
    return {
      engagementStatus: "Unresponsive",
      consecutiveMisses,
      reasons: [`${consecutiveMisses} consecutive missed touch-points (>= ${UNRESPONSIVE_STREAK_THRESHOLD})`],
    };
  }
  return {
    engagementStatus: "Active",
    consecutiveMisses,
    reasons: touchPoints.length === 0 ? ["No touch-points yet"] : ["Recent touch-point responded to"],
  };
}
