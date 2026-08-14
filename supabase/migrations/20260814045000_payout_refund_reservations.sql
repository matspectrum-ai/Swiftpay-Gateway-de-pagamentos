-- SwiftPay V2 Phase 2: atomic payout/refund reservation mechanics.
-- This slice intentionally implements reservation only. Provider execution and
-- terminal/unknown resolution remain behind their fail-first tests.

create or replace function app.reserve_payout(
    p_merchant_id uuid,
    p_environment text,
    p_currency text,
    p_amount_cents bigint,
    p_merchant_fee_cents bigint,
    p_destination_snapshot jsonb,
    p_idempotency_key text,
    p_request_fingerprint text,
    p_requested_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_existing app.payouts%rowtype;
    v_payout_id uuid;
    v_available_account_id uuid;
    v_blocked_account_id uuid;
begin
    if p_merchant_id is null
       or p_environment not in ('sandbox', 'production')
       or p_currency <> 'BRL'
       or p_amount_cents is null or p_amount_cents <= 0
       or p_merchant_fee_cents is null or p_merchant_fee_cents < 0
       or p_merchant_fee_cents >= p_amount_cents
       or p_destination_snapshot is null
       or jsonb_typeof(p_destination_snapshot) <> 'object'
       or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0
       or p_request_fingerprint is null or length(trim(p_request_fingerprint)) = 0
       or p_requested_at is null then
        raise exception 'invalid payout reservation request' using errcode = '23514';
    end if;

    select *
      into v_existing
      from app.payouts
     where merchant_id = p_merchant_id
       and environment = p_environment
       and idempotency_key = p_idempotency_key;

    if found then
        if v_existing.request_fingerprint is distinct from p_request_fingerprint then
            raise exception 'payout idempotency key reused with different request'
                using errcode = '23505';
        end if;
        return v_existing.id;
    end if;

    v_available_account_id := app.ensure_account(
        p_merchant_id, null, p_environment, 'BRL', 'merchant_available_liability'
    );
    v_blocked_account_id := app.ensure_account(
        p_merchant_id, null, p_environment, 'BRL', 'merchant_payout_blocked_liability'
    );

    insert into app.payouts (
        merchant_id,
        environment,
        currency,
        amount_cents,
        merchant_fee_cents,
        recipient_amount_cents,
        state,
        destination_snapshot,
        idempotency_key,
        request_fingerprint,
        created_at,
        updated_at
    ) values (
        p_merchant_id,
        p_environment,
        'BRL',
        p_amount_cents,
        p_merchant_fee_cents,
        p_amount_cents - p_merchant_fee_cents,
        'requested',
        p_destination_snapshot,
        p_idempotency_key,
        p_request_fingerprint,
        p_requested_at,
        p_requested_at
    )
    on conflict (merchant_id, environment, idempotency_key)
    do nothing
    returning id into v_payout_id;

    if v_payout_id is null then
        select *
          into strict v_existing
          from app.payouts
         where merchant_id = p_merchant_id
           and environment = p_environment
           and idempotency_key = p_idempotency_key;

        if v_existing.request_fingerprint is distinct from p_request_fingerprint then
            raise exception 'payout idempotency key reused with different request'
                using errcode = '23505';
        end if;
        return v_existing.id;
    end if;

    perform app.post_ledger_transaction(
        p_environment,
        'payout',
        v_payout_id,
        'reservation',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_available_account_id,
                'direction', 'debit',
                'amount_cents', p_amount_cents
            ),
            jsonb_build_object(
                'account_id', v_blocked_account_id,
                'direction', 'credit',
                'amount_cents', p_amount_cents
            )
        )
    );

    return v_payout_id;
end;
$$;

