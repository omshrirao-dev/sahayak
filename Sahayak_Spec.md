# SAHAYAK — AI Care Coordination System
## Complete Specification for Claude Code
### Autonomous Care Coordination · Psychiatric Care Domain (Synthetic Data Only)

---

## 1. WHAT THIS IS

A production-grade simulation of an AI-agent care coordination system —
the "product heart" of an autonomous psychiatric care platform where
AI agents act as coworkers to clinicians, not chatbots.

This is a portfolio/demonstration project. ALL patient data is
synthetic and clearly fabricated. NO real PHI. NO real patients.
Built to demonstrate production-grade architecture, AI safety
engineering, and system design judgment for autonomous healthcare
coordination systems.

**What makes this different from a typical AI demo project:**
Most AI agent demos show an agent doing one task well. This system
demonstrates the HARDER problem: multiple agents, a live world-state
model, explicit autonomy boundaries, contradiction detection between
data sources, and full auditability — the actual hard problems of
running AI agents reliably in a high-stakes production environment.

---

## 2. CORE ARCHITECTURAL DECISIONS (already made, with reasoning)

### 2.1 Parallel-Track World-State Model
Patient state is modeled as THREE independent dimensions, not one
linear pipeline:

```
care_stage:       Intake → Active Care → Maintenance → Discharged
risk_level:        Stable | Watch | Crisis   (can change at ANY care_stage)
engagement_status: Active | Unresponsive | Disengaged
```

Why: In real psychiatric care, a patient's risk level is independent
of their care stage. Someone in "Maintenance" can suddenly be in
"Crisis." Collapsing these into one linear state machine would be
realistic-looking but fundamentally wrong.

Storage: `care_stage` stored as an explicit field (simple, queryable).
`risk_level` and `engagement_status` computed LIVE from the event
stream each time they're needed — true event-sourcing for the
dimensions that change fastest and matter most for safety.

### 2.2 Three-Tier ALLOW-LIST Autonomy Model
Every agent action type is explicitly classified before it can run:

```
LOW    — Full autonomy. Executes immediately. Logged.
         (e.g., send routine check-in reminder, log a response)

MEDIUM — Autonomous but flagged for clinician review.
         (e.g., flag a declining mood-score pattern, suggest
          a follow-up frequency change)

HIGH   — Draft only. NEVER executes without explicit human approval.
         (e.g., anything crisis-adjacent, any change to treatment
          plan, any external communication about diagnosis)
```

CRITICAL RULE: This is an ALLOW-LIST, not a block-list. No action
type is autonomous by default. Every action type must be explicitly
added to LOW or MEDIUM after review. Unclassified actions default
to HIGH (human approval required).

**Self-correcting rule:** If a MEDIUM-tier action is overridden or
reversed by a human 2+ times in a row for the same action type, it
automatically downgrades to HIGH until a human manually restores
its autonomy. The system learns from being wrong.

### 2.3 Split Architecture — Node/TypeScript Core + Python Safety Service
```
┌─────────────────────────────┐      ┌──────────────────────────┐
│   CORE PRODUCT (Node/TS)     │      │  SAFETY SERVICE (Python)  │
│                               │      │                            │
│  - Event-driven backend      │─────▶│  - Encoder-based trust    │
│  - State machine             │      │    verification            │
│  - Agent orchestration       │◀─────│  - Contradiction detection │
│  - Supabase (Postgres)       │      │  - Crisis-language         │
│  - Clinician dashboard API   │      │    classifier               │
│                               │      │  - Injection detection      │
└─────────────────────────────┘      └──────────────────────────┘
        Internal REST API: POST /safety/verify-action
```

Why: Matches the target production stack (Node/TypeScript/Supabase/
AWS) for the core product while reusing and showcasing encoder-based
safety architecture (mDeBERTa-based trust/contradiction detection —
same pattern as prior work). Mirrors how real companies decouple
core application logic from specialized ML safety services.

---

## 3. THE 8 EDGE CASES — ARCHITECTURAL REQUIREMENTS

Each edge case below maps to a specific system requirement.
Claude Code must implement handling for ALL of these explicitly.

