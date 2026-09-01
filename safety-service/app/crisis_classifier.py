"""
Crisis-language classifier (Edge Cases 1 & 2).

Runs independently on EVERY inbound patient message -- not gated on
whether the main agent decided to check. Two failure modes matter
here, in tension with each other:

  Edge Case 1 (false negative): missing genuine, often indirect
  crisis language is the worst possible failure of this classifier.
  We bias hard toward recall: a low decision threshold, plus a
  conservative keyword net that can override a low ML score outright.

  Edge Case 2 (false positive / over-triggering): sarcasm and
  hyperbole ("dying of embarrassment") use crisis-adjacent words with
  no genuine risk. Over-flagging erodes trust in the system and
  drowns clinicians in noise. We don't fix this by raising the
  threshold (that would reintroduce Edge Case 1) -- we fix it
  downstream, by routing every flag to a FAST triage queue for quick
  human confirm/dismiss rather than a full alarm workflow (see
  main.py's /safety/crisis response shape and the `severity` field).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
from sklearn.linear_model import LogisticRegression

from .embedder import get_embedder
from .training_data import CRISIS_EXAMPLES

# Conservative: ANY hit routes to the fast triage queue regardless of
# the ML score. These are explicit, unambiguous phrasings -- kept
# separate from ML so a classifier trained on a small synthetic
# corpus can never "learn its way out of" catching them.
HARD_KEYWORD_PATTERNS = [
    r"\bkill (myself|me)\b",
    r"\bend(ing)?\s+(my|it all|it)\b.*\blife\b",
    r"\bsuicid\w*",
    r"\bnot (be|being) here anymore\b",
    r"\bdon'?t want to (be here|exist|live) anymore\b",
    r"\bself[-\s]?harm\b",
    r"\bwant(ed)? to die\b",
]

# Decision threshold on the ML crisis probability. Calibrated against
# the training corpus so it sits in the gap between genuine crisis
# scores (~0.6-0.99) and sarcastic/neutral scores (~0.37-0.38) --
# still favors recall over precision (Edge Case 1), with the fast
# triage queue as the safety net for resulting false positives
# (Edge Case 2), rather than pushed all the way down to the noise
# floor of a small synthetic training set.
CRISIS_PROBABILITY_THRESHOLD = 0.5


@dataclass
class CrisisResult:
    is_crisis: bool
    probability: float
    matched_keyword: str | None
    reasoning: str
    label: str = field(init=False)

    def __post_init__(self):
        self.label = "CRISIS" if self.is_crisis else "NOT_CRISIS"


class CrisisClassifier:
    def __init__(self):
        texts = [t for t, _ in CRISIS_EXAMPLES]
        labels = [1 if lbl == "CRISIS" else 0 for _, lbl in CRISIS_EXAMPLES]
        self.embedder = get_embedder()
        X = self.embedder.fit_transform(texts)
        self.model = LogisticRegression(max_iter=1000, class_weight="balanced")
        self.model.fit(X, labels)
        self._keyword_re = re.compile("|".join(HARD_KEYWORD_PATTERNS), re.IGNORECASE)

    def classify(self, text: str) -> CrisisResult:
        keyword_match = self._keyword_re.search(text)
        vec = self.embedder.transform([text])
        probability = float(self.model.predict_proba(vec)[0][1])

        if keyword_match:
            return CrisisResult(
                is_crisis=True,
                probability=max(probability, 0.99),
                matched_keyword=keyword_match.group(0),
                reasoning="Matched conservative hard-coded crisis keyword pattern (overrides ML score).",
            )

        is_crisis = probability >= CRISIS_PROBABILITY_THRESHOLD
        return CrisisResult(
            is_crisis=is_crisis,
            probability=probability,
            matched_keyword=None,
            reasoning=(
                f"ML crisis-language probability {probability:.3f} "
                f"{'>=' if is_crisis else '<'} threshold {CRISIS_PROBABILITY_THRESHOLD}."
            ),
        )


@lru_cache(maxsize=1)
def get_crisis_classifier() -> CrisisClassifier:
    return CrisisClassifier()
