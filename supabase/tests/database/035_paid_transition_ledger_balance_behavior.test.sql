create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(40);

grant swiftpay_api to postgres with inherit false;
grant swiftpay_worker to postgres with inherit false;

insert into app.merchants (id, name, lifecycle_status) values
  ('90000000-0000-0000-0000-000000000001'::uuid, 'A3 Active Merchant', 'active'),
  ('90000000-0000-0000-0000-000000000002'::uuid, 'A3 Other Merchant', 'active');

insert into app.providers (id, code, name, status) values
  ('91000000-0000-0000-0000-000000000001'::uuid, 'swiftpay_emulator', 'A3 SwiftPay Emulator', 'active');

insert into app.provider_accounts (
  id, provider_id, merchant_id, name, environment, status,
  credentials_ciphertext, capabilities, configuration
) values (
  '92000000-0000-0000-0000-000000000001'::uuid,
  '91000000-0000-0000-0000-000000000001'::uuid,
  null,
  'A3 Platform Sandbox Emulator',
  'sandbox',
  'active',
  '{}'::jsonb,
  '{"create_pix_charge":true}'::jsonb,
  '{"emulator":true}'::jsonb
);

insert into app.webhook_endpoints (
  id, merchant_id, environment, url, status, secret_ciphertext,
  secret_version, subscribed_events
) values (
  '93000000-0000-0000-0000-000000000001'::uuid,
  '90000000-0000-0000-0000-000000000001'::uuid,
  'sandbox',
  'https://merchant.example.test/swiftpay',
  'active',
  'test-only-encrypted-secret',
  1,
  '["payment.paid"]'::jsonb
);

create temporary table a3_payments (
  case_name text primary key,
  payment_id uuid not null,
  attempt_id uuid not null
);

create temporary table a3_results (
  case_name text primary key,
  result jsonb,
  error_state text,
  error_message text
);

create procedure pg_temp.a3_create_pending(
  p_case_name text,
  p_idempotency_key text,
  p_hash_char text,
  p_amount bigint
)
language plpgsql
security invoker
as $$
declare
  v_prepare jsonb;
  v_claim jsonb;
  v_payment_id uuid;
  v_attempt_id uuid;
  v_token uuid;
  v_expires_at text;
begin
  execute 'set local role swiftpay_api';
  select app.prepare_api_pix_payment(
    '90000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    p_idempotency_key,
    repeat(p_hash_char, 64),
    jsonb_build_object(
      'method', 'pix',
      'amount', p_amount,
      'currency', 'BRL',
      'externalId', p_case_name,
      'description', 'A3 paid transition fixture',
      'pixExpirationMinutes', 60
    ),
    jsonb_build_object(
      'pricingVersion', 'sandbox-zero-fee-v0',
      'feeMode', 'fixed',
      'feeFixedCents', 0,
      'feeBasisPoints', 0,
      'feePercentageComponentCents', 0,
      'merchantFeeCents', 0,
      'merchantNetCents', p_amount,
      'roundingPolicyVersion', 'ceil-bp-v1',
      'refundFeePolicy', 'merchant_fee_non_refundable'
    ),
    'sandbox-emulator-v0'
  ) into v_prepare;

  v_payment_id := (v_prepare -> 'payment' ->> 'id')::uuid;
  v_attempt_id := (v_prepare -> 'providerAttempt' ->> 'id')::uuid;
  v_expires_at := v_prepare -> 'providerAttempt' ->> 'expiresAt';

  select app.claim_api_pix_attempt(
    '90000000-0000-0000-0000-000000000001'::uuid,
    'sandbox', v_payment_id, v_attempt_id
  ) into v_claim;
  v_token := (v_claim ->> 'executionToken')::uuid;

  perform app.resolve_api_pix_attempt(
    '90000000-0000-0000-0000-000000000001'::uuid,
    'sandbox', v_payment_id, v_attempt_id, v_token,
    jsonb_build_object(
      'certainty', 'success',
      'providerPaymentId', 'swiftpay-emulator-payment:' || v_attempt_id::text,
      'txId', 'swiftpay-emulator-tx:' || v_attempt_id::text,
      'copyAndPaste', 'SWIFTPAY_EMULATOR_COPY_' || v_attempt_id::text,
      'qrCode', 'SWIFTPAY_EMULATOR_QR_' || v_attempt_id::text,
      'expiresAt', v_expires_at
    )
  );
  execute 'reset role';

  insert into pg_temp.a3_payments values (p_case_name, v_payment_id, v_attempt_id);
exception when others then
  execute 'reset role';
  raise;
end;
$$;

create procedure pg_temp.a3_capture_paid(
  p_case_name text,
  p_payment_case text,
  p_source_id uuid,
  p_amount bigint,
  p_provider_cost bigint,
  p_payload_hash text,
  p_occurred_at timestamptz
)
language plpgsql
security invoker
as $$
declare
  v_payment_id uuid;
  v_result jsonb;
  v_error_state text;
  v_error_message text;
