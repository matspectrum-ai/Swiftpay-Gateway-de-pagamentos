-- SwiftPay V2 A26: repair A23 JSONB object arity on PostgreSQL.
--
-- PostgreSQL exposes jsonb_object_keys(jsonb), not jsonb_object_length(jsonb).
-- Replace only the two affected A23 arity checks. Function identities,
-- SECURITY DEFINER posture, search_path, grants, idempotency and payment state
-- semantics remain unchanged.

create or replace function app.create_dashboard_payment_link(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_idempotency_key text,
    p_request_hash text,
    p_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_idempotency_id uuid;
    v_existing app.request_idempotency%rowtype;
    v_payment_link_id uuid;
    v_public_token text;
    v_amount bigint;
    v_expiration integer;
    v_description text;
    v_projection jsonb;
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'admin');

    if p_environment is distinct from 'sandbox' then
        return pg_catalog.jsonb_build_object('kind', 'forbidden');
    end if;

    if p_idempotency_key is null
       or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
       or pg_catalog.length(p_idempotency_key) < 1
       or pg_catalog.length(p_idempotency_key) > 160
       or p_request_hash is null
       or p_request_hash !~ '^[0-9a-f]{64}$' then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;

    if p_command is null
       or pg_catalog.jsonb_typeof(p_command) <> 'object'
       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command)) not in (4, 5)
       or not (p_command ? 'amount')
       or not (p_command ? 'currency')
       or not (p_command ? 'description')
       or not (p_command ? 'pixExpirationMinutes')
       or p_command ->> 'currency' is distinct from 'BRL' then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;

    begin
        v_amount := (p_command ->> 'amount')::bigint;
        v_expiration := (p_command ->> 'pixExpirationMinutes')::integer;
    exception when others then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end;

    if v_amount < 1 or v_amount > 9007199254740991
       or v_expiration < 5 or v_expiration > 1440 then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;

    if p_command -> 'description' <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(p_command -> 'description') <> 'string' then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;
    v_description := p_command ->> 'description';

    if p_command ? 'publicToken' then
        v_public_token := p_command ->> 'publicToken';
        if v_public_token is null or v_public_token !~ '^plink_sandbox_[A-Za-z0-9_-]{32}$' then
            return pg_catalog.jsonb_build_object('kind', 'validation_error');
        end if;
    end if;

    insert into app.request_idempotency(
        merchant_id, environment, operation, idempotency_key, request_hash, state
    ) values (
        p_merchant_id, 'sandbox', 'dashboard_payment_link_create', p_idempotency_key, p_request_hash, 'in_progress'
    )
    on conflict (merchant_id, environment, operation, idempotency_key) do nothing
    returning id into v_idempotency_id;

    if v_idempotency_id is null then
        select ri.* into v_existing
        from app.request_idempotency ri
        where ri.merchant_id = p_merchant_id
          and ri.environment = 'sandbox'
          and ri.operation = 'dashboard_payment_link_create'
          and ri.idempotency_key = p_idempotency_key
        for update;

        if not found then
            raise exception using errcode = '55000', message = 'A23 payment-link idempotency state disappeared';
        end if;
        if v_existing.request_hash <> p_request_hash then
            return pg_catalog.jsonb_build_object('kind', 'idempotency_conflict');
        end if;
        if v_existing.state = 'completed' then
            if v_existing.response_snapshot is null then
                raise exception using errcode = '55000', message = 'A23 completed payment-link snapshot is missing';
            end if;
            return pg_catalog.jsonb_build_object(
                'kind', 'created',
                'replayed', true,
                'paymentLink', v_existing.response_snapshot
            );
        end if;
        if v_existing.state <> 'in_progress' then
            return pg_catalog.jsonb_build_object('kind', 'idempotency_conflict');
        end if;
        v_idempotency_id := v_existing.id;

        if v_existing.resource_id is not null then
            v_projection := app._a23_dashboard_payment_link_json(v_existing.resource_id);
            if v_projection is null then
                raise exception using errcode = '55000', message = 'A23 payment-link resource link is invalid';
            end if;
            update app.request_idempotency
            set state = 'completed', http_status_snapshot = 201,
                response_snapshot = v_projection, completed_at = pg_catalog.clock_timestamp()
            where id = v_existing.id;
            return pg_catalog.jsonb_build_object('kind', 'created', 'replayed', true, 'paymentLink', v_projection);
        end if;
    end if;

    -- A completed replay returns above before a new CSPRNG token is requested.
    if v_public_token is null then
        return pg_catalog.jsonb_build_object('kind', 'token_required');
    end if;

    v_payment_link_id := pg_catalog.gen_random_uuid();
    begin
        insert into app.payment_links(
            id, merchant_id, environment, public_token, status,
            amount_cents, currency, description, pix_expiration_minutes
        ) values (
            v_payment_link_id, p_merchant_id, 'sandbox', v_public_token, 'active',
            v_amount, 'BRL', v_description, v_expiration
        );
    exception when unique_violation then
        return pg_catalog.jsonb_build_object('kind', 'token_collision');
    end;

    v_projection := app._a23_dashboard_payment_link_json(v_payment_link_id);

    update app.request_idempotency
    set resource_type = 'payment_link', resource_id = v_payment_link_id,
        state = 'completed', http_status_snapshot = 201,
        response_snapshot = v_projection, completed_at = pg_catalog.clock_timestamp()
    where id = v_idempotency_id;

    return pg_catalog.jsonb_build_object(
        'kind', 'created',
        'replayed', false,
        'paymentLink', v_projection
    );
