-- SwiftPay V2 A3: paid transition, ledger and merchant balance behavior.
--
-- Replaces the fail-closed A3 stubs with the smallest behavior frozen by
-- paid-transition-ledger-balance-v0. The merchant API remains read-only for
-- balances; only swiftpay_worker can submit sandbox simulator paid evidence.

-- A paid Payment must preserve the normalized Pix charge data created by A2.
-- No provider internals, provider cost or settlement policy are exposed.
create or replace function app._a2_public_payment_json(p_payment_id uuid)
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
            when p.collection_status in ('pending', 'paid') then (
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

create or replace function app.get_api_balance(
    p_merchant_id uuid,
    p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_pending bigint := 0;
    v_available bigint := 0;
    v_reserved bigint := 0;
    v_blocked_payouts bigint := 0;
    v_blocked_refunds bigint := 0;
    v_blocked bigint := 0;
    v_total bigint := 0;
begin
    if p_merchant_id is null
       or p_environment not in ('sandbox', 'production') then
        raise exception using
            errcode = '22023',
            message = 'A3 balance scope is invalid';
    end if;

    if not exists (
        select 1
        from app.merchants m
        where m.id = p_merchant_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'A3 balance merchant scope is invalid';
    end if;

    select
        coalesce(pg_catalog.sum(a.balance_cents) filter (
            where a.account_type = 'merchant_pending_liability'
        ), 0)::bigint,
        coalesce(pg_catalog.sum(a.balance_cents) filter (
            where a.account_type = 'merchant_available_liability'
        ), 0)::bigint,
        coalesce(pg_catalog.sum(a.balance_cents) filter (
            where a.account_type = 'merchant_risk_reserved_liability'
        ), 0)::bigint,
        coalesce(pg_catalog.sum(a.balance_cents) filter (
            where a.account_type = 'merchant_payout_blocked_liability'
        ), 0)::bigint,
        coalesce(pg_catalog.sum(a.balance_cents) filter (
            where a.account_type = 'merchant_refund_blocked_liability'
        ), 0)::bigint
    into
        v_pending,
        v_available,
        v_reserved,
        v_blocked_payouts,
        v_blocked_refunds
    from app.accounts a
    where a.merchant_id = p_merchant_id
      and a.provider_account_id is null
      and a.environment = p_environment
      and a.currency = 'BRL';

    if v_pending < 0
       or v_available < 0
       or v_reserved < 0
       or v_blocked_payouts < 0
       or v_blocked_refunds < 0 then
        raise exception using
            errcode = '55000',
            message = 'A3 merchant balance invariant is violated';
    end if;

    v_blocked := v_blocked_payouts + v_blocked_refunds;
    v_total := v_pending + v_available + v_reserved + v_blocked;

    return pg_catalog.jsonb_build_object(
        'currency', 'BRL',
        'environment', p_environment,
        'pendingSettlement', v_pending,
        'available', v_available,
        'reserved', v_reserved,
        'blockedPayouts', v_blocked_payouts,
        'blockedRefunds', v_blocked_refunds,
        'blocked', v_blocked,
        'withdrawable', v_available,
        'totalMerchantFunds', v_total
    );
end;
$$;

create or replace function app.apply_sandbox_pix_paid(
    p_payment_id uuid,
    p_simulation_source_id uuid,
    p_amount_cents bigint,
    p_provider_cost_cents bigint,
    p_payload_hash text,
    p_occurred_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_payment app.payments%rowtype;
    v_attempt_id uuid;
    v_provider_id uuid;
    v_provider_account_id uuid;
    v_provider_payment_id text;
    v_event_id uuid;
    v_existing_event app.provider_events%rowtype;
    v_event_identity text;
    v_event_state text;
    v_provider_net bigint;
    v_provider_asset_id uuid;
    v_provider_fee_expense_id uuid;
    v_merchant_pending_id uuid;
    v_payment_fee_revenue_id uuid;
    v_entries jsonb := '[]'::jsonb;
    v_ledger_id uuid;
    v_webhook_id uuid;
    v_payment_json jsonb;
    v_existing_ledger_id uuid;
    v_existing_webhook_id uuid;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    if p_payment_id is null
       or p_simulation_source_id is null
       or p_payload_hash is null
       or p_payload_hash !~ '^[0-9a-f]{64}$'
       or p_occurred_at is null then
        raise exception using
            errcode = '22023',
            message = 'A3 simulator paid evidence identity is invalid';
    end if;

    -- The Payment row is the serialization point for every paid transition.
    select p.*
    into v_payment
    from app.payments p
    where p.id = p_payment_id
    for update;

    if not found then
        return pg_catalog.jsonb_build_object(
            'kind', 'rejected',
            'payment', null,
            'providerEventId', null,
            'ledgerTransactionId', null,
            'webhookEventId', null
        );
    end if;

    -- A3 is intentionally limited to the deterministic A2 sandbox emulator.
    if v_payment.environment is distinct from 'sandbox'
       or v_payment.currency is distinct from 'BRL'
       or v_payment.routing_policy_version is distinct from 'sandbox-emulator-v0'
       or v_payment.settlement_policy_version is distinct from 'sandbox-pending-settlement-v0' then
        return pg_catalog.jsonb_build_object(
            'kind', 'rejected',
            'payment', app._a2_public_payment_json(v_payment.id),
            'providerEventId', null,
            'ledgerTransactionId', null,
            'webhookEventId', null
        );
    end if;

    select
        pa.id,
        pa.provider_id,
        pa.provider_account_id,
        pa.provider_payment_id
    into
        v_attempt_id,
        v_provider_id,
        v_provider_account_id,
        v_provider_payment_id
    from app.provider_attempts pa
    join app.providers pr
      on pr.id = pa.provider_id
    join app.provider_accounts pacc
      on pacc.id = pa.provider_account_id
    where pa.payment_id = v_payment.id
      and pa.operation = 'create_pix_charge'
      and pa.state = 'succeeded'
      and pa.provider_payment_id is not null
      and pg_catalog.length(pg_catalog.btrim(pa.provider_payment_id)) > 0
      and pr.code = 'swiftpay_emulator'
      and pr.status = 'active'
      and pacc.environment = 'sandbox'
      and pacc.status = 'active'
      and pacc.merchant_id is null
      and pacc.provider_id = pr.id
    order by pa.attempt_number desc
    limit 1
    for update of pa;

    if not found then
        return pg_catalog.jsonb_build_object(
            'kind', 'rejected',
            'payment', app._a2_public_payment_json(v_payment.id),
            'providerEventId', null,
            'ledgerTransactionId', null,
            'webhookEventId', null
        );
    end if;

    v_event_identity := 'swiftpay-sandbox-sim:' || p_simulation_source_id::text;

    insert into app.provider_events (
        provider_id,
        provider_account_id,
        environment,
        provider_event_id,
        fingerprint,
        resource_type,
        provider_resource_id,
        event_type,
        payload_hash,
        raw_evidence_ref,
        state
    ) values (
        v_provider_id,
        v_provider_account_id,
        'sandbox',
        v_event_identity,
        v_event_identity,
        'pix_charge',
        v_provider_payment_id,
        'pix_paid',
        p_payload_hash,
        null,
        'received'
    )
    on conflict do nothing
    returning id into v_event_id;

    if v_event_id is null then
        select pe.*
        into strict v_existing_event
        from app.provider_events pe
        where pe.provider_account_id = v_provider_account_id
          and pe.environment = 'sandbox'
          and pe.fingerprint = v_event_identity
        for update;

        if v_existing_event.provider_id is distinct from v_provider_id
           or v_existing_event.provider_event_id is distinct from v_event_identity
           or v_existing_event.resource_type is distinct from 'pix_charge'
           or v_existing_event.provider_resource_id is distinct from v_provider_payment_id
           or v_existing_event.event_type is distinct from 'pix_paid'
           or v_existing_event.payload_hash is distinct from p_payload_hash
           or v_existing_event.raw_evidence_ref is not null then
            raise exception using
                errcode = '23505',
                message = 'A3 simulator source identity reused with different evidence';
        end if;

        if v_existing_event.state in ('applied', 'absorbed') then
            select lt.id
            into v_existing_ledger_id
            from app.ledger_transactions lt
            where lt.environment = 'sandbox'
              and lt.source_type = 'payment'
              and lt.source_id = v_payment.id
              and lt.posting_type = 'settlement_paid';

            select we.id
            into v_existing_webhook_id
            from app.webhook_events we
            where we.merchant_id = v_payment.merchant_id
              and we.environment = 'sandbox'
              and we.source_type = 'payment'
              and we.source_id = v_payment.id
              and we.type = 'payment.paid';

            return pg_catalog.jsonb_build_object(
                'kind', 'absorbed',
                'payment', app._a2_public_payment_json(v_payment.id),
                'providerEventId', v_existing_event.id::text,
                'ledgerTransactionId', case when v_existing_ledger_id is null then null else v_existing_ledger_id::text end,
                'webhookEventId', case when v_existing_webhook_id is null then null else v_existing_webhook_id::text end
            );
        end if;

        if v_existing_event.state = 'rejected' then
            return pg_catalog.jsonb_build_object(
                'kind', 'rejected',
                'payment', app._a2_public_payment_json(v_payment.id),
                'providerEventId', v_existing_event.id::text,
                'ledgerTransactionId', null,
                'webhookEventId', null
            );
        end if;

        -- A committed received state is not expected because the composed
        -- operation is transactional. Fail closed instead of risking replay.
        raise exception using
            errcode = '55000',
            message = 'A3 simulator evidence is in an unresolved received state';
    end if;

    -- Evidence that is well-shaped enough to identify durably but cannot be
    -- financially applied is retained as rejected evidence with zero monetary
    -- side effects.
    if p_amount_cents is null
       or p_amount_cents < 1
       or p_amount_cents > 9007199254740991
       or p_amount_cents is distinct from v_payment.amount_cents
       or p_provider_cost_cents is null
       or p_provider_cost_cents < 0
       or p_provider_cost_cents > v_payment.amount_cents
       or v_payment.merchant_fee_cents < 0
       or v_payment.merchant_net_cents < 0
       or v_payment.merchant_fee_cents + v_payment.merchant_net_cents <> v_payment.amount_cents
       or (v_payment.provider_cost_cents is not null
           and v_payment.provider_cost_cents is distinct from p_provider_cost_cents)
       or v_payment.collection_status not in ('pending', 'expired', 'paid') then
        update app.provider_events
           set state = 'rejected',
               applied_at = v_now
         where id = v_event_id;

        return pg_catalog.jsonb_build_object(
            'kind', 'rejected',
            'payment', app._a2_public_payment_json(v_payment.id),
            'providerEventId', v_event_id::text,
            'ledgerTransactionId', null,
            'webhookEventId', null
        );
    end if;

    -- A distinct but consistent paid observation after the canonical transition
    -- remains durable evidence, but it cannot post money or emit paid again.
    if v_payment.collection_status = 'paid' then
        update app.provider_events
           set state = 'absorbed',
               applied_at = v_now
         where id = v_event_id;

        select lt.id
        into v_existing_ledger_id
        from app.ledger_transactions lt
        where lt.environment = 'sandbox'
          and lt.source_type = 'payment'
          and lt.source_id = v_payment.id
          and lt.posting_type = 'settlement_paid';

        select we.id
        into v_existing_webhook_id
        from app.webhook_events we
        where we.merchant_id = v_payment.merchant_id
          and we.environment = 'sandbox'
          and we.source_type = 'payment'
          and we.source_id = v_payment.id
          and we.type = 'payment.paid';

        return pg_catalog.jsonb_build_object(
            'kind', 'absorbed',
            'payment', app._a2_public_payment_json(v_payment.id),
            'providerEventId', v_event_id::text,
            'ledgerTransactionId', case when v_existing_ledger_id is null then null else v_existing_ledger_id::text end,
            'webhookEventId', case when v_existing_webhook_id is null then null else v_existing_webhook_id::text end
        );
    end if;

    v_provider_net := v_payment.amount_cents - p_provider_cost_cents;

    if v_provider_net > 0 then
        v_provider_asset_id := app.ensure_account(
            null,
            v_provider_account_id,
            'sandbox',
            'BRL',
            'provider_settlement_asset'
        );
        v_entries := v_entries || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'account_id', v_provider_asset_id::text,
                'direction', 'debit',
                'amount_cents', v_provider_net
            )
        );
    end if;

    if p_provider_cost_cents > 0 then
        v_provider_fee_expense_id := app.ensure_account(
            null,
            null,
            'sandbox',
            'BRL',
            'provider_payment_fee_expense'
        );
        v_entries := v_entries || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'account_id', v_provider_fee_expense_id::text,
                'direction', 'debit',
                'amount_cents', p_provider_cost_cents
            )
        );
    end if;

    if v_payment.merchant_net_cents > 0 then
        v_merchant_pending_id := app.ensure_account(
            v_payment.merchant_id,
            null,
            'sandbox',
            'BRL',
            'merchant_pending_liability'
        );
        v_entries := v_entries || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'account_id', v_merchant_pending_id::text,
                'direction', 'credit',
                'amount_cents', v_payment.merchant_net_cents
            )
        );
    end if;

    if v_payment.merchant_fee_cents > 0 then
        v_payment_fee_revenue_id := app.ensure_account(
            null,
            null,
            'sandbox',
            'BRL',
            'payment_fee_revenue'
        );
        v_entries := v_entries || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'account_id', v_payment_fee_revenue_id::text,
                'direction', 'credit',
                'amount_cents', v_payment.merchant_fee_cents
            )
        );
    end if;

    -- post_ledger_transaction validates positive entries, equality of debits and
    -- credits, environment/currency scope, account locks and cached balances.
    v_ledger_id := app.post_ledger_transaction(
        'sandbox',
        'payment',
        v_payment.id,
        'settlement_paid',
        v_entries
    );

    update app.payments
       set collection_status = 'paid',
           provider_cost_cents = p_provider_cost_cents,
           paid_at = p_occurred_at,
           updated_at = v_now
     where id = v_payment.id;

    v_payment_json := app._a2_public_payment_json(v_payment.id);

    -- This is an outbox write only. HTTP signing/delivery is intentionally A4.
    v_webhook_id := app.record_webhook_event(
        v_payment.merchant_id,
        'sandbox',
        'payment.paid',
        'payment',
        v_payment.id,
        'payment',
        v_payment.id,
        'payment-v1',
        v_payment_json,
        p_occurred_at
    );

    update app.provider_events
       set state = 'applied',
           applied_at = v_now
     where id = v_event_id;

    return pg_catalog.jsonb_build_object(
        'kind', 'applied',
        'payment', v_payment_json,
        'providerEventId', v_event_id::text,
        'ledgerTransactionId', v_ledger_id::text,
        'webhookEventId', v_webhook_id::text
    );
end;
$$;

-- Reassert the exact A3 least-privilege surface after replacing the stubs.
revoke all on function app.apply_sandbox_pix_paid(uuid, uuid, bigint, bigint, text, timestamptz)
    from public, anon, authenticated, service_role, swiftpay_api;
grant execute on function app.apply_sandbox_pix_paid(uuid, uuid, bigint, bigint, text, timestamptz)
    to swiftpay_worker;

revoke all on function app.get_api_balance(uuid, text)
    from public, anon, authenticated, service_role, swiftpay_worker;
grant execute on function app.get_api_balance(uuid, text)
    to swiftpay_api;
