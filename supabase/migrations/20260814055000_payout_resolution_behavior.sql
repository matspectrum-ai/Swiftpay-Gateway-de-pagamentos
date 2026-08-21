-- SwiftPay V2 Phase 2: payout evidence recording and terminal resolution.
-- Provider HTTP/authentication/status normalization remain outside PostgreSQL.
-- This boundary only persists normalized evidence and applies canonical state,
-- ledger and merchant-event effects atomically.

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
declare
    v_payout app.payouts%rowtype;
    v_attempt app.payout_attempts%rowtype;
    v_existing app.payout_evidence%rowtype;
    v_evidence_id uuid;
begin
    if p_payout_id is null
       or p_payout_attempt_id is null
       or p_source_kind not in (
            'execution_result', 'provider_query', 'provider_event',
            'reconciliation', 'sandbox_simulation'
       )
       or p_source_reference is null or length(trim(p_source_reference)) = 0
       or p_outcome not in (
            'processing', 'execution_unknown', 'completed', 'definitively_failed'
       )
       or p_provider_cost_cents is not null and p_provider_cost_cents < 0
       or (p_outcome = 'completed' and p_provider_cost_cents is null)
       or p_payload_hash is null or length(trim(p_payload_hash)) = 0
       or p_occurred_at is null then
        raise exception 'invalid normalized payout evidence'
            using errcode = '23514';
    end if;

    select *
      into v_payout
      from app.payouts
     where id = p_payout_id;

    if not found then
        raise exception 'payout does not exist'
            using errcode = '23514';
    end if;

    select *
      into v_attempt
      from app.payout_attempts
     where id = p_payout_attempt_id;

    if not found or v_attempt.payout_id is distinct from p_payout_id then
        raise exception 'payout attempt does not belong to payout'
            using errcode = '23514';
    end if;

    insert into app.payout_evidence (
        payout_id,
        payout_attempt_id,
        environment,
        source_kind,
        source_reference,
        outcome,
        provider_status_raw,
        provider_payout_id,
        provider_cost_cents,
        payload_hash,
        occurred_at,
        application_state
    ) values (
        p_payout_id,
        p_payout_attempt_id,
        v_payout.environment,
        p_source_kind,
        p_source_reference,
        p_outcome,
        p_provider_status_raw,
        p_provider_payout_id,
        p_provider_cost_cents,
        p_payload_hash,
        p_occurred_at,
        'received'
    )
    on conflict (payout_attempt_id, source_kind, source_reference)
    do nothing
    returning id into v_evidence_id;

    if v_evidence_id is not null then
        return v_evidence_id;
    end if;

    select *
      into strict v_existing
      from app.payout_evidence
     where payout_attempt_id = p_payout_attempt_id
       and source_kind = p_source_kind
       and source_reference = p_source_reference;

    if v_existing.payout_id is distinct from p_payout_id
       or v_existing.environment is distinct from v_payout.environment
       or v_existing.outcome is distinct from p_outcome
       or v_existing.provider_status_raw is distinct from p_provider_status_raw
       or v_existing.provider_payout_id is distinct from p_provider_payout_id
       or v_existing.provider_cost_cents is distinct from p_provider_cost_cents
       or v_existing.payload_hash is distinct from p_payload_hash
       or v_existing.occurred_at is distinct from p_occurred_at then
        raise exception 'payout evidence source identity reused with different normalized evidence'
            using errcode = '23505';
    end if;

    return v_existing.id;
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
declare
    v_parent_payout_id uuid;
    v_parent_attempt_id uuid;
    v_payout app.payouts%rowtype;
    v_attempt app.payout_attempts%rowtype;
    v_evidence app.payout_evidence%rowtype;
    v_blocked_account_id uuid;
    v_available_account_id uuid;
    v_provider_asset_account_id uuid;
    v_provider_expense_account_id uuid;
    v_payout_revenue_account_id uuid;
    v_entries jsonb;
    v_public_payload jsonb;
