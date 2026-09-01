-- SAHAYAK core schema (Supabase/Postgres)
-- All patient data is synthetic. No real PHI.
--
-- Design note: care_stage is stored as an explicit column (simple,
-- queryable, and it changes slowly). risk_level and engagement_status
-- are NEVER stored as columns here -- they are computed live from the
-- events table every time they are read (see state-machine/riskLevel.ts
-- and state-machine/engagement.ts). This file only persists what is
-- source-of-truth: patients, the immutable event log, and care_stage
-- transition history.

create extension if not exists "uuid-ossp";

-- ============================================================
-- patients
-- ============================================================
create table if not exists patients (
    id uuid primary key default uuid_generate_v4(),
    display_name text not null,               -- clearly synthetic name
    synthetic boolean not null default true,
    care_stage text not null default 'Intake'
        check (care_stage in ('Intake', 'Active Care', 'Maintenance', 'Discharged')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ============================================================
-- events: immutable, append-only event log.
-- This is the single source of truth for risk_level and
-- engagement_status. Nothing here is ever updated or deleted --
-- corrections are new events, not mutations (event sourcing).
-- ============================================================
create table if not exists events (
    id uuid primary key default uuid_generate_v4(),
    patient_id uuid not null references patients(id),
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    -- confidence_decay support (Edge Case 3: agent memory drift)
    valid_until timestamptz,                  -- null = does not decay
    occurred_at timestamptz not null default now(),
    recorded_at timestamptz not null default now(), -- when it hit our log
    source text not null default 'system'      -- patient | clinician | agent | system
);

create index if not exists idx_events_patient_id on events(patient_id);
create index if not exists idx_events_type on events(event_type);
create index if not exists idx_events_occurred_at on events(occurred_at);

-- ============================================================
-- care_stage_history: explicit transition log for care_stage.
-- Kept separate from the generic events table because care_stage
-- is a stored/queryable field (not live-computed) and its
-- transitions are driven by the XState machine in careStage.ts,
-- which needs a durable audit trail of guard evaluations.
-- ============================================================
create table if not exists care_stage_history (
    id uuid primary key default uuid_generate_v4(),
    patient_id uuid not null references patients(id),
    from_stage text,
    to_stage text not null,
    reason text,
    changed_by text not null default 'system', -- system | clinician:<id> | agent:<id>
    changed_at timestamptz not null default now()
);

create index if not exists idx_care_stage_history_patient_id on care_stage_history(patient_id);
