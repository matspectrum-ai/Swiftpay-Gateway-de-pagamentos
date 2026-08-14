-- SwiftPay V2 Phase 2 / I2: durable reconciliation operations foundation.
--
-- This migration establishes durable run/discrepancy/observation/lifecycle
-- identities and fail-closed function signatures only. Capture and operator
-- behavior remain unimplemented until their behavioral pgTAP suite is RED.

create table app.reconciliation_runs (
    id uuid primary key default gen_random_uuid(),
    layer text not null default 'internal',
    environment text not null,
    scope jsonb not null default '{}'::jsonb,
    detector_version text not null,
    status text not null default 'running',
    started_at timestamptz not null,
    completed_at timestamptz,
    finding_count bigint not null default 0,
    created_at timestamptz not null default now(),
    constraint reconciliation_runs_layer_ck check (layer = 'internal'),
    constraint reconciliation_runs_environment_ck check (environment in ('sandbox','production')),
    constraint reconciliation_runs_scope_ck check (jsonb_typeof(scope) = 'object'),
    constraint reconciliation_runs_detector_version_ck check (length(trim(detector_version)) > 0),
    constraint reconciliation_runs_status_ck check (status in ('running','completed','failed')),
    constraint reconciliation_runs_finding_count_ck check (finding_count >= 0),
    constraint reconciliation_runs_time_ck check (completed_at is null or completed_at >= started_at),
    constraint reconciliation_runs_completion_ck check (
        (status = 'running' and completed_at is null)
        or (status in ('completed','failed') and completed_at is not null)
    )
);

create table app.reconciliation_discrepancies (
    id uuid primary key default gen_random_uuid(),
    layer text not null default 'internal',
    environment text not null,
    discrepancy_type text not null,
    stable_key text not null,
    resource_type text not null,
    resource_id uuid not null,
    account_id uuid references app.accounts(id) on delete restrict,
    expected_cents bigint,
    actual_cents bigint,
    detail jsonb not null default '{}'::jsonb,
    lifecycle_state text not null default 'open',
    first_seen_at timestamptz not null,
    last_seen_at timestamptz not null,
    occurrence_count bigint not null default 1,
    first_run_id uuid not null references app.reconciliation_runs(id) on delete restrict,
    last_run_id uuid not null references app.reconciliation_runs(id) on delete restrict,
    acknowledged_at timestamptz,
    acknowledged_by_actor_type text,
    acknowledged_by_actor_id text,
    acknowledgement_note text,
    resolved_at timestamptz,
    resolved_by_actor_type text,
    resolved_by_actor_id text,
    resolution_code text,
    resolution_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint reconciliation_discrepancies_layer_ck check (layer = 'internal'),
    constraint reconciliation_discrepancies_environment_ck check (environment in ('sandbox','production')),
    constraint reconciliation_discrepancies_type_ck check (length(trim(discrepancy_type)) > 0),
    constraint reconciliation_discrepancies_stable_key_ck check (length(trim(stable_key)) > 0),
    constraint reconciliation_discrepancies_resource_type_ck check (length(trim(resource_type)) > 0),
    constraint reconciliation_discrepancies_detail_ck check (jsonb_typeof(detail) = 'object'),
    constraint reconciliation_discrepancies_lifecycle_ck check (lifecycle_state in ('open','acknowledged','resolved')),
    constraint reconciliation_discrepancies_seen_ck check (last_seen_at >= first_seen_at and occurrence_count > 0),
    constraint reconciliation_discrepancies_ack_group_ck check (
        (acknowledged_at is null
         and acknowledged_by_actor_type is null
         and acknowledged_by_actor_id is null
         and acknowledgement_note is null)
        or
        (acknowledged_at is not null
         and length(trim(acknowledged_by_actor_type)) > 0
         and length(trim(acknowledged_by_actor_id)) > 0
         and length(trim(acknowledgement_note)) > 0)
    ),
    constraint reconciliation_discrepancies_resolution_group_ck check (
        (resolved_at is null
         and resolved_by_actor_type is null
         and resolved_by_actor_id is null
         and resolution_code is null
         and resolution_note is null)
        or
        (resolved_at is not null
         and length(trim(resolved_by_actor_type)) > 0
         and length(trim(resolved_by_actor_id)) > 0
         and length(trim(resolution_code)) > 0
         and length(trim(resolution_note)) > 0)
    ),
    constraint reconciliation_discrepancies_lifecycle_shape_ck check (
        (lifecycle_state = 'open' and acknowledged_at is null and resolved_at is null)
        or (lifecycle_state = 'acknowledged' and acknowledged_at is not null and resolved_at is null)
        or (lifecycle_state = 'resolved' and resolved_at is not null)
    )
);

