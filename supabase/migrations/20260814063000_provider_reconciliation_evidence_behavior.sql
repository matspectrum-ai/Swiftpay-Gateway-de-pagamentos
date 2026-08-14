-- SwiftPay V2 Phase 2 / I3a: provider reconciliation evidence recording behavior.
--
-- This slice persists already-normalized provider-authoritative facts only.
-- It performs no provider HTTP, no local-resource correlation, no domain state
-- application, no ledger posting and no automated financial correction.

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
declare
    v_account_provider_id uuid;
    v_account_environment text;
    v_existing app.provider_reconciliation_evidence%rowtype;
    v_evidence_id uuid;
begin
    if p_provider_id is null
       or p_provider_account_id is null
       or p_environment not in ('sandbox', 'production')
       or p_source_kind not in (
            'provider_query', 'provider_event', 'settlement_report',
            'balance_snapshot', 'statement_export'
       )
       or p_source_reference is null or length(trim(p_source_reference)) = 0
       or p_request_fingerprint is null or length(trim(p_request_fingerprint)) = 0
       or p_evidence_type not in ('operation_status', 'settlement_item', 'provider_balance')
       or p_operation_type is not null and p_operation_type not in ('payment', 'payout', 'refund')
       or p_normalized_outcome is not null and p_normalized_outcome not in (
            'processing', 'execution_unknown', 'completed', 'definitively_failed', 'absent'
       )
       or p_amount_cents is not null and p_amount_cents <= 0
       or p_provider_fee_cents is not null and p_provider_fee_cents < 0
       or p_balance_cents is not null and p_balance_cents < 0
       or p_payload_hash is null or length(trim(p_payload_hash)) = 0
       or p_raw_evidence_ref is not null and length(trim(p_raw_evidence_ref)) = 0
       or p_observed_at is null
       or (
            (p_evidence_window_start is null) <> (p_evidence_window_end is null)
       )
       or (
            p_evidence_window_start is not null
            and p_evidence_window_end < p_evidence_window_start
       ) then
        raise exception 'invalid normalized provider reconciliation evidence'
            using errcode = '23514';
    end if;

    if p_evidence_type in ('operation_status', 'settlement_item') then
        if p_operation_type is null or p_balance_cents is not null then
            raise exception 'invalid operation-shaped provider reconciliation evidence'
                using errcode = '23514';
        end if;
    elsif p_evidence_type = 'provider_balance' then
        if p_operation_type is not null
           or p_client_reference is not null
           or p_provider_resource_id is not null
           or p_normalized_outcome is not null
           or p_amount_cents is not null
           or p_provider_fee_cents is not null
           or p_balance_cents is null then
            raise exception 'invalid provider-balance reconciliation evidence'
                using errcode = '23514';
        end if;
    end if;

    select pa.provider_id, pa.environment
      into v_account_provider_id, v_account_environment
      from app.provider_accounts pa
     where pa.id = p_provider_account_id;

    if not found then
        raise exception 'provider account does not exist'
            using errcode = '23514';
    end if;

    if v_account_provider_id is distinct from p_provider_id then
        raise exception 'provider account does not belong to provider'
            using errcode = '23514';
    end if;

    if v_account_environment is distinct from p_environment then
        raise exception 'provider account environment does not match evidence environment'
            using errcode = '23514';
    end if;

    insert into app.provider_reconciliation_evidence (
        provider_id,
        provider_account_id,
        environment,
        source_kind,
        source_reference,
        request_fingerprint,
        evidence_type,
        operation_type,
        client_reference,
        provider_resource_id,
        normalized_outcome,
        amount_cents,
        provider_fee_cents,
        balance_cents,
        currency,
        evidence_window_start,
        evidence_window_end,
        payload_hash,
        raw_evidence_ref,
        observed_at
    ) values (
        p_provider_id,
        p_provider_account_id,
        p_environment,
        p_source_kind,
        p_source_reference,
        p_request_fingerprint,
        p_evidence_type,
        p_operation_type,
        p_client_reference,
        p_provider_resource_id,
        p_normalized_outcome,
        p_amount_cents,
        p_provider_fee_cents,
        p_balance_cents,
        'BRL',
        p_evidence_window_start,
        p_evidence_window_end,
        p_payload_hash,
        p_raw_evidence_ref,
        p_observed_at
    )
    on conflict (provider_account_id, environment, source_kind, source_reference)
    do nothing
    returning id into v_evidence_id;

    if v_evidence_id is not null then
        return v_evidence_id;
    end if;

    select *
      into strict v_existing
      from app.provider_reconciliation_evidence
     where provider_account_id = p_provider_account_id
       and environment = p_environment
       and source_kind = p_source_kind
       and source_reference = p_source_reference;

    if v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception 'provider reconciliation evidence source identity reused with different request fingerprint'
            using errcode = '23505';
    end if;

    return v_existing.id;
end;
$$;

create or replace function app.prevent_provider_reconciliation_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, app
as $$
begin
    raise exception 'provider reconciliation evidence is append-only'
        using errcode = '55000';
end;
$$;

create trigger provider_reconciliation_evidence_append_only_trg
before update or delete on app.provider_reconciliation_evidence
for each row
execute function app.prevent_provider_reconciliation_evidence_mutation();

revoke all on function app.record_provider_reconciliation_evidence(
    uuid, uuid, text, text, text, text, text, text, text, text, text,
    bigint, bigint, bigint, timestamptz, timestamptz, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.prevent_provider_reconciliation_evidence_mutation()
    from public, anon, authenticated, service_role;
