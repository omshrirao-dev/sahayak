/**
 * Client for the Python safety service (spec 2.3): every proposed
 * agent action goes through POST /safety/verify-action before it's
 * allowed to execute or even queue for approval. The agent's own
 * LLM is never the only safety check on itself (spec 4.2) -- this
 * client is how the Node core enforces that boundary structurally,
 * by making the check a required network call to a separate service
 * rather than something an agent could skip by construction.
 */

export interface ContradictionCheckInput {
  source_a: string;
  source_b: string;
}

export interface VerifyActionInput {
  action_type: string;
  tier: "LOW" | "MEDIUM" | "HIGH";
  drafted_text?: string;
  inbound_patient_text?: string;
  contradiction_check?: ContradictionCheckInput;
}

export interface TrustCheckResult {
  label: "VERIFIED" | "UNCERTAIN" | "SUSPICIOUS" | "UNRELIABLE";
  confidence: number;
  scores: Record<string, number>;
}

export interface CrisisCheckResult {
  label: "CRISIS" | "NOT_CRISIS";
  is_crisis: boolean;
  probability: number;
  matched_keyword: string | null;
  reasoning: string;
  suggested_queue: "fast_triage" | "none";
}

export interface InjectionCheckResult {
  label: "INJECTION" | "CLEAN";
  is_injection: boolean;
  probability: number;
  matched_pattern: string | null;
  reasoning: string;
}

export interface ContradictionCheckResult {
  label: "AGREE" | "PARTIAL" | "CONTRADICT" | "INSUFFICIENT";
  confidence: number;
  scores: Record<string, number>;
  cosine_similarity: number;
  reasoning: string;
}

export interface VerifyActionResult {
  safe_to_proceed: boolean;
  blocking_reasons: string[];
  trust: TrustCheckResult | null;
  crisis: CrisisCheckResult | null;
  injection: InjectionCheckResult | null;
  contradiction: ContradictionCheckResult | null;
}

export interface SafetyClient {
  verifyAction(input: VerifyActionInput): Promise<VerifyActionResult>;
  /**
   * Standalone crisis check (POST /safety/crisis). Used by the
   * orchestrator to run the classifier independently on EVERY
   * inbound patient message (Edge Case 1) -- separate from
   * verifyAction, which only checks crisis language when an agent
   * happens to attach inbound_patient_text to its own proposal.
   */
  checkCrisis(text: string): Promise<CrisisCheckResult>;
  /**
   * Standalone contradiction check (POST /safety/contradiction).
   * Used by agents that need to know a contradiction verdict WITHOUT
   * it blocking their own action via verifyAction's contradiction_check
   * field (Edge Case 4) -- e.g. the dedicated contradiction-flagging
   * agent, which must always execute in order to surface what it found.
   */
  checkContradiction(sourceA: string, sourceB: string): Promise<ContradictionCheckResult>;
}

export class SafetyServiceUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Safety service unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SafetyServiceUnavailableError";
  }
}

/**
 * Real HTTP client against the FastAPI safety service. Fails closed:
 * if the service is unreachable or returns a non-2xx response, this
 * throws rather than returning some default "safe" result -- an
 * agent action should never be able to execute BECAUSE the safety
 * service happened to be down.
 */
export class HttpSafetyClient implements SafetyClient {
  constructor(private baseUrl: string = "http://localhost:8000") {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new SafetyServiceUnavailableError(err);
    }
    if (!response.ok) {
      throw new SafetyServiceUnavailableError(`HTTP ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  verifyAction(input: VerifyActionInput): Promise<VerifyActionResult> {
    return this.post<VerifyActionResult>("/safety/verify-action", input);
  }

  checkCrisis(text: string): Promise<CrisisCheckResult> {
    return this.post<CrisisCheckResult>("/safety/crisis", { text });
  }

  checkContradiction(sourceA: string, sourceB: string): Promise<ContradictionCheckResult> {
    return this.post<ContradictionCheckResult>("/safety/contradiction", {
      source_a: sourceA,
      source_b: sourceB,
    });
  }
}