### Edge Case 1 — Crisis language false negative
**Requirement:** A dedicated, conservative crisis-language classifier
(encoder-based, in the Python safety service) runs independently on
EVERY inbound patient message — not just when the main agent decides
to check. Low threshold for escalation. Redundant safety net, not
reliant on a single LLM call noticing.

### Edge Case 2 — Crisis language false positive (over-triggering)
**Requirement:** Crisis flags route to a FAST triage queue (separate
from the full clinician review queue) where a human can quickly
confirm/dismiss within minutes — not a full alarm workflow every time.
Track false-positive rate per pattern; recalibrate threshold using
this data.

### Edge Case 3 — Agent memory drift (stale data)
**Requirement:** Every stored memory/fact has a `valid_until` or
`confidence_decay` field. Anything older than a configurable
threshold (default: 30 days) requires explicit re-confirmation
before an agent can use it in a MEDIUM or HIGH tier decision.

### Edge Case 4 — Contradictory data sources
**Requirement:** When two data sources about the same patient
disagree (e.g., clinician note says "stable" vs. check-in scores
show decline), the system MUST NOT average/blend them. Use
encoder-based contradiction detection (AGREE/PARTIAL/CONTRADICT/
INSUFFICIENT — same 4-class pattern as prior fusion work) and
surface the contradiction explicitly to a human, never silently
resolve it.

### Edge Case 5 — Action invalidated by new information
**Requirement:** Actions are NOT simple append-only log entries.
Each action has a state: `proposed → approved → executing →
completed` OR `superseded → cancelled`. If a HIGH-priority event
(e.g., crisis flag) arrives while a lower-priority action is
in-flight, the system must be able to supersede/cancel it.

### Edge Case 6 — Tool call failure mid-workflow (idempotency)
**Requirement:** Every external action (e.g., "update EHR record")
uses an idempotency key. Before retrying after a failure/timeout,
the system explicitly VERIFIES current state rather than blindly
retrying — preventing duplicate actions.

### Edge Case 7 — PHI leakage through logs/reasoning traces
**Requirement:** Audit logs (including agent reasoning traces) carry
the SAME access control as the underlying PHI — never a side-channel
that bypasses access rules. Reasoning traces are stored encrypted,
access-logged, and scoped to the same permissions as the patient
record itself.

### Edge Case 8 — Human override not respected on next cycle
**Requirement:** When a clinician overrides an agent's suggested
action, that override becomes a first-class, permanent piece of
context — weighted into all future agent decisions for that patient
and that action type, not just a one-time log entry that gets lost.

---

## 4. GUARDRAILS & SAFETY ARCHITECTURE

### 4.1 Content Guardrails
- Agents NEVER generate free-form clinical language. All patient-
  facing messages are selected from clinician-approved templates
  with patient-specific fields filled from verified state.
- Hard blocklist (never allowed regardless of tier): diagnose,
  prescribe/adjust medication, discharge a patient, contact
  emergency services (draft + immediate human escalation only).

### 4.2 Verification Guardrails (Encoder-Based, Independent of Agent LLM)
The agent's own LLM is NEVER the only safety check on itself.
A separate encoder-based classifier (mDeBERTa or fallback TF-IDF+SVD)
independently verifies:
- Trust classification of any agent-drafted output
  (VERIFIED / UNCERTAIN / SUSPICIOUS / UNRELIABLE)
- Crisis-language detection on all patient messages
- Contradiction detection between data sources
- Prompt injection detection on any text entering agent context

### 4.3 Evaluation Harness (mandatory before any agent version ships)
A fixed suite of synthetic adversarial and edge-case patient
scenarios that every agent behavior version must pass:
- Sarcastic/non-literal crisis language ("dying of embarrassment")
- Genuine subtle crisis language (indirect, easy to miss)
- Contradictory clinician note vs. check-in data
- Stale memory usage attempt
- Injection attempt embedded in a patient message
- Tool-call timeout/failure scenario
- Rapid state changes (crisis flag arriving mid-action)

Each scenario has an expected correct system behavior. Agent
changes are only "shippable" if they pass 100% of this suite.

