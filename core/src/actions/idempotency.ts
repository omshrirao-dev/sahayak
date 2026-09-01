/**
 * Edge Case 6 (tool call failure mid-workflow / idempotency).
 *
 * Every external action carries an idempotency key. The critical
 * rule this module enforces: before retrying after a failure or
 * timeout, we explicitly VERIFY current state rather than blindly
 * re-executing. Blind retry is exactly how you end up sending a
 * patient the same crisis check-in reminder twice, or double-writing
 * an EHR update.
 */

export type IdempotencyRecordStatus = "in_progress" | "completed" | "failed";

export interface IdempotencyRecord<T = unknown> {
  key: string;
  status: IdempotencyRecordStatus;
  result?: T;
  attempts: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
}

export interface IdempotentExecuteOptions<T> {
  key: string;
  /**
   * Called BEFORE a retry (i.e. whenever a record for this key
   * already exists and isn't a fresh success) to check whether the
   * external effect already actually happened -- e.g. query the EHR
   * record directly rather than trusting our own possibly-stale
   * bookkeeping. Returning a non-null value means "it already
   * happened, don't redo it" and that value becomes the result.
   */
  verifyCurrentState: () => Promise<T | null>;
  /** The actual external tool call. Only invoked if verification finds nothing. */
  execute: () => Promise<T>;
}

export class IdempotencyStore {
  private records = new Map<string, IdempotencyRecord>();

  getRecord(key: string): IdempotencyRecord | undefined {
    return this.records.get(key);
  }

  /**
   * Runs `execute` under idempotency protection for `key`. Safe to
   * call multiple times with the same key after a failure/timeout:
   * - If a prior call already completed, returns the cached result
   *   WITHOUT calling execute() again.
   * - Otherwise, calls verifyCurrentState() first. If that finds the
   *   effect already happened externally (e.g. a previous attempt's
   *   network response was lost but the write actually landed), that
   *   becomes the result and execute() is still never called again.
   * - Only if verification finds nothing does it actually call
   *   execute().
   */
  async run<T>(options: IdempotentExecuteOptions<T>): Promise<T> {
    const existing = this.records.get(options.key) as IdempotencyRecord<T> | undefined;
    const now = new Date().toISOString();

    if (existing?.status === "completed") {
      return existing.result as T;
    }

    if (existing) {
      existing.attempts += 1;
      existing.lastAttemptAt = now;
    } else {
      this.records.set(options.key, {
        key: options.key,
        status: "in_progress",
        attempts: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
      });
    }

    const verified = await options.verifyCurrentState();
    if (verified !== null) {
      this.markCompleted(options.key, verified);
      return verified;
    }

    try {
      const result = await options.execute();
      this.markCompleted(options.key, result);
      return result;
    } catch (err) {
      const record = this.records.get(options.key)!;
      record.status = "failed";
      record.lastAttemptAt = new Date().toISOString();
      throw err;
    }
  }

  private markCompleted<T>(key: string, result: T): void {
    const record = this.records.get(key)!;
    record.status = "completed";
    record.result = result;
    record.lastAttemptAt = new Date().toISOString();
  }
}