end;
$$;

revoke all on function app.create_dashboard_payment_link(uuid, uuid, text, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
grant execute on function app.create_dashboard_payment_link(uuid, uuid, text, text, text, jsonb)
    to swiftpay_api;

create or replace function app._a23_resolve_payment_link_pix_attempt(
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
    v_link_id uuid;
    v_idempotency_id uuid;
    v_payment jsonb;
begin
    if p_environment is distinct from 'sandbox'
       or p_resolution is null
       or pg_catalog.jsonb_typeof(p_resolution) <> 'object' then
        raise exception using errcode = '22023', message = 'A23 checkout resolution is invalid';
    end if;

    select p.source_resource_id into v_link_id
    from app.payments p
    where p.id = p_payment_id
      and p.merchant_id = p_merchant_id
      and p.environment = 'sandbox'
      and p.source = 'payment_link';
    if not found or v_link_id is null then
        raise exception using errcode = '55000', message = 'A23 checkout Payment scope is invalid';
    end if;

    perform 1
    from app.provider_attempts pa
    where pa.id = p_provider_attempt_id
      and pa.payment_id = p_payment_id
      and pa.state = 'executing'
      and pa.execution_token = p_execution_token
    for update;
    if not found then
        raise exception using errcode = '55000', message = 'A23 checkout resolution does not own execution';
    end if;

    select ri.id into v_idempotency_id
    from app.request_idempotency ri
    where ri.merchant_id = p_merchant_id
      and ri.environment = 'sandbox'
      and ri.operation = 'payment_link_create_payment:' || v_link_id::text
      and ri.resource_type = 'payment'
      and ri.resource_id = p_payment_id
      and ri.state = 'in_progress'
    for update;
    if not found then
        raise exception using errcode = '55000', message = 'A23 checkout idempotency link is invalid';
    end if;

    v_certainty := p_resolution ->> 'certainty';

    if v_certainty = 'success' then
        if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_resolution)) <> 6
           or pg_catalog.coalesce(p_resolution ->> 'providerPaymentId', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'txId', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'copyAndPaste', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'qrCode', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'expiresAt', '') = '' then
            raise exception using errcode = '22023', message = 'A23 checkout success resolution is invalid';
        end if;

        update app.provider_attempts
        set state = 'succeeded',
            provider_payment_id = p_resolution ->> 'providerPaymentId',
            provider_txid = p_resolution ->> 'txId',
            provider_status_raw = 'emulator_pending',
            pix_copy_paste = p_resolution ->> 'copyAndPaste',
            pix_qr_reference = p_resolution ->> 'qrCode',
            execution_token = null,
            lease_expires_at = null,
            finished_at = v_now,
            last_error_class = null,
            last_error_code = null,
            updated_at = v_now
        where id = p_provider_attempt_id;

        update app.payments
        set collection_status = 'pending', updated_at = v_now
        where id = p_payment_id;

        v_payment := app._a2_public_payment_json(p_payment_id);
        update app.request_idempotency
        set state = 'completed', http_status_snapshot = 201,
            response_snapshot = v_payment, completed_at = v_now
        where id = v_idempotency_id;
        return v_payment;
    end if;

    if v_certainty = 'execution_unknown' then
        if p_resolution ->> 'errorClass' is distinct from 'execution_unknown' then
            raise exception using errcode = '22023', message = 'A23 execution-unknown resolution is invalid';
        end if;
        update app.provider_attempts
        set state = 'execution_unknown', execution_token = null, lease_expires_at = null,
            recovery_required_at = v_now, last_error_class = 'execution_unknown',
            last_error_code = null, updated_at = v_now
        where id = p_provider_attempt_id;
        return app._a2_public_payment_json(p_payment_id);
    end if;

    if v_certainty = 'definitive_rejection' then
        if p_resolution ->> 'errorClass' is distinct from 'definitive_rejection'
           or pg_catalog.coalesce(p_resolution ->> 'errorCode', '') = '' then
            raise exception using errcode = '22023', message = 'A23 definitive rejection resolution is invalid';
        end if;
        update app.provider_attempts
        set state = 'definitively_failed', execution_token = null, lease_expires_at = null,
            finished_at = v_now, last_error_class = 'definitive_rejection',
            last_error_code = p_resolution ->> 'errorCode', updated_at = v_now
        where id = p_provider_attempt_id;
        update app.payments
        set collection_status = 'failed', updated_at = v_now
        where id = p_payment_id;
        v_payment := app._a2_public_payment_json(p_payment_id);
        update app.request_idempotency
        set state = 'completed', http_status_snapshot = 201,
            response_snapshot = v_payment, completed_at = v_now
        where id = v_idempotency_id;
        return v_payment;
    end if;

    raise exception using errcode = '22023', message = 'A23 checkout resolution certainty is invalid';
end;
$$;

revoke all on function app._a23_resolve_payment_link_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