begin
    if p_payout_evidence_id is null then
        raise exception 'payout evidence id is required'
            using errcode = '23514';
    end if;

    -- Resolve immutable parent identity without locks, then acquire locks in the
    -- canonical order Payout -> attempt -> evidence. The payout lock serializes
    -- contradictory terminal evidence before any financial mutation occurs.
    select payout_id, payout_attempt_id
      into v_parent_payout_id, v_parent_attempt_id
      from app.payout_evidence
     where id = p_payout_evidence_id;

    if not found then
        raise exception 'payout evidence does not exist'
            using errcode = '23514';
    end if;

    select *
      into v_payout
      from app.payouts
     where id = v_parent_payout_id
     for update;

    if not found then
        raise exception 'payout does not exist'
            using errcode = '23514';
    end if;

    select *
      into v_attempt
      from app.payout_attempts
     where id = v_parent_attempt_id
     for update;

    if not found then
        raise exception 'payout attempt does not exist'
            using errcode = '23514';
    end if;

    select *
      into v_evidence
      from app.payout_evidence
     where id = p_payout_evidence_id
     for update;

    if not found
       or v_evidence.payout_id is distinct from v_payout.id
       or v_evidence.payout_attempt_id is distinct from v_attempt.id
       or v_attempt.payout_id is distinct from v_payout.id
       or v_evidence.environment is distinct from v_payout.environment then
        raise exception 'payout evidence identity/scope is inconsistent'
            using errcode = '23514';
    end if;

    -- Reapplying one already classified observation is a pure no-op.
    if v_evidence.application_state in ('applied', 'absorbed', 'conflict') then
        return v_payout.state;
    end if;

    -- The external-execution evidence boundary is not allowed to resolve an
    -- operation before execution ownership was acquired.
    if v_payout.state in ('requested', 'rejected', 'cancelled') then
        raise exception 'payout is not in an externally executing state: %', v_payout.state
            using errcode = '23514';
    end if;

    -- Terminal history is immutable. Additional agreeing evidence is retained
    -- as absorbed; contradictory evidence is retained as conflict and requires
    -- a future audited correction path rather than an automatic rewind.
    if v_payout.state = 'completed' then
        if v_evidence.outcome = 'completed' then
            update app.payout_evidence
               set application_state = 'absorbed',
                   application_reason = 'terminal_state_already_completed',
                   applied_at = now()
             where id = v_evidence.id;
        else
            update app.payout_evidence
               set application_state = 'conflict',
                   application_reason = 'terminal_completed_conflicts_with_' || v_evidence.outcome,
                   applied_at = now()
             where id = v_evidence.id;
        end if;
        return 'completed';
    end if;

    if v_payout.state = 'failed' then
        if v_evidence.outcome = 'definitively_failed' then
            update app.payout_evidence
               set application_state = 'absorbed',
                   application_reason = 'terminal_state_already_failed',
                   applied_at = now()
             where id = v_evidence.id;
        else
            update app.payout_evidence
               set application_state = 'conflict',
                   application_reason = 'terminal_failed_conflicts_with_' || v_evidence.outcome,
                   applied_at = now()
             where id = v_evidence.id;
        end if;
        return 'failed';
    end if;

    if v_payout.state not in ('processing', 'execution_unknown') then
        raise exception 'unsupported payout state for external resolution: %', v_payout.state
            using errcode = '23514';
    end if;

    if v_attempt.state not in ('executing', 'processing', 'execution_unknown') then
        raise exception 'payout attempt is not externally resolvable: %', v_attempt.state
            using errcode = '23514';
    end if;

    if v_evidence.outcome = 'processing' then
        -- A late processing observation may not regress execution_unknown.
        if v_payout.state = 'processing' then
            update app.payout_attempts
               set state = 'processing',
                   provider_status_raw = coalesce(v_evidence.provider_status_raw, provider_status_raw),
                   provider_payout_id = coalesce(v_evidence.provider_payout_id, provider_payout_id),
                   updated_at = v_evidence.occurred_at
             where id = v_attempt.id;
        else
            update app.payout_attempts
               set provider_status_raw = coalesce(v_evidence.provider_status_raw, provider_status_raw),
                   provider_payout_id = coalesce(v_evidence.provider_payout_id, provider_payout_id),
                   updated_at = v_evidence.occurred_at
             where id = v_attempt.id;
        end if;

        update app.payout_evidence
           set application_state = 'applied',
               application_reason = null,
               applied_at = now()
         where id = v_evidence.id;

        return v_payout.state;
    end if;

    if v_evidence.outcome = 'execution_unknown' then
        update app.payout_attempts
           set state = 'execution_unknown',
               provider_status_raw = coalesce(v_evidence.provider_status_raw, provider_status_raw),
               provider_payout_id = coalesce(v_evidence.provider_payout_id, provider_payout_id),
               updated_at = v_evidence.occurred_at
         where id = v_attempt.id;

        update app.payouts
           set state = 'execution_unknown',
               updated_at = v_evidence.occurred_at
         where id = v_payout.id;

        update app.payout_evidence
           set application_state = 'applied',
               application_reason = null,
               applied_at = now()
         where id = v_evidence.id;

        return 'execution_unknown';
    end if;

    if v_evidence.outcome = 'completed' then
        if v_evidence.provider_cost_cents is null or v_evidence.provider_cost_cents < 0 then
            raise exception 'completed payout evidence requires authoritative provider cost'
                using errcode = '23514';
        end if;

        v_blocked_account_id := app.ensure_account(
            v_payout.merchant_id, null, v_payout.environment, 'BRL',
            'merchant_payout_blocked_liability'
        );
        v_provider_asset_account_id := app.ensure_account(
            null, v_attempt.provider_account_id, v_payout.environment, 'BRL',
            'provider_settlement_asset'
        );
        v_provider_expense_account_id := app.ensure_account(
            null, null, v_payout.environment, 'BRL',
            'provider_payout_fee_expense'
        );
        v_payout_revenue_account_id := app.ensure_account(
            null, null, v_payout.environment, 'BRL',
            'payout_fee_revenue'
        );

        v_entries := jsonb_build_array(
            jsonb_build_object(
                'account_id', v_blocked_account_id,
                'direction', 'debit',
                'amount_cents', v_payout.amount_cents
            ),
            jsonb_build_object(
                'account_id', v_provider_asset_account_id,
                'direction', 'credit',
                'amount_cents', v_payout.recipient_amount_cents + v_evidence.provider_cost_cents
            )
        );

        if v_evidence.provider_cost_cents > 0 then
            v_entries := v_entries || jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_provider_expense_account_id,
                    'direction', 'debit',
                    'amount_cents', v_evidence.provider_cost_cents
                )
            );
        end if;

        if v_payout.merchant_fee_cents > 0 then
            v_entries := v_entries || jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_payout_revenue_account_id,
                    'direction', 'credit',
                    'amount_cents', v_payout.merchant_fee_cents
                )
            );
        end if;

        perform app.post_ledger_transaction(
            v_payout.environment,
            'payout',
            v_payout.id,
            'completed',
            v_entries
        );

        update app.payout_attempts
           set state = 'succeeded',
               provider_status_raw = coalesce(v_evidence.provider_status_raw, provider_status_raw),
               provider_payout_id = coalesce(v_evidence.provider_payout_id, provider_payout_id),
               provider_cost_cents = v_evidence.provider_cost_cents,
               finished_at = v_evidence.occurred_at,
               updated_at = v_evidence.occurred_at
         where id = v_attempt.id;

        update app.payouts
           set state = 'completed',
               updated_at = v_evidence.occurred_at
         where id = v_payout.id;

        v_public_payload := jsonb_build_object(
            'payout_id', v_payout.id,
            'state', 'completed',
            'amount_cents', v_payout.amount_cents,
            'merchant_fee_cents', v_payout.merchant_fee_cents,
            'recipient_amount_cents', v_payout.recipient_amount_cents,
            'currency', v_payout.currency,
            'occurred_at', v_evidence.occurred_at
        );

        perform app.record_webhook_event(
            v_payout.merchant_id,
            v_payout.environment,
            'payout.completed',
            'payout',
            v_payout.id,
            'payout_evidence',
            v_evidence.id,
            'v1',
            v_public_payload,
            v_evidence.occurred_at
        );

        update app.payout_evidence
           set application_state = 'applied',
               application_reason = null,
               applied_at = now()
         where id = v_evidence.id;

        return 'completed';
    end if;

    if v_evidence.outcome = 'definitively_failed' then
        v_blocked_account_id := app.ensure_account(
            v_payout.merchant_id, null, v_payout.environment, 'BRL',
            'merchant_payout_blocked_liability'
        );
        v_available_account_id := app.ensure_account(
            v_payout.merchant_id, null, v_payout.environment, 'BRL',
            'merchant_available_liability'
        );

        perform app.post_ledger_transaction(
            v_payout.environment,
            'payout',
            v_payout.id,
            'release_failure',
            jsonb_build_array(
                jsonb_build_object(
                    'account_id', v_blocked_account_id,
                    'direction', 'debit',
                    'amount_cents', v_payout.amount_cents
                ),
                jsonb_build_object(
                    'account_id', v_available_account_id,
                    'direction', 'credit',
                    'amount_cents', v_payout.amount_cents
                )
            )
        );

        update app.payout_attempts
           set state = 'definitively_failed',
               provider_status_raw = coalesce(v_evidence.provider_status_raw, provider_status_raw),
               provider_payout_id = coalesce(v_evidence.provider_payout_id, provider_payout_id),
               finished_at = v_evidence.occurred_at,
               updated_at = v_evidence.occurred_at
         where id = v_attempt.id;

        update app.payouts
           set state = 'failed',
               updated_at = v_evidence.occurred_at
         where id = v_payout.id;

        v_public_payload := jsonb_build_object(
            'payout_id', v_payout.id,
            'state', 'failed',
            'amount_cents', v_payout.amount_cents,
            'currency', v_payout.currency,
            'occurred_at', v_evidence.occurred_at
        );

        perform app.record_webhook_event(
            v_payout.merchant_id,
            v_payout.environment,
            'payout.failed',
            'payout',
            v_payout.id,
            'payout_evidence',
            v_evidence.id,
            'v1',
            v_public_payload,
            v_evidence.occurred_at
        );

        update app.payout_evidence
           set application_state = 'applied',
               application_reason = null,
               applied_at = now()
         where id = v_evidence.id;

        return 'failed';
    end if;

    raise exception 'unsupported normalized payout evidence outcome: %', v_evidence.outcome
        using errcode = '23514';
end;
$$;

revoke all on function app.record_payout_evidence(
    uuid, uuid, text, text, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.apply_payout_evidence(uuid)
    from public, anon, authenticated, service_role;
