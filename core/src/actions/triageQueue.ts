import { randomUUID } from "node:crypto";

/**
 * Edge Case 2 (crisis false positive / over-triggering).
 *
 * A raised crisis flag does NOT go straight into the full clinician
 * approval queue alongside every other HIGH-tier draft -- it goes
 * here, a separate FAST queue meant for a quick confirm/dismiss
 * within minutes, not a full alarm workflow. This is what makes it
 * safe to keep the crisis classifier's threshold biased toward
 * recall (Edge Case 1) without drowning clinicians in false alarms:
 * the cost of a false positive is "one quick dismiss," not "a full
 * escalation review."
 *
 * Every dismissal is recorded per matched pattern (the classifier's
 * matched_keyword, or a bucket label when it was an ML-only match),
 * so the resulting false-positive rate can inform periodic threshold
 * recalibration in the Python safety service. This module only
 * TRACKS that rate -- it doesn't mutate the live ML threshold itself;
 * recalibration is a deliberate, reviewed change to
 * crisis_classifier.py, not something that should silently drift at
 * request-serving time.
 */

export type TriageDecision = "confirmed_true" | "dismissed_false_positive";

export interface TriageItem {
  id: string;
  patientId: string;
  crisisFlagEventId: string;
  escalationActionId: string;
  matchedPattern: string; // classifier's matched_keyword, or a bucket label
  probability: number;
  createdAt: string;
  decision: TriageDecision | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface PatternStats {
  pattern: string;
  flagged: number;
  confirmedTrue: number;
  dismissedFalsePositive: number;
  falsePositiveRate: number;
}

const ML_ONLY_BUCKET = "__ml_only__";

export class TriageQueue {
  private items = new Map<string, TriageItem>();
  private patternCounts = new Map<string, { flagged: number; confirmedTrue: number; dismissedFalsePositive: number }>();

  enqueue(input: {
    patientId: string;
    crisisFlagEventId: string;
    escalationActionId: string;
    matchedPattern: string | null;
    probability: number;
  }): TriageItem {
    const pattern = input.matchedPattern ?? ML_ONLY_BUCKET;
    const item: TriageItem = {
      id: randomUUID(),
      patientId: input.patientId,
      crisisFlagEventId: input.crisisFlagEventId,
      escalationActionId: input.escalationActionId,
      matchedPattern: pattern,
      probability: input.probability,
      createdAt: new Date().toISOString(),
      decision: null,
      decidedBy: null,
      decidedAt: null,
    };
    this.items.set(item.id, item);

    const counts = this.patternCounts.get(pattern) ?? { flagged: 0, confirmedTrue: 0, dismissedFalsePositive: 0 };
    counts.flagged += 1;
    this.patternCounts.set(pattern, counts);

    return item;
  }

  getById(id: string): TriageItem | undefined {
    return this.items.get(id);
  }

  /** Items awaiting a quick confirm/dismiss -- what the fast triage UI would list. */
  getPending(): TriageItem[] {
    return [...this.items.values()].filter((i) => i.decision === null);
  }

  private decide(id: string, decision: TriageDecision, by: string): TriageItem {
    const item = this.items.get(id);
    if (!item) throw new Error(`Unknown triage item: ${id}`);
    if (item.decision !== null) {
      throw new Error(`Triage item ${id} was already decided: ${item.decision}`);
    }
    item.decision = decision;
    item.decidedBy = by;
    item.decidedAt = new Date().toISOString();

    const counts = this.patternCounts.get(item.matchedPattern)!;
    if (decision === "confirmed_true") counts.confirmedTrue += 1;
    else counts.dismissedFalsePositive += 1;

    return item;
  }

  confirm(id: string, by: string): TriageItem {
    return this.decide(id, "confirmed_true", by);
  }

  dismiss(id: string, by: string): TriageItem {
    return this.decide(id, "dismissed_false_positive", by);
  }

  /** Per-pattern false-positive rate -- the data a periodic threshold recalibration would consume. */
  getPatternStats(pattern: string): PatternStats {
    const counts = this.patternCounts.get(pattern) ?? { flagged: 0, confirmedTrue: 0, dismissedFalsePositive: 0 };
    const decided = counts.confirmedTrue + counts.dismissedFalsePositive;
    return {
      pattern,
      flagged: counts.flagged,
      confirmedTrue: counts.confirmedTrue,
      dismissedFalsePositive: counts.dismissedFalsePositive,
      falsePositiveRate: decided > 0 ? counts.dismissedFalsePositive / decided : 0,
    };
  }

  getAllPatternStats(): PatternStats[] {
    return [...this.patternCounts.keys()].map((p) => this.getPatternStats(p));
  }
}
