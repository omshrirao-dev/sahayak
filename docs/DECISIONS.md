# SAHAYAK — Architectural Decisions

The spec (`Sahayak_Spec.md`) names three decisions as already made,
with reasoning, before any code was written. This document expands
that reasoning and records the decisions made *during* the build that
the spec left open.

---

## Decision 1: Parallel-track world-state model

**Decision:** `care_stage`, `risk_level`, and `engagement_status` are
three independent dimensions, not one linear state machine.
`care_stage` is stored as an explicit field; `risk_level` and
`engagement_status` are computed live from the event stream and never
stored.

**Why:** In real psychiatric care, a patient's risk level is
independent of their care stage — someone in `Maintenance` can
suddenly be in `Crisis`. A single linear pipeline (e.g.
`Intake → Watching → Crisis → Recovering → Discharged`) would look
plausible in a demo and be fundamentally wrong the first time a
`Maintenance` patient has a bad week, because the model would have no
representation for "stable care stage, unstable risk" — it would force
one to imply the other.

**Consequence for storage:** `risk_level` and `engagement_status`
having no storage isn't a performance shortcut, it's the point.
There's no field that can drift from the events that justify it,
because there's no field. `care_stage`, by contrast, changes slowly
and clinicians reason about it directly as a fact — it's stored, with
an XState machine enforcing which transitions are legal (`Discharged`
is terminal; `Maintenance → Active Care` relapse is legal;
`Intake → Maintenance` skipping `Active Care` is not).

**Where it's tested:** `core/tests/world.test.ts`'s "keeps risk_level
and care_stage as genuinely independent dimensions" test constructs
exactly the `Maintenance` + `Crisis` scenario above and asserts both
values independently.

---

## Decision 2: Three-tier allow-list autonomy model

**Decision:** LOW / MEDIUM / HIGH tiers, and it's an allow-list, not a
block-list — every action type must be explicitly added to LOW or
MEDIUM after review; anything unclassified defaults to HIGH.

**Why allow-list over block-list:** A block-list ("these specific
things need approval, everything else runs free") fails silently the
moment someone adds a new action type and forgets to add it to the
list — the default becomes "autonomous," which is exactly backwards
for a system that can draft crisis escalations. An allow-list fails
*loud*: a new, unreviewed action type defaults to HIGH (draft-only,
human-approved), so the failure mode of "forgot to classify this" is
"a human sees an extra approval request," not "an unreviewed action
type quietly started running itself."

**Why self-correcting downgrade:** A MEDIUM classification is a
judgment call made once, at design time, about a general pattern
("flagging a declining mood score is usually fine to do
autonomously"). It can be wrong for a specific patient without being
wrong in general. Rather than requiring a human to notice a pattern of
overrides and manually intervene, `actions/overrideMemory.ts` counts
consecutive overrides per `(patient, actionType)` and auto-downgrades
after 2 — the system's confidence in its own autonomy for that
specific case degrades based on evidence, and *stays* degraded until a
human explicitly restores it (never auto-restores, since silent
restoration would recreate the exact problem being solved).

**Where it's tested:** `core/tests/orchestrator.test.ts`'s downgrade
test runs three full rounds of propose → override against a live
`risk_level` computation (not a mocked shortcut) and asserts the third
round's action is HIGH-tier and undrafted.

---

## Decision 3: Split architecture — Node/TypeScript core + Python safety service

**Decision:** The safety classifiers live in a separate Python
process, communicating with the Node core over an internal REST API
(`POST /safety/verify-action` plus standalone per-classifier
endpoints), rather than as a library the core imports.

**Why a separate *process*, not just a separate *module*:** The
requirement is "the agent's own LLM is never the only safety check on
itself" (spec 4.2). A same-process module boundary is a convention —
nothing stops a future contributor from importing the safety logic
into the same code path as the agent and quietly collapsing the
independence the whole design depends on. A separate HTTP service
makes bypassing verification require an explicit, visible choice not
to make the network call, rather than an accidental one. It also
means the safety service can be language- and stack-appropriate
(Python, encoder models, scikit-learn) without that choice leaking
into the Node core's dependency tree.

**Consequence — fail closed:** `safety/safetyClient.ts`'s
`HttpSafetyClient` throws (`SafetyServiceUnavailableError`) rather
than returning a default "safe" result if the service is unreachable
or errors. An agent action must never be able to execute *because* the
safety service happened to be down — every entry point that boots a
live orchestrator (`eval-harness/run_eval.ts`, `core/src/api/server.ts`)
checks `/health` first and refuses to start otherwise.

---

## Decisions made during the build (not pre-specified)

The spec deliberately left implementation choices open within the
three decisions above. These were made while building, with the
reasoning recorded here rather than only in commit messages.

**TF-IDF+SVD as the default embedder, mDeBERTa opt-in
(`safety-service/app/embedder.py`).** mDeBERTa-v3 requires a
multi-hundred-MB model download; triggering that implicitly on first
run (in CI, or a laptop with no network) would make the safety service
non-deterministic to start. TF-IDF+SVD is pure scikit-learn, offline,
deterministic given a fixed training corpus — the actual thing that
runs in this repo's tests and the eval harness. mDeBERTa is wired in
behind `SAHAYAK_USE_MDEBERTA=1` for a real deployment to opt into, with
automatic fallback if `torch`/`transformers` aren't installed.

**Idempotency keys anchored to the triggering event id, not to
drafted-payload content.** An early version keyed on
`patientId:actionType:JSON(payload)`. A test scenario where the same
mood-score decline pattern recurs for a patient weeks apart produces
textually identical drafted content — which would have collided under
content-based keys and silently skipped the second, genuinely new,
occurrence. Anchoring to the event id fixes this because two different
real-world occurrences always have different triggering events, while
retries of the *same* failed attempt for the *same* event still
correctly dedupe.

**Local simulation of AWS EventBridge and Supabase Realtime, not a
faked version of the API contract.** The spec's tech-stack table
already calls for EventBridge to be "simulated locally with an
in-process event emitter for dev" — `events/eventBus.ts` does exactly
that. Phase 6 extended the same principle to Supabase Realtime: the
dashboard's WebSocket channel is a plain "something changed, refetch"
broadcast, not a mocked-up subscription payload shaped like Supabase's
actual wire format. The distinction matters — the local stand-in is
honest about being a stand-in, documented as a swap point in
`docs/ARCHITECTURE.md`, rather than something that would need to be
quietly unwound before a real deployment.

**Orchestrator event-bus subscription is opt-in (`start()`), not
automatic in the constructor.** An early version auto-subscribed in
the constructor. Every test and script that both records an event via
`world.recordEvent` (which publishes to the bus) *and* explicitly
calls `orchestrator.handleEvent()` for deterministic ordering would
double-process that event — once via the live subscription
(fire-and-forget), once via the explicit call. `start()`/`stop()`
makes live wiring an explicit choice only real running processes make;
tests and seed/demo scripts call `handleEvent()` directly and await it.
