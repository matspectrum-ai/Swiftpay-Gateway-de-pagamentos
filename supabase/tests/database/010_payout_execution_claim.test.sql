create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(20);

insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000010001', 'Payout Execution Merchant', 'active');

insert into app.providers (id, code, name, status)
values ('00000000-0000-0000-0000-000000010100', 'payout-exec-provider', 'Payout Execution Provider', 'active');

insert into app.provider_accounts (
  id, provider_id, merchant_id, name, environment, status,
  credentials_ciphertext, capabilities, configuration
) values
(
  '00000000-0000-0000-0000-000000010101',
  '00000000-0000-0000-0000-000000010100',
  '00000000-0000-0000-0000-000000010001',
  'Payout Execution Sandbox', 'sandbox', 'active', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
),
(
  '00000000-0000-0000-0000-000000010102',
  '00000000-0000-0000-0000-000000010100',
  '00000000-0000-0000-0000-000000010001',
  'Payout Execution Production', 'production', 'active', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
);

select app.ensure_account('00000000-0000-0000-0000-000000010001', null, 'sandbox', 'BRL', 'merchant_available_liability');
select app.ensure_account(null, null, 'sandbox', 'BRL', 'payment_fee_revenue');
select app.post_ledger_transaction(
  'sandbox', 'test_seed', '00000000-0000-0000-0000-000000010010', 'seed_available',
  jsonb_build_array(
    jsonb_build_object(
      'account_id', (select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000010001' and account_type='merchant_available_liability'),
      'direction', 'credit', 'amount_cents', 10000
    ),
    jsonb_build_object(
      'account_id', (select id from app.accounts where merchant_id is null and provider_account_id is null and account_type='payment_fee_revenue'),
      'direction', 'debit', 'amount_cents', 10000
    )
  )
);

select app.reserve_payout(
  '00000000-0000-0000-0000-000000010001', 'sandbox', 'BRL', 6000, 500,
  '{"pix_key":"masked"}'::jsonb, 'test-routing-v1', 'payout-exec-key-1', 'payout-exec-fp-1',
  '2026-08-14T05:30:00Z'::timestamptz
);

select app.reserve_payout(
  '00000000-0000-0000-0000-000000010001', 'sandbox', 'BRL', 1000, 100,
  '{"pix_key":"masked-2"}'::jsonb, 'test-routing-v1', 'payout-exec-key-2', 'payout-exec-fp-2',
  '2026-08-14T05:30:01Z'::timestamptz
);

-- PREPARE: create stable provider execution identity without authorizing HTTP.
select lives_ok(
  $$select app.prepare_payout_attempt(
      (select id from app.payouts where idempotency_key='payout-exec-key-1'),
      '00000000-0000-0000-0000-000000010100'::uuid,
      '00000000-0000-0000-0000-000000010101'::uuid,
      'payout-client-ref-1', 'provider-request-fp-1',
      '2026-08-14T05:31:00Z'::timestamptz
  )$$,
  'preparing a payout attempt succeeds without external execution'
);
select is((select count(*)::bigint from app.payout_attempts where client_reference='payout-client-ref-1'), 1::bigint, 'prepare creates exactly one payout attempt');
select is((select state from app.payout_attempts where client_reference='payout-client-ref-1'), 'prepared'::text, 'prepared attempt is not yet authorized for HTTP');
select is((select state from app.payouts where idempotency_key='payout-exec-key-1'), 'requested'::text, 'prepare leaves payout requested');
select is((select attempt_number from app.payout_attempts where client_reference='payout-client-ref-1'), 1, 'first provider execution identity uses attempt number one');
select is((select request_fingerprint from app.payout_attempts where client_reference='payout-client-ref-1'), 'provider-request-fp-1'::text, 'prepare snapshots provider request fingerprint');

select lives_ok(
  $$select app.prepare_payout_attempt(
      (select id from app.payouts where idempotency_key='payout-exec-key-1'),
      '00000000-0000-0000-0000-000000010100'::uuid,
      '00000000-0000-0000-0000-000000010101'::uuid,
      'payout-client-ref-1', 'provider-request-fp-1',
      '2026-08-14T05:31:01Z'::timestamptz
  )$$,
  'exact prepare replay returns existing operation identity'
);
select is((select count(*)::bigint from app.payout_attempts where client_reference='payout-client-ref-1'), 1::bigint, 'prepare replay creates no second attempt');
select throws_ok(
  $$select app.prepare_payout_attempt(
      (select id from app.payouts where idempotency_key='payout-exec-key-1'),
      '00000000-0000-0000-0000-000000010100'::uuid,
      '00000000-0000-0000-0000-000000010101'::uuid,
      'payout-client-ref-1', 'provider-request-fp-DIFFERENT',
      '2026-08-14T05:31:02Z'::timestamptz
  )$$,
  '23505', null,
  'same provider client reference with different request fingerprint conflicts'
);
select throws_ok(
  $$select app.prepare_payout_attempt(
      (select id from app.payouts where idempotency_key='payout-exec-key-2'),
      '00000000-0000-0000-0000-000000010100'::uuid,
      '00000000-0000-0000-0000-000000010102'::uuid,
      'payout-client-ref-wrong-env', 'provider-request-fp-wrong-env',
      '2026-08-14T05:31:03Z'::timestamptz
  )$$,
  '23514', null,
  'provider account environment must match payout environment'
);

-- Isolate claim behavior from prepare behavior so a RED prepare does not mask claim.
delete from app.payout_attempts
where payout_id = (select id from app.payouts where idempotency_key='payout-exec-key-1');

insert into app.payout_attempts (
  id, payout_id, provider_id, provider_account_id, attempt_number, state,
  client_reference, request_fingerprint, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000010200',
  (select id from app.payouts where idempotency_key='payout-exec-key-1'),
  '00000000-0000-0000-0000-000000010100',
  '00000000-0000-0000-0000-000000010101',
  1, 'prepared', 'payout-client-ref-claim', 'provider-request-fp-claim',
  '2026-08-14T05:32:00Z', '2026-08-14T05:32:00Z'
);

select lives_ok(
  $$select app.claim_payout_attempt(
      '00000000-0000-0000-0000-000000010200'::uuid,
      '2026-08-14T05:37:00Z'::timestamptz,
      '2026-08-14T05:32:00Z'::timestamptz
  )$$,
  'one worker can claim a prepared monetary execution'
);
select isnt((select execution_token from app.payout_attempts where id='00000000-0000-0000-0000-000000010200'), null::uuid, 'claim stores a non-null fencing/execution token');
select is((select state from app.payout_attempts where id='00000000-0000-0000-0000-000000010200'), 'executing'::text, 'claim marks attempt executing');
select is((select state from app.payouts where idempotency_key='payout-exec-key-1'), 'processing'::text, 'claim atomically moves payout requested to processing');
select is((select lease_expires_at from app.payout_attempts where id='00000000-0000-0000-0000-000000010200'), '2026-08-14T05:37:00Z'::timestamptz, 'claim persists execution lease expiry');
select is((select started_at from app.payout_attempts where id='00000000-0000-0000-0000-000000010200'), '2026-08-14T05:32:00Z'::timestamptz, 'claim persists execution start time');
select throws_ok(
  $$select app.claim_payout_attempt(
      '00000000-0000-0000-0000-000000010200'::uuid,
      '2026-08-14T05:38:00Z'::timestamptz,
      '2026-08-14T05:33:00Z'::timestamptz
  )$$,
  '23514', null,
  'already executing attempt cannot receive a second execute authorization'
);
select throws_ok(
  $$select app.claim_payout_attempt(
      '00000000-0000-0000-0000-000000010200'::uuid,
      '2026-08-14T05:45:00Z'::timestamptz,
      '2026-08-14T05:40:00Z'::timestamptz
  )$$,
  '23514', null,
  'expired prior lease still cannot authorize a blind second provider POST'
);

-- A lease must be forward from the claim time even for an otherwise prepared attempt.
update app.payouts set state='requested' where idempotency_key='payout-exec-key-2';
insert into app.payout_attempts (
  id, payout_id, provider_id, provider_account_id, attempt_number, state,
  client_reference, request_fingerprint, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000010201',
  (select id from app.payouts where idempotency_key='payout-exec-key-2'),
  '00000000-0000-0000-0000-000000010100',
  '00000000-0000-0000-0000-000000010101',
  1, 'prepared', 'payout-client-ref-invalid-lease', 'provider-request-fp-invalid-lease',
  '2026-08-14T05:32:00Z', '2026-08-14T05:32:00Z'
);
select throws_ok(
  $$select app.claim_payout_attempt(
      '00000000-0000-0000-0000-000000010201'::uuid,
      '2026-08-14T05:31:59Z'::timestamptz,
      '2026-08-14T05:32:00Z'::timestamptz
  )$$,
  '23514', null,
  'execution lease must expire strictly after claimed_at'
);
select is((select state from app.payout_attempts where id='00000000-0000-0000-0000-000000010201'), 'prepared'::text, 'invalid lease leaves attempt prepared');

select * from finish();
rollback;
