# SAHAYAK — AI Care Coordination System

A production-grade simulation of an AI-agent care coordination system —
the "product heart" of an autonomous psychiatric care platform where AI
agents act as coworkers to clinicians, not chatbots.

**All patient data is synthetic and clearly fabricated. No real PHI, no real patients.**

This is a portfolio/demonstration project built to show the *harder*
problem most AI-agent demos skip: not "an agent doing one task well,"
but multiple agents, a live world-state model, explicit autonomy
boundaries, contradiction detection between data sources, and full
auditability — the actual hard problems of running AI agents reliably
in a high-stakes production environment. The full specification,
including the reasoning behind every pre-made architectural decision,
is at [`Sahayak_Spec.md`](./Sahayak_Spec.md).

## What's here

| Layer | Stack | |
|---|---|---|
| Core backend | Node.js + TypeScript | Event-driven state machine, agent orchestration, action lifecycle |
| Safety service | Python + FastAPI + scikit-learn | 4 independent encoder-based classifiers — crisis, trust, contradiction, injection |
| Dashboard | React + TypeScript + Tailwind | Live clinician-facing patient list, timeline, approval queue, fast triage |
| Eval harness | TypeScript, run against the live system | 7 mandatory adversarial/edge-case scenarios (spec 4.3) |

**Docs:**
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) (system diagram + request flow) ·
[`docs/SAFETY.md`](./docs/SAFETY.md) (every guardrail + all 8 edge cases, with reasoning) ·
[`docs/DECISIONS.md`](./docs/DECISIONS.md) (why the 3 major architectural calls were made this way, plus decisions made during the build) ·
[`docs/API.md`](./docs/API.md) (Node↔Python contract + dashboard REST API) ·
[`docs/DEMO.md`](./docs/DEMO.md) (step-by-step walkthrough)

## Core architecture, in one paragraph each

**Parallel-track world state.** `care_stage`, `risk_level`, and
`engagement_status` are three independent dimensions, not one linear
pipeline — a patient in `Maintenance` can be in `Crisis`. `care_stage`
is an explicit XState-governed field; `risk_level` and
`engagement_status` are computed live from an immutable event log and
never stored, so there's no field that can drift from the events that
justify it.

**Allow-list autonomy, not a block-list.** Every agent action type is
explicitly classified LOW (full autonomy) / MEDIUM (autonomous but
always surfaced) / HIGH (draft only, human-approved). Unclassified
action types default to HIGH. A MEDIUM action auto-downgrades to HIGH
after 2 consecutive clinician overrides, and stays downgraded until a
human explicitly restores it.

**Split architecture.** The safety classifiers run in a separate
Python process, not a library the Node core imports — every proposed
action goes through a real HTTP call to verify it, so "the agent's own
LLM is never the only safety check on itself" is a structural
property, not a convention.

See [`docs/DECISIONS.md`](./docs/DECISIONS.md) for the full reasoning
behind each, plus the decisions made during the build that the spec
left open.

## The 8 edge cases

Every one below has a passing test that proves it, not just a design
note. Full detail in [`docs/SAFETY.md`](./docs/SAFETY.md).

1. Crisis language false negative — independent classifier on every message
2. Crisis language false positive — fast triage queue, not a full alarm
3. Agent memory drift — facts expire after 30 days unless reconfirmed
4. Contradictory data sources — surfaced verbatim, never averaged
5. Action invalidated by new information — real lifecycle, supersession
6. Tool call failure — idempotent, verifies state before retrying
7. PHI leakage through logs — reasoning traces share the PHI access control
8. Human override not respected — permanent context, self-correcting downgrade

## Project structure

```
sahayak/
├── core/                Node/TypeScript backend (events, state machines,
│                        agents, actions, safety client, dashboard API)
├── safety-service/      Python/FastAPI encoder-based safety microservice
├── frontend/            React + TypeScript + Tailwind clinician dashboard
├── eval-harness/        Mandatory pre-ship scenario suite, run live
├── seed-data/           Standalone synthetic patient-journey generator
└── docs/                Architecture, safety, decisions, API, demo
```

## Setup

Requires Node.js 20+ and Python 3.11+.

```bash
# Safety service
cd safety-service
pip install -r requirements.txt
pytest -v                          # 28 tests
python -m uvicorn app.main:app     # http://localhost:8000

# Core backend (separate terminal)
cd core
npm install
npm run build   # compile TypeScript
npm test        # 83 tests

# Frontend (separate terminal)
cd frontend
npm install
npm run dev     # http://localhost:5173
```

## Running the demo

With the safety service running, start the dashboard API — it seeds
~8 synthetic patients through the real orchestrator on boot — and the
frontend:

```bash
cd core && npm run dashboard   # http://localhost:4000
cd frontend && npm run dev     # http://localhost:5173
```

Then follow [`docs/DEMO.md`](./docs/DEMO.md) for a scripted walkthrough:
seed data → run a live crisis scenario → triage/approval queues →
contradiction surfacing → the encrypted, access-controlled audit trail.

Or run the mandatory evaluation harness directly against the live system:

```bash
cd core && npx tsx ../eval-harness/run_eval.ts   # 7/7 scenarios
```

## Status: all 7 build phases complete

Foundation & world-state model → Python safety service → agent
orchestration & action system → all 8 edge cases → evaluation harness
→ clinician dashboard → documentation. 111 automated tests across
TypeScript and Python (83 + 28), plus 7/7 eval-harness scenarios,
all passing against the live system.
