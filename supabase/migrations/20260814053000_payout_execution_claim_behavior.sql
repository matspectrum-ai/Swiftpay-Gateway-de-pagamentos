-- SwiftPay V2 Phase 2: payout provider execution preparation and one-shot claim.
-- This boundary authorizes at most one worker to begin one monetary provider
-- execution. It never performs HTTP and lease expiry never makes an attempt
-- executable again.

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
declare
    v_payout app.payouts%rowtype;
    v_provider_account app.provider_accounts%rowtype;
    v_existing app.payout_attempts%rowtype;
    v_attempt_id uuid;
    v_attempt_number integer;
begin
    if p_payout_id is null
       or p_provider_id is null
       or p_provider_account_id is null
       or p_client_reference is null or length(trim(p_client_reference)) = 0
       or p_request_fingerprint is null or length(trim(p_request_fingerprint)) = 0
       or p_prepared_at is null then
        raise exception 'invalid payout attempt preparation request'
            using errcode = '23514';
    end if;

    -- Serialize all attempt preparation for one payout. This also establishes
    -- the lock order used by claim: Payout first, then attempt.
    select *
      into v_payout
      from app.payouts
     where id = p_payout_id
     for update;

    if not found then
        raise exception 'payout does not exist' using errcode = '23514';
    end if;

    if v_payout.state <> 'requested' then
        raise exception 'payout is not eligible for provider attempt preparation: %', v_payout.state
            using errcode = '23514';
    end if;

    select *
      into v_provider_account
      from app.provider_accounts
     where id = p_provider_account_id
       and provider_id = p_provider_id
       and environment = v_payout.environment
       and (merchant_id is null or merchant_id = v_payout.merchant_id);

    if not found then
        raise exception 'provider account does not match payout provider/environment/merchant scope'
            using errcode = '23514';
    end if;

    -- Client reference is the provider-operation duplicate-protection identity.
    -- Reusing it for a different operation or payload is always a conflict.
    select *
      into v_existing
      from app.payout_attempts
     where provider_account_id = p_provider_account_id
       and client_reference = p_client_reference;

    if found then
        if v_existing.payout_id is distinct from p_payout_id
           or v_existing.provider_id is distinct from p_provider_id
           or v_existing.request_fingerprint is distinct from p_request_fingerprint then
            raise exception 'payout client reference reused with different provider request'
                using errcode = '23505';
        end if;

        return v_existing.id;
    end if;

    -- A payout may never have two independently executable unresolved attempts.
    select *
      into v_existing
      from app.payout_attempts
     where payout_id = p_payout_id
       and state in ('prepared', 'executing', 'processing', 'execution_unknown')
     limit 1;

    if found then
        raise exception 'payout already has an unresolved provider execution'
            using errcode = '23505';
    end if;

    select coalesce(max(attempt_number), 0) + 1
      into v_attempt_number
      from app.payout_attempts
     where payout_id = p_payout_id;

    insert into app.payout_attempts (
        payout_id,
        provider_id,
        provider_account_id,
        attempt_number,
        state,
        client_reference,
        request_fingerprint,
        created_at,
        updated_at
    ) values (
        p_payout_id,
        p_provider_id,
        p_provider_account_id,
        v_attempt_number,
        'prepared',
        p_client_reference,
        p_request_fingerprint,
        p_prepared_at,
        p_prepared_at
    )
    returning id into v_attempt_id;

    return v_attempt_id;
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
declare
    v_payout_id uuid;
    v_payout app.payouts%rowtype;
    v_attempt app.payout_attempts%rowtype;
    v_execution_token uuid;
begin
    if p_payout_attempt_id is null
       or p_lease_expires_at is null
       or p_claimed_at is null
       or p_lease_expires_at <= p_claimed_at then
        raise exception 'invalid payout execution claim/lease'
            using errcode = '23514';
    end if;

    -- Read immutable parent identity first, then acquire locks in the same
    -- Payout -> attempt order used by preparation to avoid lock-order inversion.
    select payout_id
      into v_payout_id
      from app.payout_attempts
     where id = p_payout_attempt_id;

    if not found then
        raise exception 'payout attempt does not exist' using errcode = '23514';
    end if;

    select *
      into v_payout
      from app.payouts
     where id = v_payout_id
     for update;

    if not found then
        raise exception 'payout does not exist' using errcode = '23514';
    end if;

    select *
      into v_attempt
      from app.payout_attempts
     where id = p_payout_attempt_id
     for update;

    if not found then
        raise exception 'payout attempt does not exist' using errcode = '23514';
    end if;

    if v_attempt.state <> 'prepared' then
        -- Deliberately independent from lease expiry: once execution was ever
        -- authorized, this function cannot issue another provider POST token.
        raise exception 'payout attempt is not claimable: %', v_attempt.state
            using errcode = '23514';
    end if;

    if v_payout.state <> 'requested' then
        raise exception 'payout is not claimable for execution: %', v_payout.state
            using errcode = '23514';
    end if;

    v_execution_token := gen_random_uuid();

    update app.payout_attempts
       set state = 'executing',
           execution_token = v_execution_token,
           lease_expires_at = p_lease_expires_at,
           started_at = p_claimed_at,
           updated_at = p_claimed_at
     where id = p_payout_attempt_id;

    update app.payouts
       set state = 'processing',
           updated_at = p_claimed_at
     where id = v_payout_id;

    return v_execution_token;
end;
$$;

revoke all on function app.prepare_payout_attempt(
    uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.claim_payout_attempt(
    uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
