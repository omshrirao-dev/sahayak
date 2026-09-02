# SAHAYAK — AI Care Coordination System

Production-grade simulation of an AI-agent care coordination system —
the "product heart" of an autonomous psychiatric care platform where
AI agents act as coworkers to clinicians, not chatbots.

**All patient data is synthetic and clearly fabricated. No real PHI, no real patients.**

See [`Sahayak_Spec.md`](./Sahayak_Spec.md) for the full specification, architectural
decisions, and the 8 edge cases this system is built to handle explicitly.

## Status: Phase 6 — Clinician Dashboard

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
- `core/src/agents/` — allow-list + orchestration
  - `actionSchema.ts` — the LOW/MEDIUM/HIGH allow-list for every action type; unclassified types default to HIGH; a hard blocklist (diagnose, adjust medication, autonomous discharge, contact emergency services) is never autonomous regardless of tier
  - `orchestrator.ts` — routes events → agents → tier resolution (including override-driven downgrades) → safety verification → action lifecycle; the only place allowed to decide whether an action actually executes
  - `checkInAgent.ts` (LOW), `patternFlagAgent.ts` (MEDIUM), `escalationAgent.ts` (HIGH) — three example agents
  - `contradictionAgent.ts` (MEDIUM) — reacts to a new clinician note by comparing it against recent check-in data via the safety service; on CONTRADICT, always executes so the contradiction actually gets surfaced, never blended (Edge Case 4)
- `core/src/actions/` — action lifecycle infrastructure
  - `actionStateMachine.ts` — `proposed → approved → executing → completed / superseded / cancelled`, with a `supersedeAllInFlightForPatient()` hook for Edge Case 5
  - `idempotency.ts` — idempotency-keyed execution that verifies current state before ever retrying (Edge Case 6)
  - `overrideMemory.ts` — permanent per-(patient, action type) override history (Edge Case 8) driving the self-correcting MEDIUM→HIGH downgrade rule after 2 consecutive overrides
  - `triageQueue.ts` — fast confirm/dismiss queue for crisis flags, separate from the full approval queue, with per-pattern false-positive tracking for threshold recalibration (Edge Case 2)
- `core/src/state-machine/staleness.ts` — Edge Case 3: facts default-expire after 30 days (or an explicit `validUntil`) unless explicitly reconfirmed (`FACT_RECONFIRMED` events); the orchestrator blocks MEDIUM/HIGH-tier execution on any stale source fact
- `core/src/safety/` — `safetyClient.ts` (typed client for the Python safety service, fails closed if unreachable; also exposes standalone crisis/contradiction checks), `phiAccessControl.ts` + `auditLog.ts` (Edge Case 7: agent reasoning traces are AES-256-GCM encrypted at rest and gated by the SAME access-control check as the underlying patient record, with every read attempt — granted or denied — itself logged)
- `Orchestrator.handleEvent()` now runs the crisis classifier independently on **every** inbound patient message unconditionally (Edge Case 1), not gated behind any agent's own judgment call
- `core/tests/` — 75 passing tests total, including a dedicated `edgeCases.test.ts` proving Edge Cases 1, 2, 3, 4, and 7 (5, 6, and 8 are proven in `orchestrator.test.ts` / `idempotency.test.ts` from Phase 3) — all 8 edge cases from spec Section 3 now have a passing test
- `eval-harness/` — mandatory pre-ship evaluation suite (spec 4.3), run against the **live system**: a real `Orchestrator` wired to the real, running Python safety service over HTTP, not mocks
  - `scenarios/` — the 7 required scenarios (sarcastic crisis language, subtle genuine crisis, contradictory sources, stale-memory usage, injection attempt, tool-call failure, rapid state change), each a JSON file with its input and expected system behavior
  - `run_eval.ts` — runs every scenario, reports PASS/FAIL with reasoning, exits non-zero on any failure
  - Currently **7/7 passing**. Building this harness against the live service (rather than mocks) surfaced two real gaps, documented in `eval-harness/README.md`: `contradictionAgent`'s check-in summary needed trend wording (not just raw numbers) for the lexicon-assisted contradiction classifier to pick up the signal, and prompt injection detection (guardrail 4.2) wasn't actually wired to run independently on every inbound message until this phase
- `core/src/api/` — the dashboard's REST + WebSocket API server
  - `dashboard.ts` — thin HTTP wrapper (Express) around the already-tested `Orchestrator`/`World` methods: patient list/timeline, approval queue, fast triage queue, reasoning-trace reads, a demo "simulate inbound message" endpoint, and a WebSocket refresh channel that stands in locally for Supabase Realtime subscriptions (same "simulate the managed service locally" pattern as `eventBus.ts` standing in for EventBridge)
  - `seedDemoData.ts` — seeds ~8 synthetic patients **through the real orchestrator** (not just World state) on server boot, so the dashboard has genuine actions/queue content to show
  - `server.ts` — entry point; requires the safety service reachable at boot (fails closed, same posture as everywhere else in the system)
  - `core/tests/dashboard.test.ts` — 8 integration tests hitting the real Express app over HTTP (hermetic, `FakeSafetyClient`-backed) proving the API reflects real backend state accurately
- `frontend/` — React + TypeScript + Tailwind clinician dashboard (Vite)
  - **Patients** — live list with all three world-state dimensions
  - **Patient timeline** — full event/action/override history, plus reasoning traces (encrypted, access-controlled, revealed on click) and a box to simulate an inbound patient message through the live orchestrator
  - **Approval Queue** — HIGH-tier drafted actions, plus anything blocked from auto-executing (stale facts / safety verdict); approve or reject
  - **Fast Triage** — crisis flags awaiting a quick confirm/dismiss, separate from the full approval queue (Edge Case 2)
  - Verified end-to-end with a headless-browser pass (navigation, all three tabs, clicking Approve and watching the queue count change live, revealing an encrypted reasoning trace) — no console errors
- `core/tests/` — **83 passing tests total** (75 from Phases 1-5 + 8 new dashboard integration tests)

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

## Running the full dashboard demo

Three services, in order:

```bash
# 1. Safety service (required -- the dashboard API fails closed without it)
cd safety-service
python -m uvicorn app.main:app

# 2. Dashboard API (seeds demo patients through the real orchestrator on boot)
cd core
npm run dashboard   # http://localhost:4000

# 3. Frontend
cd frontend
npm install          # first time only
npm run dev           # http://localhost:5173
```

## Not yet built

Docs (`docs/ARCHITECTURE.md`, `docs/SAFETY.md`, `docs/DECISIONS.md`,
`docs/API.md`) — see `Sahayak_Spec.md` Section 8, Phase 7.
