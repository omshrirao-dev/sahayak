import type {
  SafetyClient,
  VerifyActionInput,
  VerifyActionResult,
  CrisisCheckResult,
  ContradictionCheckResult,
  InjectionCheckResult,
} from "../../src/safety/safetyClient.js";

/**
 * Configurable in-memory SafetyClient for tests -- no network calls
 * to the Python service. Every check defaults to "safe"/"no signal";
 * override per-test via the setters to exercise blocking paths.
 */
export class FakeSafetyClient implements SafetyClient {
  calls: VerifyActionInput[] = [];
  private safeOverride: boolean | null = null;
  private crisisOverride: Partial<CrisisCheckResult> | null = null;
  private contradictionOverride: Partial<ContradictionCheckResult> | null = null;
  private injectionOverride: Partial<InjectionCheckResult> | null = null;

  setSafe(safe: boolean) {
    this.safeOverride = safe;
  }

  setCrisis(result: Partial<CrisisCheckResult>) {
    this.crisisOverride = result;
  }

  setContradiction(result: Partial<ContradictionCheckResult>) {
    this.contradictionOverride = result;
  }

  setInjection(result: Partial<InjectionCheckResult>) {
    this.injectionOverride = result;
  }

  async verifyAction(input: VerifyActionInput): Promise<VerifyActionResult> {
    this.calls.push(input);
    const safe = this.safeOverride ?? true;
    return {
      safe_to_proceed: safe,
      blocking_reasons: safe ? [] : ["fake block"],
      trust: null,
      crisis: null,
      injection: null,
      contradiction: null,
    };
  }

  async checkCrisis(_text: string): Promise<CrisisCheckResult> {
    return {
      label: "NOT_CRISIS",
      is_crisis: false,
      probability: 0.1,
      matched_keyword: null,
      reasoning: "fake: no crisis",
      suggested_queue: "none",
      ...this.crisisOverride,
    };
  }

  async checkContradiction(_sourceA: string, _sourceB: string): Promise<ContradictionCheckResult> {
    return {
      label: "AGREE",
      confidence: 0.9,
      scores: {},
      cosine_similarity: 0.9,
      reasoning: "fake: agree",
      ...this.contradictionOverride,
    };
  }

  async checkInjection(_text: string): Promise<InjectionCheckResult> {
    return {
      label: "CLEAN",
      is_injection: false,
      probability: 0.05,
      matched_pattern: null,
      reasoning: "fake: clean",
      ...this.injectionOverride,
    };
  }
}
