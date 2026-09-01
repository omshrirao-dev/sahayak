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

  async verifyAction(input: VerifyActionInput): Promise<VerifyActionResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/safety/verify-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch (err) {
      throw new SafetyServiceUnavailableError(err);
    }
    if (!response.ok) {
      throw new SafetyServiceUnavailableError(
        `HTTP ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as VerifyActionResult;
  }
}
