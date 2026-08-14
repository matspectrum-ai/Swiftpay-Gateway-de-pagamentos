-- SwiftPay V2 Phase 2: fail-closed Refund evidence application.
--
-- Real retained-provider refund execution remains disabled. Provider-originated
-- execution/query/event evidence may be retained, but only sandbox simulation
-- and authoritative reconciliation may drive state/ledger changes in this V0.

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
declare
    v_refund app.refunds%rowtype;
    v_payment app.payments%rowtype;
    v_existing app.refund_evidence%rowtype;
    v_evidence_id uuid;
    v_succeeded_count bigint;
    v_source_provider_account_id uuid;
begin
    if p_refund_id is null
       or p_provider_account_id is null
       or p_source_kind not in (
            'sandbox_simulation', 'reconciliation', 'execution_result',
            'provider_query', 'provider_event'
       )
       or p_source_reference is null or length(trim(p_source_reference)) = 0
       or p_outcome not in (
            'processing', 'execution_unknown', 'completed', 'definitively_failed'
       )
       or p_amount_semantics not in ('event_delta', 'cumulative_total', 'not_supplied')
       or (p_provider_reported_amount_cents is not null and p_provider_reported_amount_cents <= 0)
       or (
            p_outcome = 'completed'
            and (p_amount_semantics = 'not_supplied' or p_provider_reported_amount_cents is null)
       )
       or p_payload_hash is null or length(trim(p_payload_hash)) = 0
       or p_occurred_at is null then
        raise exception 'invalid normalized refund evidence'
            using errcode = '23514';
    end if;

    select *
      into v_refund
      from app.refunds
     where id = p_refund_id;

    if not found then
        raise exception 'refund does not exist'
            using errcode = '23514';
    end if;

    select *
      into v_payment
      from app.payments
     where id = v_refund.payment_id;

    if not found
       or v_payment.merchant_id is distinct from v_refund.merchant_id
       or v_payment.environment is distinct from v_refund.environment
       or v_payment.currency is distinct from v_refund.currency then
        raise exception 'refund/payment scope is inconsistent'
            using errcode = '23514';
    end if;

    select count(*),
           (array_agg(pa.provider_account_id order by pa.attempt_number))[1]
      into v_succeeded_count, v_source_provider_account_id
      from app.provider_attempts pa
     where pa.payment_id = v_payment.id
       and pa.operation = 'create_pix_charge'
       and pa.state = 'succeeded';

    if v_succeeded_count <> 1
       or v_source_provider_account_id is distinct from p_provider_account_id then
        raise exception 'refund provider account must match unique succeeded source payment provider account'
            using errcode = '23514';
    end if;

    if p_source_kind = 'sandbox_simulation' and v_refund.environment <> 'sandbox' then
        raise exception 'sandbox refund simulation is forbidden in Production'
            using errcode = '23514';
    end if;

    insert into app.refund_evidence (
        refund_id,
        provider_account_id,
        environment,
        source_kind,
        source_reference,
        outcome,
        amount_semantics,
        provider_reported_amount_cents,
        provider_status_raw,
        provider_refund_id,
        payload_hash,
        occurred_at,
        application_state
    ) values (
        v_refund.id,
        p_provider_account_id,
        v_refund.environment,
        p_source_kind,
        p_source_reference,
        p_outcome,
        p_amount_semantics,
        p_provider_reported_amount_cents,
        p_provider_status_raw,
        p_provider_refund_id,
        p_payload_hash,
        p_occurred_at,
        'received'
    )
    on conflict (provider_account_id, environment, source_kind, source_reference)
    do nothing
    returning id into v_evidence_id;

    if v_evidence_id is not null then
        return v_evidence_id;
    end if;

    select *
      into strict v_existing
      from app.refund_evidence
     where provider_account_id = p_provider_account_id
       and environment = v_refund.environment
       and source_kind = p_source_kind
       and source_reference = p_source_reference;

    if v_existing.refund_id is distinct from v_refund.id
       or v_existing.outcome is distinct from p_outcome
       or v_existing.amount_semantics is distinct from p_amount_semantics
       or v_existing.provider_reported_amount_cents is distinct from p_provider_reported_amount_cents
       or v_existing.provider_status_raw is distinct from p_provider_status_raw
       or v_existing.provider_refund_id is distinct from p_provider_refund_id
       or v_existing.payload_hash is distinct from p_payload_hash
       or v_existing.occurred_at is distinct from p_occurred_at then
        raise exception 'refund evidence source identity reused with different normalized evidence'
            using errcode = '23505';
    end if;

    return v_existing.id;
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
declare
    v_refund_id uuid;
    v_payment_id uuid;
    v_payment app.payments%rowtype;
    v_refund app.refunds%rowtype;
    v_evidence app.refund_evidence%rowtype;
    v_succeeded_count bigint;
    v_source_provider_account_id uuid;
    v_blocked_account_id uuid;
    v_available_account_id uuid;
    v_provider_asset_account_id uuid;
    v_public_payload jsonb;
