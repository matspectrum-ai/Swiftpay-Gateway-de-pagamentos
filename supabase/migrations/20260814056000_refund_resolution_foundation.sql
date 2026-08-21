-- SwiftPay V2 Phase 2: refund-resolution structural foundation.
-- Provider refund execution remains disabled. This migration only introduces
-- durable normalized evidence and fail-closed application boundaries.

create table app.refund_evidence (
    id uuid primary key default gen_random_uuid(),
    refund_id uuid not null references app.refunds(id) on delete restrict,
    provider_account_id uuid not null references app.provider_accounts(id) on delete restrict,
    environment text not null,
    source_kind text not null,
    source_reference text not null,
    outcome text not null,
    amount_semantics text not null,
    provider_reported_amount_cents bigint,
    provider_status_raw text,
    provider_refund_id text,
    payload_hash text not null,
    occurred_at timestamptz not null,
    application_state text not null default 'received',
    application_reason text,
    applied_at timestamptz,
    created_at timestamptz not null default now(),
    constraint refund_evidence_environment_ck
        check (environment in ('sandbox', 'production')),
    constraint refund_evidence_source_kind_ck
        check (source_kind in (
            'sandbox_simulation',
            'reconciliation',
            'execution_result',
            'provider_query',
            'provider_event'
        )),
    constraint refund_evidence_sandbox_scope_ck
        check (source_kind <> 'sandbox_simulation' or environment = 'sandbox'),
    constraint refund_evidence_source_reference_ck
        check (length(trim(source_reference)) > 0),
    constraint refund_evidence_outcome_ck
        check (outcome in (
            'processing',
            'execution_unknown',
            'completed',
            'definitively_failed'
        )),
    constraint refund_evidence_amount_semantics_ck
        check (amount_semantics in ('event_delta', 'cumulative_total', 'not_supplied')),
    constraint refund_evidence_reported_amount_ck
        check (provider_reported_amount_cents is null or provider_reported_amount_cents > 0),
    constraint refund_evidence_completed_amount_presence_ck
        check (
            outcome <> 'completed'
            or (
                amount_semantics <> 'not_supplied'
                and provider_reported_amount_cents is not null
            )
        ),
    constraint refund_evidence_payload_hash_ck
        check (length(trim(payload_hash)) > 0),
    constraint refund_evidence_application_state_ck
        check (application_state in ('received', 'applied', 'absorbed', 'conflict')),
    constraint refund_evidence_application_audit_ck
        check (
            (application_state = 'received' and applied_at is null)
            or
            (application_state in ('applied', 'absorbed', 'conflict') and applied_at is not null)
        )
);

create unique index refund_evidence_source_uq
    on app.refund_evidence (
        provider_account_id,
        environment,
        source_kind,
        source_reference
    );

create index refund_evidence_refund_idx
    on app.refund_evidence (refund_id, occurred_at, id);

create index refund_evidence_unapplied_idx
    on app.refund_evidence (refund_id, occurred_at, id)
    where application_state = 'received';

create or replace function app.record_refund_evidence(
    p_refund_id uuid,
    p_provider_account_id uuid,
    p_source_kind text,
    p_source_reference text,
    p_outcome text,
    p_amount_semantics text,
    p_provider_reported_amount_cents bigint,
    p_provider_status_raw text,
    p_provider_refund_id text,
    p_payload_hash text,
    p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'record_refund_evidence behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

create or replace function app.apply_refund_evidence(
    p_refund_evidence_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'apply_refund_evidence behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

revoke all on app.refund_evidence from public, anon, authenticated, service_role;
revoke all on function app.record_refund_evidence(
    uuid, uuid, text, text, text, text, bigint, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.apply_refund_evidence(uuid)
    from public, anon, authenticated, service_role;
