"""
Prompt injection detector: INJECTION / CLEAN.

Runs on any text entering agent context (patient messages, uploaded
notes, etc.) before that text is allowed to influence an agent's
reasoning or actions -- independent layer, not something the agent's
own LLM decides about its own input.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from sklearn.linear_model import LogisticRegression

from .embedder import get_embedder
from .training_data import INJECTION_EXAMPLES

# Explicit high-signal phrasings that should never slip through on a
# borderline ML score -- mirrors the crisis classifier's hard-keyword
# override for the same reason: a small synthetic training set
# should not be the only thing standing between a known attack
# pattern and the agent's context window.
HARD_PATTERNS = [
    r"ignore (all |the )?(previous|above|prior) instructions",
    r"disregard (the )?(above|previous|prior)",
    r"you are now (in )?(developer|admin|unrestricted|dan) mode",
    r"system\s*:\s*override",
    r"reveal (your|the) (system prompt|internal (configuration|instructions))",
    r"pretend (you are|to be) (an? )?(unfiltered|unrestricted|jailbroken)",
    r"forget (you are|your (instructions|guidelines|role))",
]

INJECTION_PROBABILITY_THRESHOLD = 0.5


@dataclass
class InjectionResult:
    is_injection: bool
    probability: float
    matched_pattern: str | None
    reasoning: str

    @property
    def label(self) -> str:
        return "INJECTION" if self.is_injection else "CLEAN"


class InjectionDetector:
    def __init__(self):
        texts = [t for t, _ in INJECTION_EXAMPLES]
        labels = [1 if lbl == "INJECTION" else 0 for _, lbl in INJECTION_EXAMPLES]
        self.embedder = get_embedder()
        X = self.embedder.fit_transform(texts)
        self.model = LogisticRegression(max_iter=1000, class_weight="balanced")
        self.model.fit(X, labels)
        self._pattern_re = re.compile("|".join(HARD_PATTERNS), re.IGNORECASE)

    def classify(self, text: str) -> InjectionResult:
        pattern_match = self._pattern_re.search(text)
        vec = self.embedder.transform([text])
        probability = float(self.model.predict_proba(vec)[0][1])

        if pattern_match:
            return InjectionResult(
                is_injection=True,
                probability=max(probability, 0.99),
                matched_pattern=pattern_match.group(0),
                reasoning="Matched known injection phrasing pattern (overrides ML score).",
            )

        is_injection = probability >= INJECTION_PROBABILITY_THRESHOLD
        return InjectionResult(
            is_injection=is_injection,
            probability=probability,
            matched_pattern=None,
            reasoning=(
                f"ML injection probability {probability:.3f} "
                f"{'>=' if is_injection else '<'} threshold {INJECTION_PROBABILITY_THRESHOLD}."
            ),
        )


@lru_cache(maxsize=1)
def get_injection_detector() -> InjectionDetector:
    return InjectionDetector()