begin
  select payment_id into v_payment_id
  from pg_temp.a3_payments where case_name = p_payment_case;

  execute 'set local role swiftpay_worker';
  begin
    select app.apply_sandbox_pix_paid(
      v_payment_id,
      p_source_id,
      p_amount,
      p_provider_cost,
      p_payload_hash,
      p_occurred_at
    ) into v_result;
  exception when others then
    get stacked diagnostics
      v_error_state = returned_sqlstate,
      v_error_message = message_text;
  end;
  execute 'reset role';

  insert into pg_temp.a3_results values
    (p_case_name, v_result, v_error_state, v_error_message);
end;
$$;

create procedure pg_temp.a3_capture_balance(
  p_case_name text,
  p_merchant_id uuid,
  p_environment text
)
language plpgsql
security invoker
as $$
declare
  v_result jsonb;
  v_error_state text;
  v_error_message text;
begin
  execute 'set local role swiftpay_api';
  begin
    select app.get_api_balance(p_merchant_id, p_environment) into v_result;
  exception when others then
    get stacked diagnostics
      v_error_state = returned_sqlstate,
      v_error_message = message_text;
  end;
  execute 'reset role';

  insert into pg_temp.a3_results values
    (p_case_name, v_result, v_error_state, v_error_message);
end;
$$;

-- First canonical A2 pending Payment used by A3.
call pg_temp.a3_create_pending('paid_main', 'idem-a3-paid-main', '1', 15000);

select is(
  (select collection_status from app.payments where id = (select payment_id from a3_payments where case_name='paid_main')),
  'pending',
  'A3 predecessor fixture starts as canonical pending Payment'
);
select is(
  (select to_jsonb(p) ->> 'settlement_policy_version'
     from app.payments p
    where id = (select payment_id from a3_payments where case_name='paid_main')),
  'sandbox-pending-settlement-v0',
  'A3 extends A2 create with immutable sandbox pending-settlement policy snapshot'
);
select is((select count(*) from app.ledger_transactions), 0::bigint,
  'A3 predecessor pending Payment has no ledger posting before paid evidence');

call pg_temp.a3_capture_paid(
  'paid_main_apply', 'paid_main',
  '94000000-0000-0000-0000-000000000001'::uuid,
  15000, 0, repeat('a',64), '2030-01-02T03:04:05Z'::timestamptz
);

select is((select error_state from a3_results where case_name='paid_main_apply'), null,
  'A3 first paid evidence completes without database error');
select is((select result ->> 'kind' from a3_results where case_name='paid_main_apply'), 'applied',
  'A3 first paid evidence reports applied');
select is(
  (select collection_status from app.payments where id = (select payment_id from a3_payments where case_name='paid_main')),
  'paid',
  'A3 first paid evidence transitions Payment pending to paid'
);
select is(
  (select paid_at from app.payments where id = (select payment_id from a3_payments where case_name='paid_main')),
  '2030-01-02T03:04:05Z'::timestamptz,
  'A3 first paid evidence preserves authoritative paid timestamp'
);
select is(
  (select provider_cost_cents from app.payments where id = (select payment_id from a3_payments where case_name='paid_main')),
  0::bigint,
  'A3 paid evidence snapshots authoritative zero emulator provider cost'
);
select is((select count(*) from app.provider_events), 1::bigint,
  'A3 first paid evidence persists one ProviderEvent');
select is(
  (select state || '|' || event_type || '|' || provider_event_id || '|' || payload_hash
     from app.provider_events limit 1),
  'applied|pix_paid|swiftpay-sandbox-sim:94000000-0000-0000-0000-000000000001|' || repeat('a',64),
  'A3 ProviderEvent preserves stable simulator identity hash and applied state'
);
select is((select count(*) from app.ledger_transactions), 1::bigint,
  'A3 first paid evidence posts one ledger transaction');
select is(
  (select source_type || '|' || source_id::text || '|' || posting_type
     from app.ledger_transactions limit 1),
  'payment|' || (select payment_id::text from a3_payments where case_name='paid_main') || '|settlement_paid',
  'A3 ledger posting uses stable payment settlement source identity'
);
select is((select count(*) from app.ledger_entries), 2::bigint,
  'A3 zero-fee zero-cost emulator settlement creates exactly two positive ledger entries');
