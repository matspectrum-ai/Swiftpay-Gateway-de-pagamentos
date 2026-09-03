-- SwiftPay V2 A27: repair A23 COALESCE special-form compatibility.
--
-- COALESCE is a SQL conditional expression, not an ordinary pg_catalog
-- function. Replace exactly the six invalid pg_catalog.coalesce(...) usages
-- in the payment-link resolver while preserving all A26/A23 semantics.

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
           or coalesce(p_resolution ->> 'providerPaymentId', '') = ''
           or coalesce(p_resolution ->> 'txId', '') = ''
           or coalesce(p_resolution ->> 'copyAndPaste', '') = ''
           or coalesce(p_resolution ->> 'qrCode', '') = ''
           or coalesce(p_resolution ->> 'expiresAt', '') = '' then
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
           or coalesce(p_resolution ->> 'errorCode', '') = '' then
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