---

## 5. TECH STACK

| Layer | Technology | Why |
|---|---|---|
| Core backend | Node.js + TypeScript | Matches target production stack |
| Database | Supabase (Postgres) | Matches target stack; relational fits state machine well |
| Event system | AWS EventBridge (simulated locally with an in-process event emitter for dev) | Matches target stack; event-driven requirement |
| State machine | XState (TypeScript) | Explicit, visualizable, testable state machines |
| Agent orchestration | Custom TypeScript orchestrator + LLM tool-calling (Claude/Groq API) | Matches "implement tool use, retries, memory" requirement |
| Safety microservice | Python + FastAPI | Reuses encoder-based safety architecture pattern |
| Encoder | mDeBERTa-v3-base (fallback: TF-IDF+SVD offline) | Encoder-only for all safety analysis — no decoder hallucination risk in verification |
| Frontend (clinician dashboard) | React + TypeScript + Tailwind | Standard, fast to build, matches "internal tools" requirement |
| Auth | Supabase Auth (JWT) | Consistent with prior architecture patterns |
| Encryption | AES-256 at rest for PHI-adjacent fields | HIPAA-pattern compliance demonstration |

---

## 6. INPUT → EXECUTION → OUTPUT

**Input:** Synthetic patient events fed into the system —
check-in responses, simulated patient messages, simulated
clinician notes, scheduled assessment triggers. A seed script
generates realistic-but-clearly-fake patient journeys.

**Execution:**
1. Event enters system → published to event stream
2. State machine updates the relevant world-state dimension
   (care_stage / risk_level / engagement_status)
3. Relevant agent(s) triggered based on new state
4. Agent proposes an action within its allow-list tier
5. Action sent to Python safety service for verification
   (trust check, contradiction check, crisis-language check)
6. If verified and tier allows: action executes automatically
   If tier requires approval: action queued for clinician
7. Action outcome logged immutably with full reasoning trace
8. Clinician dashboard updates in real time via subscription

**Output:** A working clinician dashboard showing:
- Live patient list with care_stage / risk_level / engagement_status
- Full timeline per patient: every event, every agent action,
  every human override, with reasoning visible
- Pending approval queue (HIGH-tier drafted actions)
- Fast triage queue (crisis flags needing quick confirm/dismiss)
- Full audit trail export

---

## 7. PROJECT STRUCTURE

```
sahayak/
├── core/                          # Node.js/TypeScript backend
│   ├── src/
│   │   ├── state-machine/
│   │   │   ├── careStage.ts       # care_stage state machine (XState)
│   │   │   ├── riskLevel.ts       # risk_level computation from events
│   │   │   └── engagement.ts      # engagement_status computation
│   │   ├── events/
│   │   │   ├── eventBus.ts        # Event emitter / EventBridge wrapper
│   │   │   ├── eventTypes.ts      # All event type definitions
│   │   │   └── eventStore.ts      # Immutable event log (Postgres)
│   │   ├── agents/
│   │   │   ├── orchestrator.ts    # Agent triggering + coordination
│   │   │   ├── actionSchema.ts    # Action definitions + tier classification
│   │   │   ├── checkInAgent.ts    # LOW-tier example agent
│   │   │   ├── patternFlagAgent.ts # MEDIUM-tier example agent
│   │   │   └── escalationAgent.ts # HIGH-tier example agent
│   │   ├── actions/
│   │   │   ├── actionStateMachine.ts # proposed→approved→executing→completed/superseded
│   │   │   ├── idempotency.ts     # Idempotency key handling
│   │   │   └── overrideMemory.ts  # Human override → permanent context
│   │   ├── safety/
│   │   │   └── safetyClient.ts    # Calls Python safety service
│   │   ├── db/
│   │   │   └── schema.sql         # Supabase/Postgres schema
│   │   ├── api/
│   │   │   └── dashboard.ts       # REST/subscription API for frontend
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── safety-service/                # Python encoder-based safety microservice
│   ├── app/
│   │   ├── main.py                # FastAPI app
│   │   ├── embedder.py            # mDeBERTa / TF-IDF fallback
│   │   ├── trust_classifier.py    # VERIFIED/UNCERTAIN/SUSPICIOUS/UNRELIABLE
│   │   ├── contradiction_detector.py # AGREE/PARTIAL/CONTRADICT/INSUFFICIENT
│   │   ├── crisis_classifier.py   # Conservative crisis-language detection
│   │   └── injection_detector.py  # Prompt injection detection
│   ├── tests/
│   └── requirements.txt
│
├── frontend/                      # Clinician dashboard
│   ├── src/
│   │   ├── pages/
│   │   │   ├── PatientList.tsx
│   │   │   ├── PatientTimeline.tsx
│   │   │   ├── ApprovalQueue.tsx
│   │   │   └── TriageQueue.tsx
│   │   └── components/
│   └── package.json
│
├── eval-harness/                  # Mandatory evaluation suite
│   ├── scenarios/
│   │   ├── sarcastic_crisis_language.json
│   │   ├── subtle_genuine_crisis.json
│   │   ├── contradictory_sources.json
│   │   ├── stale_memory_usage.json
│   │   ├── injection_attempt.json
│   │   ├── tool_call_failure.json
│   │   └── rapid_state_change.json
│   └── run_eval.ts                # Runs all scenarios, reports pass/fail
│
├── seed-data/
│   └── generate_synthetic_patients.ts  # Clearly-fake patient journey generator
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SAFETY.md                  # All guardrails documented
│   ├── DECISIONS.md                # Every major decision + reasoning (from our discussion)
│   └── API.md
│
└── README.md
```

