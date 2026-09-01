"""
FastAPI app for the SAHAYAK safety microservice.

Internal-only API consumed by the Node/TypeScript core (spec 2.3):
every agent action, and every inbound patient message, is checked
here BEFORE it's allowed to execute or influence agent reasoning.
None of these classifiers are the agent's own LLM -- that's the
whole point (spec 4.2).

This service reports facts (trust label, crisis flag, injection flag,
contradiction label). It does NOT decide autonomy tiers or own the
clinician review queues -- that policy layer lives in the Node core
(actionSchema.ts / orchestrator.ts, Phase 3+), which is free to route
a CRISIS flag to a fast triage queue rather than a full escalation,
per Edge Case 2. Keeping that decision out of this service keeps the
safety classifiers reusable and testable in isolation.
"""
from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .contradiction_detector import get_contradiction_detector
from .crisis_classifier import get_crisis_classifier
from .injection_detector import get_injection_detector
from .trust_classifier import get_trust_classifier

app = FastAPI(
    title="SAHAYAK Safety Service",
    description="Encoder-based, independent safety verification for the SAHAYAK core.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------
# Individual classifier endpoints -- useful standalone for testing
# and for eval-harness scenarios that exercise exactly one check.
# ---------------------------------------------------------------
class TextRequest(BaseModel):
    text: str


class CrisisResponse(BaseModel):
    label: str
    is_crisis: bool
    probability: float
    matched_keyword: str | None
    reasoning: str
    # Edge Case 2: crisis flags route to a fast triage queue, not a
    # full alarm -- this field is a hint to the Node core about which
    # queue to use; the core owns the actual routing decision.
    suggested_queue: str


@app.post("/safety/crisis", response_model=CrisisResponse)
def check_crisis(req: TextRequest) -> CrisisResponse:
    result = get_crisis_classifier().classify(req.text)
    return CrisisResponse(
        label=result.label,
        is_crisis=result.is_crisis,
        probability=result.probability,
        matched_keyword=result.matched_keyword,
        reasoning=result.reasoning,
        suggested_queue="fast_triage" if result.is_crisis else "none",
    )


class TrustResponse(BaseModel):
    label: str
    confidence: float
    scores: dict[str, float]


@app.post("/safety/trust", response_model=TrustResponse)
def check_trust(req: TextRequest) -> TrustResponse:
    result = get_trust_classifier().classify(req.text)
    return TrustResponse(label=result.label, confidence=result.confidence, scores=result.scores)


class InjectionResponse(BaseModel):
    label: str
    is_injection: bool
    probability: float
    matched_pattern: str | None
    reasoning: str


@app.post("/safety/injection", response_model=InjectionResponse)
def check_injection(req: TextRequest) -> InjectionResponse:
    result = get_injection_detector().classify(req.text)
    return InjectionResponse(
        label=result.label,
        is_injection=result.is_injection,
        probability=result.probability,
        matched_pattern=result.matched_pattern,
        reasoning=result.reasoning,
    )


class ContradictionRequest(BaseModel):
    source_a: str
    source_b: str


class ContradictionResponse(BaseModel):
    label: str
    confidence: float
    scores: dict[str, float]
    cosine_similarity: float
    reasoning: str


@app.post("/safety/contradiction", response_model=ContradictionResponse)
def check_contradiction(req: ContradictionRequest) -> ContradictionResponse:
    result = get_contradiction_detector().classify(req.source_a, req.source_b)
    return ContradictionResponse(
        label=result.label,
        confidence=result.confidence,
        scores=result.scores,
        cosine_similarity=result.cosine_similarity,
        reasoning=result.reasoning,
    )


# ---------------------------------------------------------------
# Combined verify-action endpoint -- the one named explicitly in the
# spec's architecture diagram. The Node core calls this once per
# proposed agent action with whichever fields are relevant to that
# action, rather than orchestrating multiple round-trips itself.
# ---------------------------------------------------------------
class VerifyActionRequest(BaseModel):
    action_type: str
    tier: str = Field(pattern="^(LOW|MEDIUM|HIGH)$")
    # Trust-checks the agent's own drafted output, if this action
    # produces patient-facing or clinician-facing text.
    drafted_text: str | None = None
    # Crisis + injection checks run on inbound patient text that
    # triggered or informs this action, if any.
    inbound_patient_text: str | None = None
    # Optional contradiction check between two data sources relevant
    # to this action (e.g. clinician note vs check-in summary).
    contradiction_check: ContradictionRequest | None = None


class VerifyActionResponse(BaseModel):
    safe_to_proceed: bool
    blocking_reasons: list[str]
    trust: TrustResponse | None = None
    crisis: CrisisResponse | None = None
    injection: InjectionResponse | None = None
    contradiction: ContradictionResponse | None = None


@app.post("/safety/verify-action", response_model=VerifyActionResponse)
def verify_action(req: VerifyActionRequest) -> VerifyActionResponse:
    blocking_reasons: list[str] = []
    trust_resp: TrustResponse | None = None
    crisis_resp: CrisisResponse | None = None
    injection_resp: InjectionResponse | None = None
    contradiction_resp: ContradictionResponse | None = None

    if req.drafted_text is not None:
        trust_resp = check_trust(TextRequest(text=req.drafted_text))
        if trust_resp.label in ("SUSPICIOUS", "UNRELIABLE"):
            blocking_reasons.append(f"Drafted output trust classification: {trust_resp.label}")

    if req.inbound_patient_text is not None:
        crisis_resp = check_crisis(TextRequest(text=req.inbound_patient_text))
        injection_resp = check_injection(TextRequest(text=req.inbound_patient_text))
        if injection_resp.is_injection:
            blocking_reasons.append("Inbound text matched injection detector")
        # Crisis is surfaced but does NOT block this action outright --
        # per Edge Case 2, it routes to fast triage in the Node core
        # rather than halting everything. See `suggested_queue` above.

    if req.contradiction_check is not None:
        contradiction_resp = check_contradiction(req.contradiction_check)
        if contradiction_resp.label == "CONTRADICT":
            blocking_reasons.append(
                "Data sources CONTRADICT -- must be surfaced to a human, not silently resolved"
            )

    return VerifyActionResponse(
        safe_to_proceed=len(blocking_reasons) == 0,
        blocking_reasons=blocking_reasons,
        trust=trust_resp,
        crisis=crisis_resp,
        injection=injection_resp,
        contradiction=contradiction_resp,
    )
