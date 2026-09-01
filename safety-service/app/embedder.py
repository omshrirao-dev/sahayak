"""
Encoder-only text embedding for the safety service.

Every safety classifier (trust, contradiction, crisis, injection) goes
through this module rather than calling an LLM -- encoder-only means
no decoder / no free-form generation in the verification path, so
there is no hallucination risk in the thing that is supposed to be
catching hallucinations and unsafe output (spec 5, "Encoder-only for
all safety analysis").

Two backends, selected automatically:

  - mDeBERTa-v3-base (via `transformers`), used only if both `torch`
    and `transformers` are importable AND the env var
    SAHAYAK_USE_MDEBERTA=1 is set. This is opt-in rather than
    default because it requires a multi-hundred-MB model download,
    which is not appropriate to trigger implicitly (e.g. in CI or a
    laptop with no network).
  - TF-IDF + TruncatedSVD (LSA), the default. Pure scikit-learn, no
    network access, no GPU, deterministic given a fixed corpus. This
    is what actually runs in this repo's tests and demo.

Both backends expose the same `TextEmbedder` interface so classifiers
never need to know which one is active.
"""
from __future__ import annotations

import os
from typing import Sequence

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer

USE_MDEBERTA = os.environ.get("SAHAYAK_USE_MDEBERTA") == "1"


class TextEmbedder:
    """Fits on a corpus once, then embeds arbitrary text into that space."""

    backend: str

    def fit(self, corpus: Sequence[str]) -> "TextEmbedder":
        raise NotImplementedError

    def transform(self, texts: Sequence[str]) -> np.ndarray:
        raise NotImplementedError

    def fit_transform(self, corpus: Sequence[str]) -> np.ndarray:
        self.fit(corpus)
        return self.transform(corpus)


class TfidfSvdEmbedder(TextEmbedder):
    """
    Default offline backend. TF-IDF captures lexical signal (crisis
    and injection detection lean heavily on specific phrasing);
    TruncatedSVD (LSA) compresses that into a dense space so
    downstream classifiers get fixed-size, denoised vectors instead
    of a huge sparse bag-of-words matrix.
    """

    backend = "tfidf_svd"

    def __init__(self, n_components: int = 64, random_state: int = 42):
        self.n_components = n_components
        self.random_state = random_state
        self.vectorizer = TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            sublinear_tf=True,
            lowercase=True,
        )
        self.svd: TruncatedSVD | None = None

    def fit(self, corpus: Sequence[str]) -> "TfidfSvdEmbedder":
        sparse = self.vectorizer.fit_transform(corpus)
        # n_components must be < n_features and <= n_samples - 1 for
        # TruncatedSVD; clamp down for small synthetic corpora so
        # fitting never blows up on a short classifier-specific
        # training set.
        n_components = max(2, min(self.n_components, sparse.shape[1] - 1, sparse.shape[0] - 1))
        self.svd = TruncatedSVD(n_components=n_components, random_state=self.random_state)
        self.svd.fit(sparse)
        return self

    def transform(self, texts: Sequence[str]) -> np.ndarray:
        if self.svd is None:
            raise RuntimeError("TfidfSvdEmbedder.fit() must be called before transform()")
        sparse = self.vectorizer.transform(texts)
        return self.svd.transform(sparse)


class MDebertaEmbedder(TextEmbedder):
    """
    mDeBERTa-v3-base backend. Only constructed when both `torch` and
    `transformers` are available -- see get_embedder() below. Uses
    mean-pooled last-hidden-state as the sentence embedding, which is
    a fixed, non-generative operation (no decoding, no sampling).
    """

    backend = "mdeberta"
    MODEL_NAME = "microsoft/mdeberta-v3-base"

    def __init__(self):
        import torch  # noqa: F401  (import guarded by caller)
        from transformers import AutoModel, AutoTokenizer

        self._torch = __import__("torch")
        self.tokenizer = AutoTokenizer.from_pretrained(self.MODEL_NAME)
        self.model = AutoModel.from_pretrained(self.MODEL_NAME)
        self.model.eval()

    def fit(self, corpus: Sequence[str]) -> "MDebertaEmbedder":
        # Pretrained encoder -- nothing to fit on the corpus itself.
        return self

    def transform(self, texts: Sequence[str]) -> np.ndarray:
        torch = self._torch
        with torch.no_grad():
            batch = self.tokenizer(
                list(texts), padding=True, truncation=True, return_tensors="pt", max_length=256
            )
            out = self.model(**batch)
            mask = batch["attention_mask"].unsqueeze(-1).float()
            summed = (out.last_hidden_state * mask).sum(dim=1)
            counts = mask.sum(dim=1).clamp(min=1e-9)
            pooled = summed / counts
        return pooled.cpu().numpy()


def get_embedder(n_components: int = 64) -> TextEmbedder:
    """
    Returns the mDeBERTa embedder if explicitly enabled and importable,
    otherwise the TF-IDF+SVD fallback. Failure to load mDeBERTa (no
    network, no torch installed, etc.) degrades to the fallback rather
    than raising -- the safety service must stay up even without the
    heavier backend.
    """
    if USE_MDEBERTA:
        try:
            return MDebertaEmbedder()
        except Exception:
            pass
    return TfidfSvdEmbedder(n_components=n_components)
