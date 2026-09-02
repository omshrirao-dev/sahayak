# SAHAYAK — Internal API Contract

## Node core ↔ Python safety service

Base URL: `http://localhost:8000` (default; override via
`SAHAYAK_SAFETY_URL` for the Node core, or run the FastAPI app on a
different port). All requests/responses are JSON. The Node-side client
is `core/src/safety/safetyClient.ts`; the Python-side implementation is
`safety-service/app/main.py`.

**Fail-closed contract:** if this service is unreachable or returns a
non-2xx response, `HttpSafetyClient` throws
`SafetyServiceUnavailableError` rather than returning a default "safe"
result. No caller should treat a network failure as permission to
proceed.

---

### `GET /health`

Liveness check. Every process that boots a live orchestrator checks
this before starting.

**Response `200`:**
```json
{ "status": "ok" }
```

---

### `POST /safety/verify-action`

The combined endpoint named in the architecture (spec 2.3). Called
once per proposed agent action by `Orchestrator.proposeAndRoute`, with
whichever fields are relevant to that action.

**Request:**
```json
{
  "action_type": "SEND_CHECK_IN_REMINDER",
  "tier": "LOW",
  "drafted_text": "string, optional — checked by the trust classifier",
  "inbound_patient_text": "string, optional — checked by crisis + injection",
  "contradiction_check": {
    "source_a": "string, optional",
    "source_b": "string, optional"
  }
}
```
`tier` is one of `LOW` / `MEDIUM` / `HIGH`.

**Response `200`:**
```json
{
  "safe_to_proceed": true,
  "blocking_reasons": ["string, ..."],
  "trust": { "label": "VERIFIED", "confidence": 0.5, "scores": { "VERIFIED": 0.5, "...": 0.0 } },
  "crisis": {
    "label": "NOT_CRISIS",
    "is_crisis": false,
    "probability": 0.1,
    "matched_keyword": null,
    "reasoning": "string",
    "suggested_queue": "none"
  },
  "injection": { "label": "CLEAN", "is_injection": false, "probability": 0.05, "matched_pattern": null, "reasoning": "string" },
  "contradiction": {
    "label": "AGREE",
    "confidence": 0.9,
    "scores": { "AGREE": 0.9, "...": 0.0 },
    "cosine_similarity": 0.8,
    "reasoning": "string"
  }
}
```
Each of `trust`/`crisis`/`injection`/`contradiction` is `null` if its
corresponding input field wasn't provided. `safe_to_proceed` is `false`
if `trust.label` is `SUSPICIOUS`/`UNRELIABLE`, `injection.is_injection`
is `true`, or `contradiction.label` is `CONTRADICT` — never for a
`crisis` verdict alone (crisis routes to fast triage instead of
blocking; see `docs/SAFETY.md` Edge Case 2).

---

### `POST /safety/crisis`

Standalone crisis check. Called independently on **every** inbound
patient message (`Orchestrator.handleEvent`), not gated behind any
agent's decision.

**Request:** `{ "text": "string" }`

**Response `200`:**
```json
{
  "label": "CRISIS",
  "is_crisis": true,
  "probability": 0.99,
  "matched_keyword": "kill myself",
  "reasoning": "string",
  "suggested_queue": "fast_triage"
}
```
`matched_keyword` is non-null only when a hard-coded keyword pattern
matched (which always forces `probability >= 0.99`, overriding the ML
score). `suggested_queue` is `"fast_triage"` when `is_crisis`, else
`"none"` — a hint to the Node core, which owns the actual routing
decision.

---

### `POST /safety/injection`

Standalone injection check, run alongside `/safety/crisis` on every
inbound message.

**Request:** `{ "text": "string" }`

**Response `200`:**
```json
{
  "label": "INJECTION",
  "is_injection": true,
  "probability": 0.99,
  "matched_pattern": "ignore all previous instructions",
  "reasoning": "string"
}
```

---

### `POST /safety/trust`

Trust-classifies a single piece of agent-drafted text.

**Request:** `{ "text": "string" }`

**Response `200`:**
```json
{ "label": "VERIFIED", "confidence": 0.5, "scores": { "VERIFIED": 0.5, "UNCERTAIN": 0.2, "SUSPICIOUS": 0.2, "UNRELIABLE": 0.1 } }
```

---

### `POST /safety/contradiction`

Compares two data sources. Called directly by `contradictionAgent`
(bypassing `verify-action`'s blocking behavior — see
`docs/SAFETY.md` Edge Case 4 for why).

**Request:**
```json
{ "source_a": "string", "source_b": "string" }
```

**Response `200`:**
```json
{
  "label": "CONTRADICT",
  "confidence": 0.68,
  "scores": { "AGREE": 0.0, "PARTIAL": 0.3, "CONTRADICT": 0.68, "INSUFFICIENT": 0.01 },
  "cosine_similarity": 0.19,
  "reasoning": "cosine_similarity=0.186, polarity_diff=2.000, strong_opposite=yes, hedge_cue=no, insufficient_cue=no -> CONTRADICT"
}
```

---

## Node core dashboard API (frontend ↔ core)

Base URL: `http://localhost:4000` (default; `PORT` env var). Full
implementation: `core/src/api/dashboard.ts`. This layer adds no new
business logic — every handler is a thin wrapper around
`Orchestrator`/`World` methods already covered by
`core/tests/dashboard.test.ts`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/patients` | List every patient's live snapshot (`care_stage`/`risk_level`/`engagement_status`) |
| `GET` | `/api/patients/:id` | One patient's snapshot |
| `GET` | `/api/patients/:id/timeline` | Events + actions + overrides + reasoning-trace metadata, merged chronologically |
| `GET` | `/api/approval-queue` | Every `proposed` action not already in the fast triage queue |
| `POST` | `/api/actions/:id/approve` | `{ "by": "clinician:..." }` → approves + executes |
| `POST` | `/api/actions/:id/override` | `{ "by": "...", "reason": "..." }` → cancels (or annotates, if already completed) + records the override |
| `GET` | `/api/triage-queue` | Pending fast-triage crisis flags |
| `POST` | `/api/triage/:id/confirm` | `{ "by": "..." }` → approves the underlying escalation |
| `POST` | `/api/triage/:id/dismiss` | `{ "by": "...", "note": "..." }` → cancels it, records a false positive for that pattern |
| `GET` | `/api/reasoning-traces/:entryId?requesterId=...` | Decrypted trace content — `403` if `requesterId` lacks PHI access |
| `POST` | `/api/patients/:id/simulate-message` | `{ "text": "..." }` → runs a real `PATIENT_MESSAGE_RECEIVED` event through the live orchestrator, returns resulting actions |
| `GET` | `/api/patients/:id/audit-log` | Every reasoning-trace read attempt (granted or denied) for that patient |
| `WS` | `/ws` | Broadcasts `{ "type": "refresh", "reason": "...", "at": "..." }` on every mutation — clients refetch on receipt |
