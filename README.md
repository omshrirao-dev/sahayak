# SAHAYAK — AI Care Coordination System

Production-grade simulation of an AI-agent care coordination system —
the "product heart" of an autonomous psychiatric care platform where
AI agents act as coworkers to clinicians, not chatbots.

**All patient data is synthetic and clearly fabricated. No real PHI, no real patients.**

See [`Sahayak_Spec.md`](./Sahayak_Spec.md) for the full specification, architectural
decisions, and the 8 edge cases this system is built to handle explicitly.

## Status: Phase 1 — Foundation + World-State Model

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

## Setup

Requires Node.js 20+.

```bash
cd core
npm install
npm run build   # compile TypeScript
npm test        # run the vitest suite
npm run seed    # generate seed-data/output/patients.json
```

## Not yet built

Python safety service, agent orchestration/action system, full edge-case
handling, evaluation harness, clinician dashboard, and docs — see
`Sahayak_Spec.md` Section 8 for the remaining build phases.