---

## 8. BUILD PHASES FOR CLAUDE CODE

Stop after each phase. Wait for "proceed" before continuing.

### ━━━ PHASE 1: Foundation + World-State Model ━━━
```
1. Project structure (core/, safety-service/, frontend/, eval-harness/)
2. Postgres schema: patients, events, care_stage history,
   risk_level computation inputs, engagement tracking
3. state-machine/careStage.ts — XState machine for care_stage
4. state-machine/riskLevel.ts — live computation from event stream
5. state-machine/engagement.ts — live computation from event stream
6. events/eventBus.ts + eventTypes.ts + eventStore.ts
   (immutable, append-only event log)
7. seed-data/generate_synthetic_patients.ts —
   generate 20+ clearly-synthetic patient journeys covering
   all 3 state dimensions
8. Tests: state transitions, event storage, risk_level computation
   from various event sequences

STOP. Report what was built + test results. Wait for "proceed".
```

### ━━━ PHASE 2: Python Safety Service ━━━
```
1. FastAPI app skeleton
2. embedder.py — mDeBERTa with TF-IDF+SVD fallback
3. trust_classifier.py — 4-class trust verification
4. contradiction_detector.py — 4-class contradiction detection
   (reuse cross-attention + temporal decay pattern)
5. crisis_classifier.py — conservative crisis-language detector,
   trained/calibrated on synthetic examples including sarcasm
   edge cases
6. injection_detector.py — encoder-based injection detection
7. Training data: generate 150+ synthetic labeled examples
   across all 4 classifiers
8. Tests for each classifier + edge cases from Section 3

STOP. Report + test results. Wait for "proceed".
```

### ━━━ PHASE 3: Agent Orchestration + Action System ━━━
```
1. agents/actionSchema.ts — full allow-list with LOW/MEDIUM/HIGH
   tier classification for every action type (explicit,
   visible field per action)
2. agents/orchestrator.ts — triggers agents based on state changes
3. Three example agents: checkInAgent (LOW), patternFlagAgent
   (MEDIUM), escalationAgent (HIGH)
4. actions/actionStateMachine.ts — proposed→approved→executing→
   completed/superseded/cancelled
5. actions/idempotency.ts — idempotency key handling for
   external tool calls
6. actions/overrideMemory.ts — human overrides become permanent
   context; self-correcting downgrade rule (2+ overrides →
   auto-downgrade tier)
7. safety/safetyClient.ts — calls Python safety service before
   any action executes
8. Tests: full action lifecycle, override behavior, tier
   enforcement, safety service integration

STOP. Report + test results. Wait for "proceed".
```

