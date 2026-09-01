/**
 * Edge Case 8 (human override not respected on next cycle) +
 * spec 2.2's self-correcting downgrade rule.
 *
 * A clinician override of an agent's suggested action is stored here
 * as a first-class, permanent record -- weighted into all future
 * agent decisions for that patient and that action type, not a
 * one-time log entry an agent can forget by the next cycle.
 *
 * Scoped per (patientId, actionType), matching the language used
 * for the override-as-context rule itself ("for that patient and
 * that action type"): a clinician repeatedly overriding
 * FLAG_MOOD_PATTERN for one specific patient shouldn't silently
 * downgrade that action type for every other patient too.
 */

export interface OverrideRecord {
  patientId: string;
  actionType: string;
  overriddenBy: string;
  reason: string;
  originalTier: string;
  at: string;
}

interface DowngradeState {
  consecutiveOverrides: number;
  downgraded: boolean;
  downgradedAt?: string;
  restoredAt?: string;
}

const CONSECUTIVE_OVERRIDE_DOWNGRADE_THRESHOLD = 2;

function scopeKey(patientId: string, actionType: string): string {
  return `${patientId}::${actionType}`;
}

export class OverrideMemory {
  private records: OverrideRecord[] = [];
  private downgradeState = new Map<string, DowngradeState>();

  /** Records a clinician override/reversal. May trigger the self-correcting downgrade. */
  recordOverride(
    patientId: string,
    actionType: string,
    overriddenBy: string,
    reason: string,
    originalTier: string,
  ): OverrideRecord {
    const record: OverrideRecord = {
      patientId,
      actionType,
      overriddenBy,
      reason,
      originalTier,
      at: new Date().toISOString(),
    };
    this.records.push(record);

    const key = scopeKey(patientId, actionType);
    const state = this.downgradeState.get(key) ?? { consecutiveOverrides: 0, downgraded: false };
    state.consecutiveOverrides += 1;
    if (state.consecutiveOverrides >= CONSECUTIVE_OVERRIDE_DOWNGRADE_THRESHOLD && !state.downgraded) {
      state.downgraded = true;
      state.downgradedAt = record.at;
    }
    this.downgradeState.set(key, state);
    return record;
  }

  /**
   * A clinician APPROVED an action as-proposed (no override). This
   * resets the consecutive-override streak -- "2+ times IN A ROW" --
   * but does NOT automatically restore an already-downgraded action
   * type; that requires an explicit manual restoreAutonomy() call
   * (spec 2.2: "until a human manually restores its autonomy").
   */
  recordConfirmation(patientId: string, actionType: string): void {
    const key = scopeKey(patientId, actionType);
    const state = this.downgradeState.get(key);
    if (state) {
      state.consecutiveOverrides = 0;
    }
  }

  /** Manually restores autonomy for a downgraded (patient, actionType) pair. */
  restoreAutonomy(patientId: string, actionType: string, restoredBy: string): void {
    const key = scopeKey(patientId, actionType);
    const state = this.downgradeState.get(key);
    if (!state) return;
    state.downgraded = false;
    state.consecutiveOverrides = 0;
    state.restoredAt = new Date().toISOString();
    void restoredBy;
  }

  isDowngraded(patientId: string, actionType: string): boolean {
    return this.downgradeState.get(scopeKey(patientId, actionType))?.downgraded ?? false;
  }

  getConsecutiveOverrideCount(patientId: string, actionType: string): number {
    return this.downgradeState.get(scopeKey(patientId, actionType))?.consecutiveOverrides ?? 0;
  }

  /** Full override history for a (patient, actionType) pair -- context for future agent decisions. */
  getOverrideHistory(patientId: string, actionType: string): OverrideRecord[] {
    return this.records.filter((r) => r.patientId === patientId && r.actionType === actionType);
  }
}