select is(
  (select coalesce(sum(case when direction='debit' then amount_cents else 0 end),0)::text || '|' ||
          coalesce(sum(case when direction='credit' then amount_cents else 0 end),0)::text
     from app.ledger_entries),
  '15000|15000',
  'A3 paid settlement is balanced at gross amount'
);
select is(
  (select balance_cents from app.accounts
    where provider_account_id='92000000-0000-0000-0000-000000000001'::uuid
      and environment='sandbox' and account_type='provider_settlement_asset'),
  15000::bigint,
  'A3 provider settlement asset debits gross when emulator provider cost is zero'
);
select is(
  (select balance_cents from app.accounts
    where merchant_id='90000000-0000-0000-0000-000000000001'::uuid
      and environment='sandbox' and account_type='merchant_pending_liability'),
  15000::bigint,
  'A3 merchant pending liability credits merchant net amount'
);
select is(
  coalesce((select balance_cents from app.accounts
    where merchant_id='90000000-0000-0000-0000-000000000001'::uuid
      and environment='sandbox' and account_type='merchant_available_liability'),0),
  0::bigint,
  'A3 settlement_paid does not fabricate available balance'
);

select is((select count(*) from app.webhook_events), 1::bigint,
  'A3 first paid transition creates one logical merchant webhook event');
select ok(
  (select type='payment.paid'
      and source_type='payment'
      and source_id=(select payment_id from a3_payments where case_name='paid_main')
      and payload_version='payment-v1'
      and payload_snapshot ->> 'status' = 'paid'
      and payload_snapshot -> 'pix' is not null
      and not (payload_snapshot ? 'providerCostCents')
      and not (payload_snapshot ? 'providerAccountId')
     from app.webhook_events limit 1),
  'A3 payment.paid outbox snapshots public paid Payment with Pix data and no provider internals'
);
select is((select count(*) from app.webhook_deliveries), 1::bigint,
  'A3 payment.paid event fans out one pending delivery to subscribed endpoint');
select is((select count(*) from app.jobs where kind='merchant_webhook_delivery'), 1::bigint,
  'A3 payment.paid fanout durably enqueues one merchant webhook delivery job');

call pg_temp.a3_capture_balance(
  'balance_after_paid', '90000000-0000-0000-0000-000000000001'::uuid, 'sandbox'
);
select is((select error_state from a3_results where case_name='balance_after_paid'), null,
  'A3 merchant balance read completes without database error');
select is(
  (select (result->>'pendingSettlement') || '|' || (result->>'available') || '|' ||
          (result->>'reserved') || '|' || (result->>'blocked') || '|' ||
          (result->>'withdrawable') || '|' || (result->>'totalMerchantFunds')
     from a3_results where case_name='balance_after_paid'),
  '15000|0|0|0|0|15000',
  'A3 balance keeps pending settlement distinct from available and withdrawable'
);

-- Same source replay is absorbed.
call pg_temp.a3_capture_paid(
  'paid_main_replay', 'paid_main',
  '94000000-0000-0000-0000-000000000001'::uuid,
  15000, 0, repeat('a',64), '2030-01-02T03:04:05Z'::timestamptz
);
select is((select error_state from a3_results where case_name='paid_main_replay'), null,
  'A3 same-source paid replay completes without database error');
select is((select result ->> 'kind' from a3_results where case_name='paid_main_replay'), 'absorbed',
  'A3 same-source paid replay is absorbed');
select is(
  (select count(*)::text || '|' ||
          (select count(*) from app.ledger_transactions)::text || '|' ||
          (select count(*) from app.webhook_events)::text || '|' ||
          (select count(*) from app.webhook_deliveries)::text
     from app.provider_events),
  '1|1|1|1',
  'A3 same-source replay creates no duplicate event posting or merchant delivery'
);

-- Distinct consistent paid evidence after Payment is already paid is persisted/absorbed.
call pg_temp.a3_capture_paid(
  'paid_main_distinct', 'paid_main',
  '94000000-0000-0000-0000-000000000002'::uuid,
  15000, 0, repeat('b',64), '2030-01-02T03:04:06Z'::timestamptz
);
select is((select error_state from a3_results where case_name='paid_main_distinct'), null,
  'A3 distinct consistent paid evidence after paid completes without DB error');
select is((select result ->> 'kind' from a3_results where case_name='paid_main_distinct'), 'absorbed',
  'A3 distinct consistent paid evidence is absorbed after canonical paid transition');
select is((select count(*) from app.provider_events where state='absorbed'), 1::bigint,
  'A3 distinct post-paid evidence is retained as absorbed evidence');
select is(
  (select count(*)::text || '|' || (select count(*) from app.webhook_events)::text
     from app.ledger_transactions),
  '1|1',
  'A3 distinct post-paid evidence cannot double-credit or emit second payment.paid event'
);

-- Late paid after expired remains settling evidence, not a stale transition.
call pg_temp.a3_create_pending('paid_late', 'idem-a3-paid-late', '2', 7000);
update app.payments set collection_status='expired'
where id=(select payment_id from a3_payments where case_name='paid_late');
call pg_temp.a3_capture_paid(
  'paid_late_apply', 'paid_late',
  '94000000-0000-0000-0000-000000000003'::uuid,
  7000, 0, repeat('c',64), '2030-01-03T04:05:06Z'::timestamptz
);
select is((select error_state from a3_results where case_name='paid_late_apply'), null,
  'A3 late paid evidence after expired completes without database error');