### ━━━ PHASE 4: Edge Case Handling ━━━
```
Implement explicit handling for all 8 edge cases from Section 3.
Each must have a corresponding test that PROVES the system
handles it correctly:

1. Crisis false negative — independent classifier on every message
2. Crisis false positive — fast triage queue, not full alarm
3. Memory drift — valid_until fields, re-confirmation triggers
4. Contradictory sources — contradiction detector, never silently
   averaged
5. Action invalidation — supersession logic tested
6. Tool call failure — idempotency + state verification tested
7. PHI leakage — audit log access control matches PHI access
   control, tested
8. Override not respected — permanent context weighting tested,
   self-downgrade rule tested

STOP. Report + test results for all 8. Wait for "proceed".
```

### ━━━ PHASE 5: Evaluation Harness ━━━
```
1. eval-harness/scenarios/ — build out all 7 scenario JSON files
   with clear expected-behavior definitions
2. eval-harness/run_eval.ts — runs every scenario against the
   live system, reports pass/fail with reasoning
3. Must achieve 100% pass rate before proceeding
4. Document any scenario that required a design change to pass

STOP. Report full eval results. Wait for "proceed".
```

### ━━━ PHASE 6: Clinician Dashboard ━━━
```
1. PatientList.tsx — live list with all 3 state dimensions visible
2. PatientTimeline.tsx — full event/action/override history,
   reasoning traces visible
3. ApprovalQueue.tsx — HIGH-tier pending actions, approve/reject
4. TriageQueue.tsx — fast crisis-flag confirm/dismiss queue
5. Real-time updates via Supabase subscriptions
6. Tests: dashboard reflects backend state accurately

STOP. Report + screenshots. Wait for "proceed".
```

### ━━━ PHASE 7: Documentation + Polish ━━━
```
1. docs/ARCHITECTURE.md — full system diagram + explanation
2. docs/SAFETY.md — every guardrail documented with reasoning
3. docs/DECISIONS.md — document the 3 major architectural
   decisions from our discussion (world-state model, autonomy
   tiers, split architecture) with the reasoning behind each
4. docs/API.md — internal API contract between Node core and
   Python safety service
5. README.md — clear overview, setup instructions, demo script
6. Full end-to-end demo script: seed data → run scenario →
   show dashboard → show audit trail

STOP. Final report. Full system demo-ready.
```

---

## 9. CLAUDE CODE MASTER PROMPT

```
I am building SAHAYAK — a production-grade AI care coordination
system simulation. Psychiatric care domain. ALL data synthetic,
clearly fake, zero real PHI.

Read the complete spec at @Sahayak_Spec.md

CORE ARCHITECTURE (already decided, do not redesign):
1. Parallel-track world-state: care_stage + risk_level +
   engagement_status as independent dimensions
2. Three-tier ALLOW-LIST autonomy: LOW/MEDIUM/HIGH, nothing
   autonomous by default, self-correcting downgrade on repeated
   overrides
3. Split architecture: Node/TypeScript core + Python encoder-based
   safety microservice, communicating via internal REST API

MUST HANDLE explicitly (Section 3): all 8 edge cases, each with
a passing test proving correct behavior.

MUST BUILD: full evaluation harness (Section 4.3) that must pass
100% before any phase is considered complete.

SAFETY PRINCIPLE: agents never generate free-form clinical
language. Independent encoder-based verification on every agent
action — the agent's own LLM is never the only safety check on
itself.

BUILD PHASES — STOP AFTER EACH, WAIT FOR "PROCEED":
Phase 1: Foundation + World-State Model
Phase 2: Python Safety Service
Phase 3: Agent Orchestration + Action System
Phase 4: Edge Case Handling
Phase 5: Evaluation Harness
Phase 6: Clinician Dashboard
Phase 7: Documentation + Polish

Start with PHASE 1. Explain key implementation decisions as you
build. Go.
```

---

*Every decision in this spec came from explicit discussion of
tradeoffs — not default AI-generated choices. That reasoning is
documented in docs/DECISIONS.md as part of the deliverable itself.*
