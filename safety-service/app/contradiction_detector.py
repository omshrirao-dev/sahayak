"""
Contradiction detector: AGREE / PARTIAL / CONTRADICT / INSUFFICIENT.

Takes two text sources describing the same patient over roughly the
same period (spec's canonical example: a clinician note vs check-in
score data) and classifies their relationship. This is Edge Case 4's
core requirement: when two sources disagree, NEVER average/blend them
into some silent middle state. This module produces one of four
explicit labels; main.py's /safety/contradiction endpoint is
responsible for surfacing anything other than AGREE to a human
rather than resolving it automatically.

Feature-based rather than a raw text-pair encoder: each source is
embedded independently (via the shared TF-IDF+SVD/mDeBERTa backend),
then we compute a small set of interpretable features from that pair
of vectors plus a lightweight sentiment-polarity lexicon. A
multinomial classifier over those features -- reusing the same
cross-attention-esque idea (compare two encoded sources, don't
concatenate raw text) as the mDeBERTa fusion pattern this reimplements
in TF-IDF-fallback form.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics.pairwise import cosine_similarity

from .embedder import get_embedder
from .training_data import CONTRADICTION_EXAMPLES

LABELS = ["AGREE", "PARTIAL", "CONTRADICT", "INSUFFICIENT"]

POSITIVE_CUES = re.compile(
    r"\b(stable|good|improv\w*|well|high|engaged|consistent|manageable)\b", re.IGNORECASE
)
NEGATIVE_CUES = re.compile(
    r"\b(declin\w*|missed|low|concern\w*|drop\w*|worse|not|no\b|denies)\b", re.IGNORECASE
)
INSUFFICIENT_CUES = re.compile(
    r"\b(no data|no check-?ins|not yet|awaiting|insufficient|single data point|nothing notable)\b",
    re.IGNORECASE,
)
# Hedging/degree language ("slightly", "one low score", "mixed")
# softens what would otherwise look like a clean polarity conflict --
# without this, "doing well" + "declined over three check-ins"
# (a real CONTRADICT) and "slightly improved" + "one low score,
# otherwise mixed" (a real PARTIAL) produce the identical crude
# +1/-1 polarity signature, which the classifier can't tell apart.
HEDGE_CUES = re.compile(
    r"\b(slightly|somewhat|a bit|mixed|otherwise|one\s+\w*\s*score|single|partial\w*)\b",
    re.IGNORECASE,
)


def _polarity_score(text: str) -> float:
    pos = len(POSITIVE_CUES.findall(text))
    neg = len(NEGATIVE_CUES.findall(text))
    total = pos + neg
    return (pos - neg) / total if total > 0 else 0.0


@dataclass
class ContradictionResult:
    label: str
    confidence: float
    scores: dict[str, float]
    cosine_similarity: float
    reasoning: str


class ContradictionDetector:
    def __init__(self):
        self.embedder = get_embedder()
        all_texts = [a for a, _, _ in CONTRADICTION_EXAMPLES] + [
            b for _, b, _ in CONTRADICTION_EXAMPLES
        ]
        self.embedder.fit(all_texts)

        features = []
        labels = []
        for a, b, label in CONTRADICTION_EXAMPLES:
            features.append(self._features(a, b))
            labels.append(label)
        X = np.array(features)
        # C=10 (lighter regularization than sklearn's default C=1):
        # with only 7 hand-picked, interpretable features and a
        # few hundred rows, under-regularizing isn't a real
        # overfitting risk, and the default C was too eager to
        # shrink the hedge/strong_opposite coefficients that do the
        # actual PARTIAL-vs-CONTRADICT separating.
        self.model = LogisticRegression(max_iter=2000, class_weight="balanced", C=10.0)
        self.model.fit(X, labels)

    def _features(self, source_a: str, source_b: str) -> list[float]:
        vec_a = self.embedder.transform([source_a])
        vec_b = self.embedder.transform([source_b])
        sim = float(cosine_similarity(vec_a, vec_b)[0][0])
        polarity_a = _polarity_score(source_a)
        polarity_b = _polarity_score(source_b)
        polarity_diff = abs(polarity_a - polarity_b)
        # Distinguishes a clean AGREE/CONTRADICT (one side clearly
        # positive, the other clearly negative) from PARTIAL (one
        # side neutral/mixed, the other mildly one way) -- polarity
        # diff alone collapses both into the same "diff is big"
        # signal, which under-separates PARTIAL from CONTRADICT.
        strong_opposite = float(
            (polarity_a > 0.3 and polarity_b < -0.3) or (polarity_a < -0.3 and polarity_b > 0.3)
        )
        hedge_signal = float(
            bool(HEDGE_CUES.search(source_a)) or bool(HEDGE_CUES.search(source_b))
        )
        insufficient_signal = float(
            bool(INSUFFICIENT_CUES.search(source_a)) or bool(INSUFFICIENT_CUES.search(source_b))
        )
        return [
            sim,
            polarity_a,
            polarity_b,
            polarity_diff,
            strong_opposite,
            hedge_signal,
            insufficient_signal,
        ]

    def classify(self, source_a: str, source_b: str) -> ContradictionResult:
        feats = self._features(source_a, source_b)
        proba = self.model.predict_proba(np.array([feats]))[0]
        scores = dict(zip(self.model.classes_, (float(p) for p in proba)))
        for label in LABELS:
            scores.setdefault(label, 0.0)
        best_label = max(scores, key=lambda k: scores[k])
        return ContradictionResult(
            label=best_label,
            confidence=scores[best_label],
            scores=scores,
            cosine_similarity=feats[0],
            reasoning=(
                f"cosine_similarity={feats[0]:.3f}, polarity_diff={feats[3]:.3f}, "
                f"strong_opposite={'yes' if feats[4] else 'no'}, "
                f"hedge_cue={'yes' if feats[5] else 'no'}, "
                f"insufficient_cue={'yes' if feats[6] else 'no'} -> {best_label}"
            ),
        )


@lru_cache(maxsize=1)
def get_contradiction_detector() -> ContradictionDetector:
    return ContradictionDetector()
