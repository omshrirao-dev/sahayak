# SAHAYAK Clinician Dashboard

React + TypeScript + Tailwind frontend for the dashboard API in
`core/src/api/`. Talks to the API over REST and a WebSocket refresh
channel (the local stand-in for Supabase Realtime — see
`core/src/api/dashboard.ts`).

## Setup

```bash
npm install
npm run dev   # http://localhost:5173
```

Requires all three services running (see the root README):

1. `safety-service/` — `python -m uvicorn app.main:app` (port 8000)
2. `core/` — `npm run dashboard` (port 4000; seeds demo patients on boot)
3. This frontend — `npm run dev` (port 5173)

Set `VITE_API_URL` to point at a non-default dashboard API host.

## Pages

- **Patients** — live list with care_stage / risk_level / engagement_status
- **Patient timeline** (click a patient) — full event/action/override history,
  reasoning traces (access-controlled, revealed on click), and a box to
  simulate an inbound patient message through the real orchestrator + safety
  service
- **Approval Queue** — HIGH-tier drafted actions, plus anything blocked from
  auto-executing (stale facts or a safety-service verdict); approve/reject
- **Fast Triage** — crisis flags awaiting a quick confirm/dismiss, separate
  from the full approval queue (Edge Case 2)