select is(
  (select collection_status from app.payments where id=(select payment_id from a3_payments where case_name='paid_late')),
  'paid',
  'A3 authoritative late paid transitions expired Payment to paid'
);
select is((select count(*) from app.ledger_transactions), 2::bigint,
  'A3 late paid Payment receives exactly one additional settlement posting');

-- Invalid amount is rejected with no financial effect.
call pg_temp.a3_create_pending('bad_amount', 'idem-a3-bad-amount', '3', 9000);
call pg_temp.a3_capture_paid(
  'bad_amount_apply', 'bad_amount',
  '94000000-0000-0000-0000-000000000004'::uuid,
  8999, 0, repeat('d',64), '2030-01-04T05:06:07Z'::timestamptz
);
select is((select result ->> 'kind' from a3_results where case_name='bad_amount_apply'), 'rejected',
  'A3 mismatched paid amount is rejected');
select is(
  (select collection_status from app.payments where id=(select payment_id from a3_payments where case_name='bad_amount')),
  'pending',
  'A3 amount mismatch leaves Payment pending');
select is((select count(*) from app.ledger_transactions), 2::bigint,
  'A3 amount mismatch creates no ledger transaction');

-- Invalid provider cost is rejected.
call pg_temp.a3_create_pending('bad_cost', 'idem-a3-bad-cost', '4', 8000);
call pg_temp.a3_capture_paid(
  'bad_cost_apply', 'bad_cost',
  '94000000-0000-0000-0000-000000000005'::uuid,
  8000, 8001, repeat('e',64), '2030-01-05T06:07:08Z'::timestamptz
);
select is((select result ->> 'kind' from a3_results where case_name='bad_cost_apply'), 'rejected',
  'A3 provider cost greater than gross is rejected');
select is((select count(*) from app.ledger_transactions), 2::bigint,
  'A3 invalid provider cost creates no ledger transaction');

-- Unsupported failed -> paid is rejected in v0.
call pg_temp.a3_create_pending('failed_state', 'idem-a3-failed-state', '5', 6000);
update app.payments set collection_status='failed'
where id=(select payment_id from a3_payments where case_name='failed_state');
call pg_temp.a3_capture_paid(
  'failed_state_apply', 'failed_state',
  '94000000-0000-0000-0000-000000000006'::uuid,
  6000, 0, repeat('f',64), '2030-01-06T07:08:09Z'::timestamptz
);
select is((select result ->> 'kind' from a3_results where case_name='failed_state_apply'), 'rejected',
  'A3 failed -> paid simulator transition is rejected in v0');

-- Outbox conflict after posting must roll back entire composed statement.
call pg_temp.a3_create_pending('atomic_rollback', 'idem-a3-atomic-rollback', '6', 5000);
insert into app.webhook_events (
  id, merchant_id, environment, type, resource_type, resource_id,
  source_type, source_id, payload_version, payload_snapshot, occurred_at
) values (
  '95000000-0000-0000-0000-000000000001'::uuid,
  '90000000-0000-0000-0000-000000000001'::uuid,
  'sandbox', 'payment.paid', 'payment',
  (select payment_id from a3_payments where case_name='atomic_rollback'),
  'payment', (select payment_id from a3_payments where case_name='atomic_rollback'),
  'payment-v1', '{"status":"conflicting-preexisting-payload"}'::jsonb,
  '2030-01-07T08:09:10Z'::timestamptz
);
call pg_temp.a3_capture_paid(
  'atomic_rollback_apply', 'atomic_rollback',
  '94000000-0000-0000-0000-000000000007'::uuid,
  5000, 0, repeat('0',64), '2030-01-07T08:09:10Z'::timestamptz
);
select ok((select error_state is not null from a3_results where case_name='atomic_rollback_apply'),
  'A3 conflicting outbox snapshot fails the composed paid transition');
select is(
  (select collection_status from app.payments where id=(select payment_id from a3_payments where case_name='atomic_rollback')),
  'pending',
  'A3 outbox failure rolls Payment state back to pending');
select is(
  (select count(*) from app.ledger_transactions
    where source_type='payment'
      and source_id=(select payment_id from a3_payments where case_name='atomic_rollback')
      and posting_type='settlement_paid'),
  0::bigint,
  'A3 outbox failure rolls ledger posting back completely');
select is(
  (select count(*) from app.provider_events
    where provider_event_id='swiftpay-sandbox-sim:94000000-0000-0000-0000-000000000007'),
  0::bigint,
  'A3 outbox failure rolls ProviderEvent creation back completely');

select * from finish();
rollback;