create or replace function app.reserve_refund(
    p_payment_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_amount_cents bigint,
    p_idempotency_key text,
    p_request_fingerprint text,
    p_requested_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_payment app.payments%rowtype;
    v_existing app.refunds%rowtype;
    v_refund_id uuid;
    v_reserved_or_completed_cents bigint;
    v_available_account_id uuid;
    v_blocked_account_id uuid;
begin
    if p_payment_id is null
       or p_merchant_id is null
       or p_environment not in ('sandbox', 'production')
       or p_amount_cents is null or p_amount_cents <= 0
       or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0
       or p_request_fingerprint is null or length(trim(p_request_fingerprint)) = 0
       or p_requested_at is null then
        raise exception 'invalid refund reservation request' using errcode = '23514';
    end if;

    -- Serialize all refund reservations for one Payment. This makes the
    -- refundable-limit check safe under concurrent requests with distinct keys.
    select *
      into strict v_payment
      from app.payments
     where id = p_payment_id
     for update;

    if v_payment.merchant_id <> p_merchant_id
       or v_payment.environment <> p_environment
       or v_payment.currency <> 'BRL'
       or v_payment.collection_status <> 'paid' then
        raise exception 'payment is not eligible for refund reservation'
            using errcode = '23514';
    end if;

    if v_payment.refund_fee_policy is null then
        raise exception 'payment has no refund fee policy snapshot'
            using errcode = '23514';
    end if;

    if v_payment.refund_fee_policy <> 'merchant_fee_non_refundable' then
        raise exception 'refund fee policy not executable in this slice: %', v_payment.refund_fee_policy
            using errcode = '0A000';
    end if;

    select *
      into v_existing
      from app.refunds
     where merchant_id = p_merchant_id
       and environment = p_environment
       and payment_id = p_payment_id
       and idempotency_key = p_idempotency_key;

    if found then
        if v_existing.request_fingerprint is distinct from p_request_fingerprint then
            raise exception 'refund idempotency key reused with different request'
                using errcode = '23505';
        end if;
        return v_existing.id;
    end if;

    select coalesce(sum(amount_cents), 0)::bigint
      into v_reserved_or_completed_cents
      from app.refunds
     where payment_id = p_payment_id
       and merchant_id = p_merchant_id
       and environment = p_environment
       and state in ('requested', 'processing', 'execution_unknown', 'completed');

    if v_reserved_or_completed_cents + p_amount_cents > v_payment.amount_cents then
        raise exception 'refund amount exceeds remaining refundable amount'
            using errcode = '23514';
    end if;

    v_available_account_id := app.ensure_account(
        p_merchant_id, null, p_environment, 'BRL', 'merchant_available_liability'
    );
    v_blocked_account_id := app.ensure_account(
        p_merchant_id, null, p_environment, 'BRL', 'merchant_refund_blocked_liability'
    );

    insert into app.refunds (
        payment_id,
        merchant_id,
        environment,
        currency,
        amount_cents,
        state,
        idempotency_key,
        request_fingerprint,
        fee_policy_version,
        created_at,
        updated_at
    ) values (
        p_payment_id,
        p_merchant_id,
        p_environment,
        'BRL',
        p_amount_cents,
        'requested',
        p_idempotency_key,
        p_request_fingerprint,
        v_payment.refund_fee_policy,
        p_requested_at,
        p_requested_at
    )
    on conflict (merchant_id, environment, payment_id, idempotency_key)
    do nothing
    returning id into v_refund_id;

    if v_refund_id is null then
        select *
          into strict v_existing
          from app.refunds
         where merchant_id = p_merchant_id
           and environment = p_environment
           and payment_id = p_payment_id
           and idempotency_key = p_idempotency_key;

        if v_existing.request_fingerprint is distinct from p_request_fingerprint then
            raise exception 'refund idempotency key reused with different request'
                using errcode = '23505';
        end if;
        return v_existing.id;
    end if;

    perform app.post_ledger_transaction(
        p_environment,
        'refund',
        v_refund_id,
        'reservation',
        jsonb_build_array(
            jsonb_build_object(
                'account_id', v_available_account_id,
                'direction', 'debit',
                'amount_cents', p_amount_cents
            ),
            jsonb_build_object(
                'account_id', v_blocked_account_id,
                'direction', 'credit',
                'amount_cents', p_amount_cents
            )
        )
    );

    return v_refund_id;
end;
$$;

revoke all on function app.reserve_payout(uuid,text,text,bigint,bigint,jsonb,text,text,timestamptz)
    from public, anon, authenticated, service_role;
revoke all on function app.reserve_refund(uuid,uuid,text,bigint,text,text,timestamptz)
    from public, anon, authenticated, service_role;
