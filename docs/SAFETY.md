# SAHAYAK — Safety Architecture

Every guardrail below exists because of a specific failure mode, not
as generic AI-safety theater. Each entry names the failure mode, the
mechanism, and where it lives in the code.

## 1. Content guardrails (spec 4.1)

**Agents never generate free-form clinical language.** Every
patient-facing or clinician-facing action carries a `draftedText`
field that agents construct from fixed templates and verified state —
never from an LLM's free generation. This is enforced by convention in
agent code (`agents/checkInAgent.ts`, `patternFlagAgent.ts`,
`escalationAgent.ts`, `contradictionAgent.ts`) and checked
independently by the trust classifier (§3 below).

We hit this directly while building the dashboard (Phase 6):
`escalationAgent`'s drafted text originally embedded the crisis
classifier's raw reasoning string verbatim (e.g. *"ML crisis-language
probability 0.681 >= threshold 0.5"*). That's not a clinical summary,
it's leaked system internals — and the trust classifier correctly
flagged it `UNRELIABLE`. Fixed by keeping raw classifier reasoning in
the audit-facing `reason` field and the action payload, never in
`draftedText`.

**Hard blocklist** (`agents/actionSchema.ts`): diagnosing a patient,
prescribing/adjusting medication, and autonomously discharging a
patient can never even be *drafted* by an agent — the orchestrator
rejects the proposal before an `ActionInstance` is created, before the
safety service is even called. Contacting emergency services is the
one exception: a draft can be created, but it's structurally
`requiresImmediateEscalation: true` and can never auto-execute
regardless of tier logic.

## 2. The allow-list (spec 2.2)

Every action type is explicitly classified LOW / MEDIUM / HIGH in
`agents/actionSchema.ts`. **Unclassified action types default to
HIGH** — a newly invented action type nobody has reviewed yet requires
human approval by construction, not by someone remembering to add it
to a blocklist.

**Self-correcting downgrade**: if a MEDIUM-tier action is overridden
by a clinician 2+ times in a row for the same `(patient, actionType)`
pair, it's automatically downgraded to HIGH until a human explicitly
restores autonomy (`actions/overrideMemory.ts`). The system learns
from being told it's wrong, and that learning doesn't silently expire.

## 3. Verification guardrails, independent of the agent's own LLM (spec 4.2)

The safety service (`safety-service/`) is a **separate process**, not
a library the core imports — see `docs/DECISIONS.md` for why that
boundary matters. Four encoder-only classifiers (no generation, so no
hallucination risk in the thing checking for hallucinations):

| Classifier | Classes | Runs on | Edge case |
|---|---|---|---|
| `crisis_classifier.py` | CRISIS / NOT_CRISIS | **Every** inbound patient message, unconditionally (`Orchestrator.handleEvent`) | 1, 2 |
| `injection_detector.py` | INJECTION / CLEAN | **Every** inbound patient message, unconditionally | guardrail 4.2 |
| `trust_classifier.py` | VERIFIED / UNCERTAIN / SUSPICIOUS / UNRELIABLE | Every agent-drafted `draftedText`, via `verify-action` | general |
| `contradiction_detector.py` | AGREE / PARTIAL / CONTRADICT / INSUFFICIENT | Clinician note vs. check-in data (`contradictionAgent`), and any future action that opts in via `contradictionCheck` | 4 |

Both crisis and injection checks used to only run when an agent
happened to attach the relevant text to its own proposal. Phase 4/5
moved them to run unconditionally at the orchestrator level instead —
see Edge Case 1 and the injection-detection entry below for why that
distinction matters.

### Edge Case 1 — crisis language false negative

