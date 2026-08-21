-- SwiftPay V2 Phase 2 / I3a: provider reconciliation evidence foundation.
--
-- PostgreSQL persists normalized provider-authoritative facts only. It does not
-- fetch provider APIs/reports, correlate unproven PSP identifiers, apply domain
-- state, or repair financial history in this slice.

create table app.provider_reconciliation_evidence (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references app.providers(id) on delete restrict,
    provider_account_id uuid not null references app.provider_accounts(id) on delete restrict,
    environment text not null,
    source_kind text not null,
    source_reference text not null,
    request_fingerprint text not null,
    evidence_type text not null,
    operation_type text,
    client_reference text,
    provider_resource_id text,
    normalized_outcome text,
    amount_cents bigint,
    provider_fee_cents bigint,
    balance_cents bigint,
    currency text not null default 'BRL',
    evidence_window_start timestamptz,
    evidence_window_end timestamptz,
    payload_hash text not null,
    raw_evidence_ref text,
    observed_at timestamptz not null,
    created_at timestamptz not null default now(),

    constraint provider_reconciliation_evidence_environment_ck
        check (environment in ('sandbox', 'production')),
    constraint provider_reconciliation_evidence_source_kind_ck
        check (source_kind in (
            'provider_query',
            'provider_event',
            'settlement_report',
            'balance_snapshot',
            'statement_export'
        )),
    constraint provider_reconciliation_evidence_source_reference_ck
        check (length(trim(source_reference)) > 0),
    constraint provider_reconciliation_evidence_request_fingerprint_ck
        check (length(trim(request_fingerprint)) > 0),
    constraint provider_reconciliation_evidence_type_ck
        check (evidence_type in ('operation_status', 'settlement_item', 'provider_balance')),
    constraint provider_reconciliation_evidence_operation_type_ck
        check (operation_type is null or operation_type in ('payment', 'payout', 'refund')),
    constraint provider_reconciliation_evidence_outcome_ck
        check (
            normalized_outcome is null
            or normalized_outcome in (
                'processing',
                'execution_unknown',
                'completed',
                'definitively_failed',
                'absent'
            )
        ),
    constraint provider_reconciliation_evidence_amount_ck
        check (amount_cents is null or amount_cents > 0),
    constraint provider_reconciliation_evidence_fee_ck
        check (provider_fee_cents is null or provider_fee_cents >= 0),
    constraint provider_reconciliation_evidence_balance_ck
        check (balance_cents is null or balance_cents >= 0),
    constraint provider_reconciliation_evidence_currency_ck
        check (currency = 'BRL'),
    constraint provider_reconciliation_evidence_window_ck
        check (
            (evidence_window_start is null and evidence_window_end is null)
            or
            (evidence_window_start is not null
             and evidence_window_end is not null
             and evidence_window_end >= evidence_window_start)
        ),
    constraint provider_reconciliation_evidence_payload_hash_ck
        check (length(trim(payload_hash)) > 0),
    constraint provider_reconciliation_evidence_raw_ref_ck
        check (raw_evidence_ref is null or length(trim(raw_evidence_ref)) > 0),
    constraint provider_reconciliation_evidence_fact_shape_ck
        check (
            (
                evidence_type in ('operation_status', 'settlement_item')
                and operation_type is not null
                and balance_cents is null
            )
            or
            (
                evidence_type = 'provider_balance'
                and operation_type is null
                and client_reference is null
                and provider_resource_id is null
                and normalized_outcome is null
                and amount_cents is null
                and provider_fee_cents is null
                and balance_cents is not null
            )
        )
);

create unique index provider_reconciliation_evidence_source_uq
    on app.provider_reconciliation_evidence (
        provider_account_id,
        environment,
        source_kind,
        source_reference
    );

create index provider_reconciliation_evidence_provider_observed_idx
    on app.provider_reconciliation_evidence (
        provider_account_id,
        environment,
        observed_at,
        id
    );

create or replace function app.record_provider_reconciliation_evidence(
    p_provider_id uuid,
    p_provider_account_id uuid,
    p_environment text,
    p_source_kind text,
    p_source_reference text,
    p_request_fingerprint text,
    p_evidence_type text,
    p_operation_type text,
    p_client_reference text,
    p_provider_resource_id text,
    p_normalized_outcome text,
    p_amount_cents bigint,
    p_provider_fee_cents bigint,
    p_balance_cents bigint,
    p_evidence_window_start timestamptz,
    p_evidence_window_end timestamptz,
    p_payload_hash text,
    p_raw_evidence_ref text,
    p_observed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'record_provider_reconciliation_evidence behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

revoke all on app.provider_reconciliation_evidence
    from public, anon, authenticated, service_role;
revoke all on function app.record_provider_reconciliation_evidence(
    uuid, uuid, text, text, text, text, text, text, text, text, text,
    bigint, bigint, bigint, timestamptz, timestamptz, text, text, timestamptz
) from public, anon, authenticated, service_role;
