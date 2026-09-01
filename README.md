# SAHAYAK — AI Care Coordination System

Production-grade simulation of an AI-agent care coordination system —
the "product heart" of an autonomous psychiatric care platform where
AI agents act as coworkers to clinicians, not chatbots.

**All patient data is synthetic and clearly fabricated. No real PHI, no real patients.**

See [`Sahayak_Spec.md`](./Sahayak_Spec.md) for the full specification, architectural
decisions, and the 8 edge cases this system is built to handle explicitly.

## Status: Phase 2 — Python Safety Service

Implemented so far:

- `core/` — Node/TypeScript backend
  - `src/events/` — immutable, append-only event log (`eventStore.ts`), event bus (`eventBus.ts`), and the full event-type catalog (`eventTypes.ts`)
  - `src/state-machine/careStage.ts` — XState machine for the explicit `care_stage` field (Intake → Active Care → Maintenance → Discharged, with illegal-transition guards)
  - `src/state-machine/riskLevel.ts` — `risk_level` (Stable/Watch/Crisis) computed **live** from the event stream, never stored
  - `src/state-machine/engagement.ts` — `engagement_status` (Active/Unresponsive/Disengaged) computed **live** from the event stream
  - `src/index.ts` — `World` class wiring the three independent world-state dimensions together
  - `src/db/schema.sql` — Postgres/Supabase schema (patients, immutable events, care_stage history)
- `seed-data/generate_synthetic_patients.ts` — generates 22 clearly-synthetic patient journeys covering all three dimensions, including early previews of Edge Cases 3 and 4
- `core/tests/` — 27 passing tests covering state transitions, event-store immutability, and risk/engagement computation from varied event sequences
- `safety-service/` — Python/FastAPI encoder-based safety microservice
  - `app/embedder.py` — TF-IDF+SVD embedding by default; optional mDeBERTa-v3 backend behind `SAHAYAK_USE_MDEBERTA=1`, with automatic fallback if `torch`/`transformers` aren't available
  - `app/crisis_classifier.py` — conservative CRISIS/NOT_CRISIS detector (Edge Cases 1 & 2): hard-coded keyword patterns always win, ML threshold calibrated to favor recall
  - `app/trust_classifier.py` — 4-class VERIFIED/UNCERTAIN/SUSPICIOUS/UNRELIABLE verification of agent-drafted text
  - `app/contradiction_detector.py` — 4-class AGREE/PARTIAL/CONTRADICT/INSUFFICIENT detector over pairs of data sources (Edge Case 4), feature-based on embedding similarity + polarity/hedge lexicon cues
  - `app/injection_detector.py` — INJECTION/CLEAN detector for text entering agent context
  - `app/training_data.py` — 260 synthetic labeled examples across all four classifiers
  - `app/main.py` — FastAPI app; `POST /safety/verify-action` is the combined endpoint the Node core calls per proposed action
  - `tests/` — 28 passing tests, including the sarcasm/subtle-crisis/injection/contradiction edge cases from spec Section 4.3

## Setup

Requires Node.js 20+ and Python 3.11+.

```bash
# Core backend
cd core
npm install
npm run build   # compile TypeScript
npm test        # run the vitest suite
npm run seed    # generate seed-data/output/patients.json

# Safety service
cd ../safety-service
pip install -r requirements.txt
pytest -v                                  # run the test suite
python -m uvicorn app.main:app --reload    # run the API locally
```

## Not yet built

Agent orchestration/action system, full edge-case handling, evaluation
harness, clinician dashboard, and docs — see `Sahayak_Spec.md` Section 8
for the remaining build phases.