A dedicated, conservative classifier runs on every inbound message,
independent of any agent's judgment call. Hard-coded keyword patterns
(`crisis_classifier.py`'s `HARD_KEYWORD_PATTERNS`) always override the
ML score — a classifier trained on ~80 synthetic examples should never
be the only thing standing between an explicit statement like "I want
to kill myself" and a response. The ML threshold (0.5) is calibrated
against the actual gap in the training distribution between genuine
crisis scores (~0.6-0.99) and sarcastic/neutral scores (~0.37), biased
toward recall.

**Known, documented limitation**: this classifier produces borderline
(~0.45-0.55) probabilities for a fair number of unrelated,
out-of-distribution sentences — an artifact of a small synthetic
training set. The system's answer isn't a threshold chase, it's
architectural: Edge Case 2's fast-triage queue exists specifically so
a false positive costs one clinician click, not a full alarm. See
`eval-harness/README.md` for the specific example this surfaced.

### Edge Case 2 — crisis language false positive

Crisis flags never go straight into the full approval queue — they go
into `actions/triageQueue.ts`, a separate fast confirm/dismiss queue.
Every dismissal is recorded per matched pattern
(`TriageQueue.getPatternStats`), producing a false-positive rate that
would inform a periodic, reviewed recalibration of the classifier's
threshold. The rate is tracked; the live threshold is never mutated
automatically from that data — recalibration is a deliberate change to
`crisis_classifier.py`, not something that should silently drift at
request-serving time.

### Edge Case 3 — agent memory drift

`state-machine/staleness.ts`: every fact defaults to a 30-day
freshness window (or an explicit `validUntil`) unless explicitly
reconfirmed via a `FACT_RECONFIRMED` event — itself a new event, never
a mutation of history. The orchestrator blocks MEDIUM/HIGH-tier
execution on any action whose source facts are stale
(`Orchestrator.checkSourceFreshness`), regardless of what tier logic
would otherwise allow. A clinician can still explicitly approve a
blocked action from the dashboard — that's the human override of the
automated block, not a bypass of it.

### Edge Case 4 — contradictory data sources

`contradiction_detector.py` never averages or blends disagreeing
sources. `contradictionAgent` compares a new clinician note against
recent check-in data and, on `CONTRADICT`, drafts a
`FLAG_DATA_CONTRADICTION` action carrying **both sources verbatim** —
never a synthesized "resolved" summary. This action deliberately does
*not* set `contradictionCheck` on its own draft (that field would make
the orchestrator's own safety call block the very action meant to
surface the problem); the field stays wired up in
`agentTypes.ts`/`orchestrator.ts` for any future action that *should*
be blocked by contradictory source data.

Building this against the live classifier (Phase 5) surfaced a real
gap: summarizing check-in data as bare numbers ("3, 2, 3") carries no
signal for a lexicon-assisted classifier reading for words like
"declining." Fixed by describing the trend in words alongside the
still-verbatim numbers — see `eval-harness/README.md`.

### Edge Case 5 — action invalidated by new information

Actions have a real lifecycle (`actions/actionStateMachine.ts`):
`proposed → approved → executing → completed`, or
`superseded`/`cancelled`. When a `CRISIS_FLAG_RAISED` event arrives,
`ActionRegistry.supersedeAllInFlightForPatient` cancels every
non-terminal action for that patient before any new action is
proposed — a lower-priority draft can never execute against
now-outdated context.

### Edge Case 6 — tool call failure mid-workflow

`actions/idempotency.ts`: every executed action carries an idempotency
key. Before retrying after a failure, `IdempotencyStore.run` calls
`verifyCurrentState()` to check whether the effect already actually
happened externally — the executor itself is only invoked again if
verification finds nothing. Keys are anchored to the triggering event
id, not to drafted-payload content, so two genuinely different
real-world occurrences that happen to produce textually identical
drafts never collide.

### Edge Case 7 — PHI leakage through logs/reasoning traces

`safety/auditLog.ts` + `safety/phiAccessControl.ts`: every agent
reasoning trace is written AES-256-GCM encrypted and readable only
under the exact same `PHIAccessControl.hasAccess()` check used for the
patient record itself — no separate, looser ACL for "just logs." Every
read attempt, granted or denied, is itself appended to a access ledger
(`AuditLog.getAccessLog`).

### Edge Case 8 — human override not respected on next cycle

`actions/overrideMemory.ts`: every override is a permanent, queryable
record scoped to `(patientId, actionType)` — weighted into all future
decisions for that patient and action type, not a one-time log entry.
This is also what drives the self-correcting downgrade rule (§2
above).

## 4. Evaluation harness (spec 4.3)

`eval-harness/` runs 7 mandatory scenarios against the **live
system** — a real `Orchestrator` wired to the real, running Python
safety service over HTTP, not mocks. See `eval-harness/README.md` for
the scenario list and the two real design gaps this harness caught
(fixed, not worked around) before this system was considered
shippable.
