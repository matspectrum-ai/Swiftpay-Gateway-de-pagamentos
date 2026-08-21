-- SwiftPay V2 Phase 2: payout-resolution structural foundation.
-- Normalized evidence becomes durable before any payout/domain/ledger mutation.
-- Recording/application behavior remains intentionally fail-closed until its
-- own behavioral pgTAP suite is RED.

create table app.payout_evidence (
    id uuid primary key default gen_random_uuid(),
    payout_id uuid not null references app.payouts(id) on delete restrict,
    payout_attempt_id uuid not null references app.payout_attempts(id) on delete restrict,
    environment text not null,
    source_kind text not null,
    source_reference text not null,
    outcome text not null,
    provider_status_raw text,
    provider_payout_id text,
    provider_cost_cents bigint,
    payload_hash text not null,
    occurred_at timestamptz not null,
    application_state text not null default 'received',
    application_reason text,
    applied_at timestamptz,
    created_at timestamptz not null default now(),
    constraint payout_evidence_environment_ck
        check (environment in ('sandbox', 'production')),
    constraint payout_evidence_source_kind_ck
        check (source_kind in (
            'execution_result',
            'provider_query',
            'provider_event',
            'reconciliation',
            'sandbox_simulation'
        )),
    constraint payout_evidence_source_reference_ck
        check (length(trim(source_reference)) > 0),
    constraint payout_evidence_outcome_ck
        check (outcome in (
            'processing',
            'execution_unknown',
            'completed',
            'definitively_failed'
        )),
    constraint payout_evidence_provider_cost_ck
        check (provider_cost_cents is null or provider_cost_cents >= 0),
    constraint payout_evidence_completed_cost_ck
        check (outcome <> 'completed' or provider_cost_cents is not null),
    constraint payout_evidence_payload_hash_ck
        check (length(trim(payload_hash)) > 0),
    constraint payout_evidence_application_state_ck
        check (application_state in ('received', 'applied', 'absorbed', 'conflict')),
    constraint payout_evidence_application_audit_ck
        check (
            (application_state = 'received' and applied_at is null)
            or
            (application_state in ('applied', 'absorbed', 'conflict') and applied_at is not null)
        )
);

create unique index payout_evidence_source_uq
    on app.payout_evidence (payout_attempt_id, source_kind, source_reference);

create index payout_evidence_payout_idx
    on app.payout_evidence (payout_id, occurred_at, id);

create index payout_evidence_unapplied_idx
    on app.payout_evidence (payout_id, occurred_at, id)
    where application_state = 'received';

create or replace function app.record_payout_evidence(
    p_payout_id uuid,
    p_payout_attempt_id uuid,
    p_source_kind text,
    p_source_reference text,
    p_outcome text,
    p_provider_status_raw text,
    p_provider_payout_id text,
    p_provider_cost_cents bigint,
    p_payload_hash text,
    p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'record_payout_evidence behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

create or replace function app.apply_payout_evidence(
    p_payout_evidence_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'apply_payout_evidence behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

revoke all on app.payout_evidence from public, anon, authenticated, service_role;
revoke all on function app.record_payout_evidence(
    uuid, uuid, text, text, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.apply_payout_evidence(uuid)
    from public, anon, authenticated, service_role;
