-- SwiftPay V2 A2: PostgreSQL compatibility fix for successful Pix resolution.
--
-- COALESCE is PostgreSQL expression syntax, not a pg_catalog function and cannot
-- be schema-qualified. Preserve all frozen A2 resolution behavior while using
-- the native expression form.

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
        if coalesce(p_resolution ->> 'providerPaymentId', '') = ''
           or coalesce(p_resolution ->> 'txId', '') = ''
           or coalesce(p_resolution ->> 'copyAndPaste', '') = ''
           or coalesce(p_resolution ->> 'qrCode', '') = ''
           or coalesce(p_resolution ->> 'expiresAt', '') = '' then
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

revoke all on function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
grant execute on function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    to swiftpay_api;