begin
    if p_refund_evidence_id is null then
        raise exception 'refund evidence id is required'
            using errcode = '23514';
    end if;

    -- Resolve parent identities first without locking, then acquire the canonical
    -- order Payment -> Refund -> evidence. Payment is the serialization point
    -- for cumulative partial-refund accounting and concurrent reservations.
    select refund_id
      into v_refund_id
      from app.refund_evidence
     where id = p_refund_evidence_id;

    if not found then
        raise exception 'refund evidence does not exist'
            using errcode = '23514';
    end if;

    select payment_id
      into v_payment_id
      from app.refunds
     where id = v_refund_id;

    if not found then
        raise exception 'refund does not exist'
            using errcode = '23514';
    end if;

    select *
      into v_payment
      from app.payments
     where id = v_payment_id
     for update;

    if not found then
        raise exception 'source payment does not exist'
            using errcode = '23514';
    end if;

    select *
      into v_refund
      from app.refunds
     where id = v_refund_id
     for update;

    if not found then
        raise exception 'refund does not exist'
            using errcode = '23514';
    end if;

    select *
      into v_evidence
      from app.refund_evidence
     where id = p_refund_evidence_id
     for update;

    if not found
       or v_evidence.refund_id is distinct from v_refund.id
       or v_refund.payment_id is distinct from v_payment.id
       or v_refund.merchant_id is distinct from v_payment.merchant_id
       or v_refund.environment is distinct from v_payment.environment
       or v_refund.currency is distinct from v_payment.currency
       or v_evidence.environment is distinct from v_refund.environment then
        raise exception 'refund evidence/payment/refund scope is inconsistent'
            using errcode = '23514';
    end if;

    select count(*),
           (array_agg(pa.provider_account_id order by pa.attempt_number))[1]
      into v_succeeded_count, v_source_provider_account_id
      from app.provider_attempts pa
     where pa.payment_id = v_payment.id
       and pa.operation = 'create_pix_charge'
       and pa.state = 'succeeded';

    if v_succeeded_count <> 1
       or v_source_provider_account_id is distinct from v_evidence.provider_account_id then
        raise exception 'refund evidence provider account does not match source payment provider account'
            using errcode = '23514';
    end if;

    if v_evidence.application_state in ('applied', 'absorbed', 'conflict') then
        return v_refund.state;
    end if;

    -- Provider refund execution is intentionally not activated by this slice.
    -- Persisting such evidence is useful for audit/conformance work, but it may
    -- not mutate money until retained-provider semantics are proven.
    if v_evidence.source_kind in ('execution_result', 'provider_query', 'provider_event') then
        raise exception 'provider refund evidence application is not activated'
            using errcode = '0A000';
    end if;

    if v_evidence.source_kind = 'sandbox_simulation' and v_refund.environment <> 'sandbox' then
        raise exception 'sandbox refund simulation is forbidden in Production'
            using errcode = '23514';
    end if;

    if v_refund.state in ('requested', 'cancelled') then
        raise exception 'refund is not in an externally resolvable state: %', v_refund.state
            using errcode = '23514';
    end if;

    -- Terminal source history is immutable. Confirming evidence is absorbed;
    -- contradictory evidence is retained as an explicit reconciliation conflict.
    if v_refund.state = 'completed' then
        if v_evidence.outcome = 'completed' then
            update app.refund_evidence
               set application_state = 'absorbed',
                   application_reason = 'terminal_state_already_completed',
                   applied_at = now()
             where id = v_evidence.id;
        else
            update app.refund_evidence
               set application_state = 'conflict',
                   application_reason = 'terminal_completed_conflicts_with_' || v_evidence.outcome,
                   applied_at = now()
             where id = v_evidence.id;
        end if;
        return 'completed';
    end if;

    if v_refund.state = 'failed' then
        if v_evidence.outcome = 'definitively_failed' then
            update app.refund_evidence
               set application_state = 'absorbed',
                   application_reason = 'terminal_state_already_failed',
                   applied_at = now()
             where id = v_evidence.id;
        else
            update app.refund_evidence
               set application_state = 'conflict',
                   application_reason = 'terminal_failed_conflicts_with_' || v_evidence.outcome,
                   applied_at = now()
             where id = v_evidence.id;
        end if;
        return 'failed';
    end if;

    if v_refund.state not in ('processing', 'execution_unknown') then
        raise exception 'unsupported refund state for evidence application: %', v_refund.state
            using errcode = '23514';
    end if;

    if v_refund.fee_policy_version <> 'merchant_fee_non_refundable' then
        raise exception 'refund fee policy is not executable in V0: %', v_refund.fee_policy_version
            using errcode = '0A000';
    end if;

    if v_payment.collection_status <> 'paid' then
        raise exception 'refund resolution requires canonical paid Payment'
            using errcode = '23514';
    end if;

    if v_evidence.outcome = 'processing' then
        -- A later processing observation may not regress execution_unknown.
        update app.refund_evidence
           set application_state = 'applied',
               application_reason = null,
               applied_at = now()
         where id = v_evidence.id;
        return v_refund.state;
    end if;

    if v_evidence.outcome = 'execution_unknown' then
        update app.refunds
           set state = 'execution_unknown',
               updated_at = v_evidence.occurred_at
         where id = v_refund.id;

        update app.refund_evidence
           set application_state = 'applied',
               application_reason = null,
               applied_at = now()
         where id = v_evidence.id;

        return 'execution_unknown';
    end if;

    if v_evidence.outcome = 'completed' then
        if v_evidence.amount_semantics = 'event_delta' then
            if v_evidence.provider_reported_amount_cents is distinct from v_refund.amount_cents then
                raise exception 'refund event delta does not equal Refund amount'
                    using errcode = '23514';
            end if;
        elsif v_evidence.amount_semantics = 'cumulative_total' then
            if v_evidence.provider_reported_amount_cents is null
               or v_evidence.provider_reported_amount_cents < v_payment.refunded_amount_cents
               or v_evidence.provider_reported_amount_cents - v_payment.refunded_amount_cents <> v_refund.amount_cents then
                raise exception 'refund cumulative total does not prove this Refund amount'
                    using errcode = '23514';
            end if;
        else
            raise exception 'completed Refund requires explicit amount semantics'
                using errcode = '23514';
        end if;

        if v_payment.refunded_amount_cents + v_refund.amount_cents > v_payment.amount_cents then
            raise exception 'completed Refund would exceed Payment refundable amount'
                using errcode = '23514';
        end if;

        v_blocked_account_id := app.ensure_account(
            v_refund.merchant_id, null, v_refund.environment, 'BRL',
            'merchant_refund_blocked_liability'
        );
        v_provider_asset_account_id := app.ensure_account(
            null, v_evidence.provider_account_id, v_refund.environment, 'BRL',
            'provider_settlement_asset'
        );

        perform app.post_ledger_transaction(
            v_refund.environment,
            'refund',
            v_refund.id,
            'completed',
            jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_blocked_account_id,
                    'direction', 'debit',
                    'amount_cents', v_refund.amount_cents
                ),
                jsonb_build_object(
                    'account_id', v_provider_asset_account_id,
                    'direction', 'credit',
                    'amount_cents', v_refund.amount_cents
                )
            )
        );

        update app.refunds
           set state = 'completed',
               completed_at = v_evidence.occurred_at,
               failed_at = null,
               updated_at = v_evidence.occurred_at
         where id = v_refund.id;

        update app.payments
           set refunded_amount_cents = refunded_amount_cents + v_refund.amount_cents,
               updated_at = v_evidence.occurred_at
         where id = v_payment.id;

        v_public_payload := jsonb_build_object(
            'refund_id', v_refund.id,
            'payment_id', v_payment.id,
            'state', 'completed',
            'amount_cents', v_refund.amount_cents,
            'currency', v_refund.currency,
            'occurred_at', v_evidence.occurred_at
        );

        perform app.record_webhook_event(
            v_refund.merchant_id,
            v_refund.environment,
            'refund.completed',
            'refund',
            v_refund.id,
            'refund_evidence',
            v_evidence.id,
            'v1',
            v_public_payload,
            v_evidence.occurred_at
        );

        update app.refund_evidence
           set application_state = 'applied',
               application_reason = null,
               applied_at = now()
         where id = v_evidence.id;

        return 'completed';
    end if;

    if v_evidence.outcome = 'definitively_failed' then
        v_blocked_account_id := app.ensure_account(
            v_refund.merchant_id, null, v_refund.environment, 'BRL',
            'merchant_refund_blocked_liability'
        );
        v_available_account_id := app.ensure_account(
            v_refund.merchant_id, null, v_refund.environment, 'BRL',
            'merchant_available_liability'
        );

        perform app.post_ledger_transaction(
            v_refund.environment,
            'refund',
            v_refund.id,
            'release_failure',
            jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_blocked_account_id,
                    'direction', 'debit',
                    'amount_cents', v_refund.amount_cents
                ),
                jsonb_build_object(
                    'account_id', v_available_account_id,
                    'direction', 'credit',
                    'amount_cents', v_refund.amount_cents
                )
            )
        );

        update app.refunds
           set state = 'failed',
               failed_at = v_evidence.occurred_at,
               completed_at = null,
               updated_at = v_evidence.occurred_at
         where id = v_refund.id;

        v_public_payload := jsonb_build_object(
            'refund_id', v_refund.id,
            'payment_id', v_payment.id,
            'state', 'failed',
            'amount_cents', v_refund.amount_cents,
            'currency', v_refund.currency,
            'occurred_at', v_evidence.occurred_at
        );

        perform app.record_webhook_event(
            v_refund.merchant_id,
            v_refund.environment,
            'refund.failed',
            'refund',
            v_refund.id,
            'refund_evidence',
            v_evidence.id,
            'v1',
            v_public_payload,
            v_evidence.occurred_at
        );

        update app.refund_evidence
           set application_state = 'applied',
               application_reason = null,
               applied_at = now()
         where id = v_evidence.id;

        return 'failed';
    end if;

    raise exception 'unsupported normalized refund evidence outcome: %', v_evidence.outcome
        using errcode = '23514';
end;
$$;

revoke all on function app.record_refund_evidence(
    uuid, uuid, text, text, text, text, bigint, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.apply_refund_evidence(uuid)
    from public, anon, authenticated, service_role;
