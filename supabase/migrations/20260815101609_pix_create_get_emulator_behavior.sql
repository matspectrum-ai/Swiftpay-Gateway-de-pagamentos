-- SwiftPay V2 A2: trusted Pix create/get emulator database behavior.
--
-- This migration replaces the fail-closed A2 stubs with the minimal behavior
-- frozen by pix-create-get-emulator-v0. It remains sandbox-only and performs no
-- ledger, job, merchant-webhook, or live-provider network effects.

create function app._a2_public_payment_json(p_payment_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select pg_catalog.jsonb_build_object(
        'id', p.id::text,
        'externalId', p.external_id,
        'method', 'pix',
        'amount', p.amount_cents,
        'fee', p.merchant_fee_cents,
        'netAmount', p.merchant_net_cents,
        'currency', p.currency,
        'status', p.collection_status,
        'description', p.description,
        'environment', p.environment,
        'expiresAt', pg_catalog.to_char(
            p.expires_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'createdAt', pg_catalog.to_char(
            p.created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'pix',
        case
            when p.collection_status = 'pending' then (
                select pg_catalog.jsonb_build_object(
                    'txId', pa.provider_txid,
                    'qrCode', pa.pix_qr_reference,
                    'copyAndPaste', pa.pix_copy_paste,
                    'expiresAt', pg_catalog.to_char(
                        pa.expires_at at time zone 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    )
                )
                from app.provider_attempts pa
                where pa.payment_id = p.id
                  and pa.state = 'succeeded'
                order by pa.attempt_number desc
                limit 1
            )
            else null
        end
    )
    from app.payments p
    where p.id = p_payment_id;
$$;

revoke all on function app._a2_public_payment_json(uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

create or replace function app.prepare_api_pix_payment(
    p_merchant_id uuid,
    p_environment text,
    p_idempotency_key text,
    p_request_hash text,
    p_request jsonb,
    p_pricing jsonb,
    p_routing_policy_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_amount bigint;
    v_expiration_minutes integer;
    v_customer_snapshot jsonb;
    v_expires_at timestamptz;
    v_provider_id uuid;
    v_provider_account_id uuid;
    v_eligible_count bigint;
    v_idempotency_id uuid;
    v_existing app.request_idempotency%rowtype;
    v_payment_id uuid;
    v_attempt_id uuid;
    v_attempt_state text;
    v_attempt_expires_at timestamptz;
    v_payment jsonb;
begin
    if p_environment is distinct from 'sandbox' then
        raise exception using
            errcode = '42501',
            message = 'A2 Pix creation is not enabled for this environment';
    end if;

    if p_merchant_id is null
       or not exists (
            select 1
            from app.merchants m
            where m.id = p_merchant_id
              and m.lifecycle_status = 'active'
       ) then
        raise exception using
            errcode = '42501',
            message = 'A2 merchant is not authorized for sandbox Pix creation';
    end if;

    if p_idempotency_key is null
       or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) < 1
       or pg_catalog.length(p_idempotency_key) > 160
       or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key) then
        raise exception using
            errcode = '22023',
            message = 'A2 idempotency key is invalid';
    end if;

    if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
        raise exception using
            errcode = '22023',
            message = 'A2 request hash is invalid';
    end if;

    if p_request is null
       or pg_catalog.jsonb_typeof(p_request) <> 'object'
       or p_request ->> 'method' is distinct from 'pix'
       or p_request ->> 'currency' is distinct from 'BRL' then
        raise exception using
            errcode = '22023',
            message = 'A2 Pix request is invalid';
    end if;

    begin
        v_amount := (p_request ->> 'amount')::bigint;
        v_expiration_minutes := (p_request ->> 'pixExpirationMinutes')::integer;
    exception when others then
        raise exception using
            errcode = '22023',
            message = 'A2 Pix request numeric fields are invalid';
    end;

    if v_amount is null or v_amount < 1 or v_amount > 9007199254740991 then
        raise exception using
            errcode = '22023',
            message = 'A2 Pix amount is invalid';
    end if;

    if v_expiration_minutes is null or v_expiration_minutes < 5 or v_expiration_minutes > 1440 then
        raise exception using
            errcode = '22023',
            message = 'A2 Pix expiration is invalid';
    end if;

    if p_routing_policy_version is distinct from 'sandbox-emulator-v0'
       or p_pricing is null
       or pg_catalog.jsonb_typeof(p_pricing) <> 'object'
       or pg_catalog.jsonb_object_length(p_pricing) <> 9
       or p_pricing ->> 'pricingVersion' is distinct from 'sandbox-zero-fee-v0'
       or p_pricing ->> 'feeMode' is distinct from 'fixed'
       or (p_pricing ->> 'feeFixedCents')::bigint is distinct from 0
       or (p_pricing ->> 'feeBasisPoints')::integer is distinct from 0
       or (p_pricing ->> 'feePercentageComponentCents')::bigint is distinct from 0
       or (p_pricing ->> 'merchantFeeCents')::bigint is distinct from 0
       or (p_pricing ->> 'merchantNetCents')::bigint is distinct from v_amount
       or p_pricing ->> 'roundingPolicyVersion' is distinct from 'ceil-bp-v1'
       or p_pricing ->> 'refundFeePolicy' is distinct from 'merchant_fee_non_refundable' then
        raise exception using
            errcode = '22023',
            message = 'A2 sandbox pricing or routing snapshot is invalid';
    end if;

    insert into app.request_idempotency (
        merchant_id,
        environment,
        operation,
        idempotency_key,
        request_hash,
        state
    ) values (
        p_merchant_id,
        'sandbox',
        'create_payment',
        p_idempotency_key,
        p_request_hash,
        'in_progress'
    )
    on conflict (merchant_id, environment, operation, idempotency_key) do nothing
    returning id into v_idempotency_id;

    if v_idempotency_id is null then
        select ri.*
        into v_existing
        from app.request_idempotency ri
        where ri.merchant_id = p_merchant_id
          and ri.environment = 'sandbox'
          and ri.operation = 'create_payment'
          and ri.idempotency_key = p_idempotency_key
        for update;

        if not found then
            raise exception using
                errcode = '55000',
                message = 'A2 idempotency state disappeared unexpectedly';
        end if;

        if v_existing.request_hash <> p_request_hash then
            return pg_catalog.jsonb_build_object('kind', 'conflict');
        end if;

        if v_existing.resource_type is distinct from 'payment'
           or v_existing.resource_id is null then
            raise exception using
                errcode = '55000',
                message = 'A2 idempotency resource link is invalid';
        end if;

        if v_existing.state = 'completed' then
            if v_existing.http_status_snapshot <> 201
               or v_existing.response_snapshot is null then
                raise exception using
                    errcode = '55000',
                    message = 'A2 completed idempotency snapshot is invalid';
            end if;

            return pg_catalog.jsonb_build_object(
                'kind', 'completed',
                'httpStatus', 201,
                'payment', v_existing.response_snapshot
            );
        end if;

        if v_existing.state <> 'in_progress' then
            raise exception using
                errcode = '55000',
                message = 'A2 idempotency state is not replayable';
        end if;

        select pa.id, pa.state, pa.expires_at
        into v_attempt_id, v_attempt_state, v_attempt_expires_at
        from app.provider_attempts pa
        where pa.payment_id = v_existing.resource_id
          and pa.state in ('prepared', 'executing', 'execution_unknown')
        order by pa.attempt_number desc
        limit 1;

        if not found then
            raise exception using
                errcode = '55000',
                message = 'A2 unresolved idempotency has no unresolved ProviderAttempt';
        end if;

        v_payment := app._a2_public_payment_json(v_existing.resource_id);
        if v_payment is null then
            raise exception using
                errcode = '55000',
                message = 'A2 idempotency Payment projection is unavailable';
        end if;

        if v_attempt_state = 'prepared' then
            return pg_catalog.jsonb_build_object(
                'kind', 'prepared',
                'payment', v_payment,
                'providerAttempt', pg_catalog.jsonb_build_object(
                    'id', v_attempt_id::text,
                    'amountCents', (v_payment ->> 'amount')::bigint,
                    'expiresAt', pg_catalog.to_char(
                        v_attempt_expires_at at time zone 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    )
                )
            );
        end if;

        return pg_catalog.jsonb_build_object(
            'kind', v_attempt_state,
            'payment', v_payment
        );
    end if;

    select pg_catalog.count(*)
    into v_eligible_count
    from app.provider_accounts pa
    join app.providers pr on pr.id = pa.provider_id
    where pr.code = 'swiftpay_emulator'
      and pr.status = 'active'
      and pa.merchant_id is null
      and pa.environment = 'sandbox'
      and pa.status = 'active'
      and pa.capabilities @> '{"create_pix_charge":true}'::jsonb;

    if v_eligible_count <> 1 then
        raise exception using
            errcode = '55000',
            message = 'A2 sandbox emulator routing is not uniquely configured';
    end if;

    select pr.id, pa.id
    into v_provider_id, v_provider_account_id
    from app.provider_accounts pa
    join app.providers pr on pr.id = pa.provider_id
    where pr.code = 'swiftpay_emulator'
      and pr.status = 'active'
      and pa.merchant_id is null
      and pa.environment = 'sandbox'
      and pa.status = 'active'
      and pa.capabilities @> '{"create_pix_charge":true}'::jsonb;

    v_payment_id := pg_catalog.gen_random_uuid();
    v_attempt_id := pg_catalog.gen_random_uuid();
    v_expires_at := pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(mins => v_expiration_minutes);

    v_customer_snapshot := pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
            'name', p_request ->> 'customerName',
            'document', p_request ->> 'customerDocument',
            'email', p_request ->> 'customerEmail',
            'phone', p_request ->> 'customerPhone'
        )
    );
    if v_customer_snapshot = '{}'::jsonb then
        v_customer_snapshot := null;
    end if;

    insert into app.payments (
        id,
        merchant_id,
        environment,
        external_id,
        source,
        collection_status,
        amount_cents,
        currency,
        description,
        customer_snapshot,
        pricing_version,
        rounding_policy_version,
        merchant_fee_cents,
        merchant_net_cents,
        provider_cost_cents,
        refunded_amount_cents,
        expires_at,
        refund_fee_policy,
        fee_mode,
        fee_fixed_cents,
        fee_basis_points,
        fee_percentage_component_cents,
        routing_policy_version
    ) values (
        v_payment_id,
        p_merchant_id,
        'sandbox',
        p_request ->> 'externalId',
        'api',
        'creating',
        v_amount,
        'BRL',
        p_request ->> 'description',
        v_customer_snapshot,
        p_pricing ->> 'pricingVersion',
        p_pricing ->> 'roundingPolicyVersion',
        (p_pricing ->> 'merchantFeeCents')::bigint,
        (p_pricing ->> 'merchantNetCents')::bigint,
        null,
        0,
        v_expires_at,
        p_pricing ->> 'refundFeePolicy',
        p_pricing ->> 'feeMode',
        (p_pricing ->> 'feeFixedCents')::bigint,
        (p_pricing ->> 'feeBasisPoints')::integer,
        (p_pricing ->> 'feePercentageComponentCents')::bigint,
        p_routing_policy_version
    );

    insert into app.provider_attempts (
        id,
        payment_id,
        provider_id,
        provider_account_id,
        operation,
        attempt_number,
        state,
        client_reference,
        request_fingerprint,
        expires_at
    ) values (
        v_attempt_id,
        v_payment_id,
        v_provider_id,
        v_provider_account_id,
        'create_pix_charge',
        1,
        'prepared',
        v_attempt_id::text,
        p_request_hash,
        v_expires_at
    );

    update app.request_idempotency
    set resource_type = 'payment',
        resource_id = v_payment_id
    where id = v_idempotency_id;

    v_payment := app._a2_public_payment_json(v_payment_id);

    return pg_catalog.jsonb_build_object(
        'kind', 'prepared',
        'payment', v_payment,
        'providerAttempt', pg_catalog.jsonb_build_object(
            'id', v_attempt_id::text,
            'amountCents', v_amount,
            'expiresAt', pg_catalog.to_char(
                v_expires_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
        )
    );
exception
    when invalid_text_representation or numeric_value_out_of_range then
        raise exception using
            errcode = '22023',
            message = 'A2 request or pricing numeric value is invalid';
end;
$$;

create or replace function app.claim_api_pix_attempt(
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid,
    p_provider_attempt_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_execution_token uuid := pg_catalog.gen_random_uuid();
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    if p_environment is distinct from 'sandbox' then
        raise exception using
            errcode = '42501',
            message = 'A2 Pix execution claim is not enabled for this environment';
    end if;

    update app.provider_attempts pa
    set state = 'executing',
        execution_token = v_execution_token,
        lease_expires_at = v_now + interval '30 seconds',
        started_at = v_now,
        updated_at = v_now
    from app.payments p
    join app.merchants m on m.id = p.merchant_id
    where pa.id = p_provider_attempt_id
      and pa.payment_id = p_payment_id
      and p.id = p_payment_id
      and p.merchant_id = p_merchant_id
      and p.environment = 'sandbox'
      and p.collection_status = 'creating'
      and m.lifecycle_status = 'active'
      and pa.state = 'prepared';

    if found then
        return pg_catalog.jsonb_build_object(
            'claimed', true,
            'executionToken', v_execution_token::text
        );
    end if;

    return pg_catalog.jsonb_build_object('claimed', false);
end;
$$;

create or replace function app.resolve_api_pix_attempt(
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid,
    p_provider_attempt_id uuid,
    p_execution_token uuid,
    p_resolution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_certainty text;
    v_expires_at timestamptz;
    v_payment jsonb;
    v_idempotency_id uuid;
begin
    if p_environment is distinct from 'sandbox' then
        raise exception using
            errcode = '42501',
            message = 'A2 Pix resolution is not enabled for this environment';
    end if;

    if p_resolution is null or pg_catalog.jsonb_typeof(p_resolution) <> 'object' then
        raise exception using
            errcode = '22023',
            message = 'A2 Pix resolution is invalid';
    end if;

    perform 1
    from app.provider_attempts pa
    join app.payments p on p.id = pa.payment_id
    where pa.id = p_provider_attempt_id
      and pa.payment_id = p_payment_id
      and p.id = p_payment_id
      and p.merchant_id = p_merchant_id
      and p.environment = 'sandbox'
      and pa.state = 'executing'
      and pa.execution_token = p_execution_token
    for update of pa, p;

    if not found then
        raise exception using
            errcode = '55000',
            message = 'A2 Pix resolution does not own the current execution token';
    end if;

    select ri.id
    into v_idempotency_id
    from app.request_idempotency ri
    where ri.merchant_id = p_merchant_id
      and ri.environment = 'sandbox'
      and ri.operation = 'create_payment'
      and ri.resource_type = 'payment'
      and ri.resource_id = p_payment_id
    for update;

    if not found then
        raise exception using
            errcode = '55000',
            message = 'A2 Pix Payment has no idempotency owner';
    end if;

    v_certainty := p_resolution ->> 'certainty';

    if v_certainty = 'success' then
        if pg_catalog.coalesce(p_resolution ->> 'providerPaymentId', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'txId', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'copyAndPaste', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'qrCode', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'expiresAt', '') = '' then
            raise exception using
                errcode = '22023',
                message = 'A2 successful Pix resolution is incomplete';
        end if;

        begin
            v_expires_at := (p_resolution ->> 'expiresAt')::timestamptz;
        exception when others then
            raise exception using
                errcode = '22023',
                message = 'A2 successful Pix resolution expiration is invalid';
        end;

        update app.provider_attempts
        set state = 'succeeded',
            provider_payment_id = p_resolution ->> 'providerPaymentId',
            provider_txid = p_resolution ->> 'txId',
            pix_copy_paste = p_resolution ->> 'copyAndPaste',
            pix_qr_reference = p_resolution ->> 'qrCode',
            expires_at = v_expires_at,
            execution_token = null,
            lease_expires_at = null,
            finished_at = v_now,
            recovery_required_at = null,
            last_error_class = null,
            last_error_code = null,
            updated_at = v_now
        where id = p_provider_attempt_id;

        update app.payments
        set collection_status = 'pending',
            expires_at = v_expires_at,
            updated_at = v_now
        where id = p_payment_id;

        v_payment := app._a2_public_payment_json(p_payment_id);

        update app.request_idempotency
        set state = 'completed',
            http_status_snapshot = 201,
            response_snapshot = v_payment,
            completed_at = v_now
        where id = v_idempotency_id;

        return v_payment;
    end if;

    if v_certainty = 'execution_unknown' then
        if p_resolution ->> 'errorClass' is distinct from 'execution_unknown' then
            raise exception using
                errcode = '22023',
                message = 'A2 execution-unknown resolution classification is invalid';
        end if;

        update app.provider_attempts
        set state = 'execution_unknown',
            execution_token = null,
            lease_expires_at = null,
            recovery_required_at = v_now,
            last_error_class = 'execution_unknown',
            last_error_code = null,
            updated_at = v_now
        where id = p_provider_attempt_id;

        return app._a2_public_payment_json(p_payment_id);
    end if;

    if v_certainty = 'definitive_rejection' then
        if p_resolution ->> 'errorClass' is distinct from 'definitive_rejection' then
            raise exception using
                errcode = '22023',
                message = 'A2 definitive-rejection classification is invalid';
        end if;

        update app.provider_attempts
        set state = 'definitively_failed',
            execution_token = null,
            lease_expires_at = null,
            finished_at = v_now,
            recovery_required_at = null,
            last_error_class = 'definitive_rejection',
            last_error_code = p_resolution ->> 'errorCode',
            updated_at = v_now
        where id = p_provider_attempt_id;

        update app.payments
        set collection_status = 'failed',
            updated_at = v_now
        where id = p_payment_id;

        v_payment := app._a2_public_payment_json(p_payment_id);

        update app.request_idempotency
        set state = 'completed',
            http_status_snapshot = 201,
            response_snapshot = v_payment,
            completed_at = v_now
        where id = v_idempotency_id;

        return v_payment;
    end if;

    raise exception using
        errcode = '22023',
        message = 'A2 Pix resolution certainty is invalid';
end;
$$;

create or replace function app.get_api_payment(
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_payment_id uuid;
begin
    select p.id
    into v_payment_id
    from app.payments p
    where p.id = p_payment_id
      and p.merchant_id = p_merchant_id
      and p.environment = p_environment;

    if not found then
        return null;
    end if;

    return app._a2_public_payment_json(v_payment_id);
end;
$$;

-- Reassert the frozen A2 execution boundary after replacing the stubs.
revoke all on function app.prepare_api_pix_payment(uuid, text, text, text, jsonb, jsonb, text)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.claim_api_pix_attempt(uuid, text, uuid, uuid)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.get_api_payment(uuid, text, uuid)
    from public, anon, authenticated, service_role, swiftpay_worker;

grant execute on function app.prepare_api_pix_payment(uuid, text, text, text, jsonb, jsonb, text)
    to swiftpay_api;
grant execute on function app.claim_api_pix_attempt(uuid, text, uuid, uuid)
    to swiftpay_api;
grant execute on function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    to swiftpay_api;
grant execute on function app.get_api_payment(uuid, text, uuid)
    to swiftpay_api;
