-- SwiftPay V2 Phase 2: payout execution-claim structural foundation.
-- This migration closes immutable routing/execution metadata required before
-- any monetary Pix-out HTTP call. prepare/claim behavior remains intentionally
-- unimplemented until its own fail-first behavioral suite is RED.

alter table app.payouts
    add column routing_policy_version text not null;

alter table app.payouts
    add constraint payouts_routing_policy_version_ck
    check (length(trim(routing_policy_version)) > 0);

alter table app.payout_attempts
    add column request_fingerprint text not null,
    add column provider_status_raw text,
    add column provider_cost_cents bigint,
    add column started_at timestamptz,
    add column finished_at timestamptz,
    add column last_error_class text,
    add column last_error_code text;

alter table app.payout_attempts
    add constraint payout_attempts_request_fingerprint_ck
        check (length(trim(request_fingerprint)) > 0),
    add constraint payout_attempts_provider_cost_ck
        check (provider_cost_cents is null or provider_cost_cents >= 0);

-- The old reservation signature cannot remain as a bypass around the immutable
-- routing-policy snapshot.
drop function app.reserve_payout(
    uuid, text, text, bigint, bigint, jsonb, text, text, timestamptz
);

create or replace function app.reserve_payout(
    p_merchant_id uuid,
    p_environment text,
    p_currency text,
    p_amount_cents bigint,
    p_merchant_fee_cents bigint,
    p_destination_snapshot jsonb,
    p_routing_policy_version text,
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
       or p_routing_policy_version is null or length(trim(p_routing_policy_version)) = 0
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
        routing_policy_version,
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
        p_routing_policy_version,
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

create or replace function app.prepare_payout_attempt(
    p_payout_id uuid,
    p_provider_id uuid,
    p_provider_account_id uuid,
    p_client_reference text,
    p_request_fingerprint text,
    p_prepared_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'prepare_payout_attempt behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

create or replace function app.claim_payout_attempt(
    p_payout_attempt_id uuid,
    p_lease_expires_at timestamptz,
    p_claimed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'claim_payout_attempt behavioral contract not implemented'
        using errcode = '0A000';
end;
$$;

revoke all on function app.reserve_payout(
    uuid, text, text, bigint, bigint, jsonb, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.prepare_payout_attempt(
    uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.claim_payout_attempt(
    uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
