# SAHAYAK — End-to-End Demo Script

A concrete walkthrough: seed data → run a scenario → show the
dashboard → show the audit trail. ~10 minutes.

## 0. Start the three services

```bash
# Terminal 1 — safety service
cd safety-service
pip install -r requirements.txt   # first time only
python -m uvicorn app.main:app

# Terminal 2 — dashboard API (seeds ~8 synthetic patients through the
# real orchestrator on boot — this IS the "seed data" step)
cd core
npm install   # first time only
npm run dashboard

# Terminal 3 — frontend
cd frontend
npm install   # first time only
npm run dev
```

Open `http://localhost:5173`.

## 1. Seed data (already done — verify it)

The **Patients** tab should show 8 synthetic patients spanning all
three world-state dimensions: a stable Intake, a Watch/declining
pattern, a Crisis flag, a borderline message, a data contradiction, a
stale-memory case, a Discharged patient, and one demonstrating repeated
overrides. Terminal 2's log line `Seeded 8 synthetic patients.`
confirms this ran through the real orchestrator, not just `World`
state — that's why some of them already have queue entries.

## 2. Run a scenario live

Click into **Synthetic Subject — Stable Intake**. In the "Simulate an
inbound patient message" box, type a message that reads as indirect
crisis language and press Enter:

```
I've stopped making plans because I don't think I'll be around much longer.
```

This runs through the *real* orchestrator and the *real* safety
service — the same code path `eval-harness/run_eval.ts`'s
`subtle_genuine_crisis` scenario exercises. Watch the timeline update:

- A `PATIENT_MESSAGE_RECEIVED` event appears.
- A `CRISIS_FLAG_RAISED` event appears (the independent classifier
  fired unconditionally — Edge Case 1).
- The patient's risk badge flips to **Crisis**.
- An `ESCALATE_CRISIS` action appears as `proposed`, `HIGH` tier — a
  draft, not an execution (spec 2.2: HIGH tier never auto-executes).

## 3. Show the dashboard's two queues

**Fast Triage tab**: the crisis flag from step 2 is here, not buried
in the full approval queue — Edge Case 2's point: a clinician can
confirm or dismiss it in one click. Click **Confirm — genuine**: this
approves and executes the underlying `ESCALATE_CRISIS` action.

**Approval Queue tab**: shows every other `proposed` action, including
anything currently *blocked* rather than merely HIGH-tier — click into
**Synthetic Subject — Stale Memory** from the Patients tab first to
see why: a `FLAG_MOOD_PATTERN` action sits blocked with
`blockRecord.reason: "stale_facts"`, listing which 45+-day-old events
need reconfirmation before it can execute (Edge Case 3). Clicking
**Approve** here is the explicit human override of that automated
block — a legitimate clinical judgment call, not a bypass.

## 4. Show the contradiction case

Open **Synthetic Subject — Contradiction**. The timeline shows a
`FLAG_DATA_CONTRADICTION` action, already `completed` (it always
executes — the point is surfacing the disagreement, not blocking it).
Its payload carries the clinician note ("doing well, fully engaged")
and the check-in data ("mood scores are declining... 8, 5, 3")
**verbatim, side by side** — never averaged into one synthesized
verdict (Edge Case 4).

## 5. Show the audit trail

Back on any patient's timeline, find a 🔒 **Reasoning trace** entry and
click **Reveal**. This calls `GET /api/reasoning-traces/:id`, which:

1. Checks `requesterId` (the dashboard's demo clinician) against
   `PHIAccessControl` — the *same* check that would gate the patient
   record itself.
2. Decrypts the AES-256-GCM-encrypted content only if access is
   granted.
3. Appends an entry to the access ledger regardless of outcome.

To see the ledger itself:

```bash
curl "http://localhost:4000/api/patients/<patient-id>/audit-log"
```

Every read attempt for that patient is listed — `granted: true/false`
— proving access to the reasoning trace is itself audited (Edge Case
7).

## 6. (Optional) Run the full evaluation harness

```bash
cd core
npx tsx ../eval-harness/run_eval.ts
```

All 7 mandatory scenarios (spec 4.3) run against this same live
system and should report `7/7 scenarios passed`.

## 7. (Optional) Run the full test suites

```bash
cd core && npm test               # 83 tests
cd ../safety-service && pytest -v # 28 tests
```
