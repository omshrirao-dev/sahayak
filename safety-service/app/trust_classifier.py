"""
Trust classifier: VERIFIED / UNCERTAIN / SUSPICIOUS / UNRELIABLE.

Independently verifies agent-DRAFTED, patient-facing text before it's
allowed to execute or queue for approval. This is the concrete
instance of spec 4.2's rule: "the agent's own LLM is NEVER the only
safety check on itself." An encoder-based classifier that never saw
the prompt that produced the draft has no stake in defending it.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from sklearn.linear_model import LogisticRegression

from .embedder import get_embedder
from .training_data import TRUST_EXAMPLES

LABELS = ["VERIFIED", "UNCERTAIN", "SUSPICIOUS", "UNRELIABLE"]


@dataclass
class TrustResult:
    label: str
    confidence: float
    scores: dict[str, float]


class TrustClassifier:
    def __init__(self):
        texts = [t for t, _ in TRUST_EXAMPLES]
        labels = [lbl for _, lbl in TRUST_EXAMPLES]
        self.embedder = get_embedder()
        X = self.embedder.fit_transform(texts)
        self.model = LogisticRegression(max_iter=1000, class_weight="balanced")
        self.model.fit(X, labels)

    def classify(self, text: str) -> TrustResult:
        vec = self.embedder.transform([text])
        proba = self.model.predict_proba(vec)[0]
        scores = dict(zip(self.model.classes_, (float(p) for p in proba)))
        # Ensure every known label is present even if it happened not
        # to be a class the model saw predict_proba columns for.
        for label in LABELS:
            scores.setdefault(label, 0.0)
        best_label = max(scores, key=lambda k: scores[k])
        return TrustResult(label=best_label, confidence=scores[best_label], scores=scores)


@lru_cache(maxsize=1)
def get_trust_classifier() -> TrustClassifier:
    return TrustClassifier()
