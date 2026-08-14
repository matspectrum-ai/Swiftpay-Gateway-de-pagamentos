-- SwiftPay V2: atomic payout/refund reservation boundaries proven by pgTAP RED tests.

create or replace function app.reserve_payout(
    p_merchant_id uuid, p_environment text, p_currency text,
    p_amount_cents bigint, p_merchant_fee_cents bigint,
    p_destination_snapshot jsonb, p_idempotency_key text,
    p_request_fingerprint text, p_now timestamptz
) returns uuid
language plpgsql security definer set search_path=pg_catalog,app as $$
declare
    v_existing app.payouts%rowtype;
    v_payout_id uuid;
    v_available uuid;
    v_blocked uuid;
begin
    select * into v_existing from app.payouts
     where merchant_id=p_merchant_id and environment=p_environment and idempotency_key=p_idempotency_key;
    if found then
        if v_existing.request_fingerprint <> p_request_fingerprint then
            raise exception 'idempotency key reused with different payout request' using errcode='23505';
        end if;
        return v_existing.id;
    end if;

    if p_amount_cents <= 0 or p_merchant_fee_cents < 0 or p_merchant_fee_cents >= p_amount_cents then
        raise exception 'invalid payout economics' using errcode='23514';
    end if;

    v_available := app.ensure_account(p_merchant_id,null,p_environment,p_currency,'merchant_available_liability');
    v_blocked := app.ensure_account(p_merchant_id,null,p_environment,p_currency,'merchant_payout_blocked_liability');

    -- Serialize payout/refund reservations for this merchant available bucket.
    perform 1 from app.accounts where id=v_available for update;
    if (select balance_cents from app.accounts where id=v_available) < p_amount_cents then
        raise exception 'insufficient available balance for payout' using errcode='23514';
    end if;

    insert into app.payouts(merchant_id,environment,currency,amount_cents,merchant_fee_cents,
        recipient_amount_cents,state,destination_snapshot,idempotency_key,request_fingerprint,created_at,updated_at)
    values(p_merchant_id,p_environment,p_currency,p_amount_cents,p_merchant_fee_cents,
        p_amount_cents-p_merchant_fee_cents,'requested',p_destination_snapshot,p_idempotency_key,p_request_fingerprint,p_now,p_now)
    returning id into v_payout_id;

    perform app.post_ledger_transaction(p_environment,'payout',v_payout_id,'reservation',jsonb_build_array(
        jsonb_build_object('account_id',v_available,'direction','debit','amount_cents',p_amount_cents),
        jsonb_build_object('account_id',v_blocked,'direction','credit','amount_cents',p_amount_cents)
    ));
    return v_payout_id;
exception when unique_violation then
    select * into v_existing from app.payouts
     where merchant_id=p_merchant_id and environment=p_environment and idempotency_key=p_idempotency_key;
    if found and v_existing.request_fingerprint=p_request_fingerprint then return v_existing.id; end if;
    raise;
end; $$;

create or replace function app.reserve_refund(
    p_payment_id uuid, p_merchant_id uuid, p_environment text,
    p_amount_cents bigint, p_idempotency_key text,
    p_request_fingerprint text, p_now timestamptz
) returns uuid
language plpgsql security definer set search_path=pg_catalog,app as $$
declare
    v_existing app.refunds%rowtype;
    v_payment app.payments%rowtype;
    v_refund_id uuid;
    v_active bigint;
    v_completed bigint;
    v_available uuid;
    v_blocked uuid;
begin
    select * into v_existing from app.refunds
     where merchant_id=p_merchant_id and environment=p_environment and payment_id=p_payment_id and idempotency_key=p_idempotency_key;
    if found then
        if v_existing.request_fingerprint <> p_request_fingerprint then
            raise exception 'idempotency key reused with different refund request' using errcode='23505';
        end if;
        return v_existing.id;
    end if;

    if p_amount_cents <= 0 then raise exception 'refund amount must be positive' using errcode='23514'; end if;

    select * into v_payment from app.payments where id=p_payment_id for update;
    if not found or v_payment.merchant_id<>p_merchant_id or v_payment.environment<>p_environment or v_payment.collection_status<>'paid' then
        raise exception 'payment is not refundable in this merchant/environment' using errcode='23514';
    end if;

    select coalesce(sum(amount_cents),0) into v_completed from app.refunds
      where payment_id=p_payment_id and state='completed';
    select coalesce(sum(amount_cents),0) into v_active from app.refunds
      where payment_id=p_payment_id and state in ('requested','processing','execution_unknown');
    if v_completed + v_active + p_amount_cents > v_payment.amount_cents then
        raise exception 'refund exceeds refundable limit' using errcode='23514';
    end if;

    v_available := app.ensure_account(p_merchant_id,null,p_environment,'BRL','merchant_available_liability');
    v_blocked := app.ensure_account(p_merchant_id,null,p_environment,'BRL','merchant_refund_blocked_liability');
    perform 1 from app.accounts where id=v_available for update;
    if (select balance_cents from app.accounts where id=v_available) < p_amount_cents then
        raise exception 'insufficient available balance for refund funding' using errcode='23514';
    end if;

    insert into app.refunds(payment_id,merchant_id,environment,currency,amount_cents,state,idempotency_key,
        request_fingerprint,fee_policy_version,created_at,updated_at)
    values(p_payment_id,p_merchant_id,p_environment,'BRL',p_amount_cents,'requested',p_idempotency_key,
        p_request_fingerprint,'v1-foundation',p_now,p_now)
    returning id into v_refund_id;

    perform app.post_ledger_transaction(p_environment,'refund',v_refund_id,'reservation',jsonb_build_array(
        jsonb_build_object('account_id',v_available,'direction','debit','amount_cents',p_amount_cents),
        jsonb_build_object('account_id',v_blocked,'direction','credit','amount_cents',p_amount_cents)
    ));
    return v_refund_id;
exception when unique_violation then
    select * into v_existing from app.refunds
     where merchant_id=p_merchant_id and environment=p_environment and payment_id=p_payment_id and idempotency_key=p_idempotency_key;
    if found and v_existing.request_fingerprint=p_request_fingerprint then return v_existing.id; end if;
    raise;
end; $$;

revoke all on function app.reserve_payout(uuid,text,text,bigint,bigint,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.reserve_refund(uuid,uuid,text,bigint,text,text,timestamptz) from public,anon,authenticated,service_role;