create unique index reconciliation_discrepancies_logical_identity_uq
    on app.reconciliation_discrepancies (layer, environment, stable_key);
create index reconciliation_discrepancies_lifecycle_idx
    on app.reconciliation_discrepancies (environment, lifecycle_state, last_seen_at);

create table app.reconciliation_run_observations (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references app.reconciliation_runs(id) on delete restrict,
    discrepancy_id uuid not null references app.reconciliation_discrepancies(id) on delete restrict,
    discrepancy_type text not null,
    stable_key text not null,
    resource_type text not null,
    resource_id uuid not null,
    account_id uuid references app.accounts(id) on delete restrict,
    expected_cents bigint,
    actual_cents bigint,
    detail jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null,
    created_at timestamptz not null default now(),
    constraint reconciliation_run_observations_type_ck check (length(trim(discrepancy_type)) > 0),
    constraint reconciliation_run_observations_stable_key_ck check (length(trim(stable_key)) > 0),
    constraint reconciliation_run_observations_resource_type_ck check (length(trim(resource_type)) > 0),
    constraint reconciliation_run_observations_detail_ck check (jsonb_typeof(detail) = 'object')
);

create unique index reconciliation_run_observations_run_discrepancy_uq
    on app.reconciliation_run_observations (run_id, discrepancy_id);
create index reconciliation_run_observations_discrepancy_idx
    on app.reconciliation_run_observations (discrepancy_id, observed_at);

create table app.reconciliation_discrepancy_events (
    id uuid primary key default gen_random_uuid(),
    discrepancy_id uuid not null references app.reconciliation_discrepancies(id) on delete restrict,
    event_type text not null,
    actor_type text not null,
    actor_id text not null,
    note text not null,
    resolution_code text,
    created_at timestamptz not null,
    constraint reconciliation_discrepancy_events_type_ck check (event_type in ('acknowledged','resolved')),
    constraint reconciliation_discrepancy_events_actor_ck check (
        length(trim(actor_type)) > 0 and length(trim(actor_id)) > 0
    ),
    constraint reconciliation_discrepancy_events_note_ck check (length(trim(note)) > 0),
    constraint reconciliation_discrepancy_events_resolution_ck check (
        (event_type = 'acknowledged' and resolution_code is null)
        or (event_type = 'resolved' and resolution_code is not null and length(trim(resolution_code)) > 0)
    )
);

create index reconciliation_discrepancy_events_discrepancy_idx
    on app.reconciliation_discrepancy_events (discrepancy_id, created_at);

create or replace function app.capture_internal_reconciliation_run(
    p_environment text,
    p_detector_version text,
    p_scope jsonb,
    p_started_at timestamptz,
    p_completed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'capture_internal_reconciliation_run behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

create or replace function app.acknowledge_reconciliation_discrepancy(
    p_discrepancy_id uuid,
    p_actor_type text,
    p_actor_id text,
    p_note text,
    p_acted_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'acknowledge_reconciliation_discrepancy behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

create or replace function app.resolve_reconciliation_discrepancy(
    p_discrepancy_id uuid,
    p_actor_type text,
    p_actor_id text,
    p_resolution_code text,
    p_note text,
    p_acted_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'resolve_reconciliation_discrepancy behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

revoke all on
    app.reconciliation_runs,
    app.reconciliation_discrepancies,
    app.reconciliation_run_observations,
    app.reconciliation_discrepancy_events
from public, anon, authenticated, service_role;

revoke all on function app.capture_internal_reconciliation_run(text,text,jsonb,timestamptz,timestamptz)
    from public, anon, authenticated, service_role;
revoke all on function app.acknowledge_reconciliation_discrepancy(uuid,text,text,text,timestamptz)
    from public, anon, authenticated, service_role;
revoke all on function app.resolve_reconciliation_discrepancy(uuid,text,text,text,text,timestamptz)
    from public, anon, authenticated, service_role;
