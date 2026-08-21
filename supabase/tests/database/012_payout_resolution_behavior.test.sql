create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(72);

insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000012001', 'Payout Resolution Merchant', 'active');

insert into app.providers (id, code, name, status)
values ('00000000-0000-0000-0000-000000012100', 'payout-resolution-provider', 'Payout Resolution Provider', 'active');

insert into app.provider_accounts (
  id, provider_id, merchant_id, name, environment, status,
  credentials_ciphertext, capabilities, configuration
) values (
  '00000000-0000-0000-0000-000000012101',
  '00000000-0000-0000-0000-000000012100',
  '00000000-0000-0000-0000-000000012001',
  'Payout Resolution Sandbox', 'sandbox', 'active', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
);

insert into app.webhook_endpoints (
  id, merchant_id, environment, url, status, secret_ciphertext,
  secret_version, subscribed_events
) values (
  '00000000-0000-0000-0000-000000012150',
  '00000000-0000-0000-0000-000000012001',
  'sandbox', 'https://merchant.example.test/webhook', 'active', 'ciphertext', 1,
  '["payout.completed","payout.failed"]'::jsonb
);

select app.ensure_account('00000000-0000-0000-0000-000000012001', null, 'sandbox', 'BRL', 'merchant_available_liability');
select app.ensure_account(null, null, 'sandbox', 'BRL', 'payment_fee_revenue');
select app.post_ledger_transaction(
  'sandbox', 'test_seed', '00000000-0000-0000-0000-000000012010', 'seed_available',
  jsonb_build_array(
    jsonb_build_object(
      'account_id', (select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_available_liability'),
      'direction', 'credit', 'amount_cents', 30000
    ),
    jsonb_build_object(
      'account_id', (select id from app.accounts where merchant_id is null and provider_account_id is null and account_type='payment_fee_revenue'),
      'direction', 'debit', 'amount_cents', 30000
    )
  )
);

select app.reserve_payout(
  '00000000-0000-0000-0000-000000012001', 'sandbox', 'BRL', 1000, 100,
  '{"pix_key":"record"}'::jsonb, 'routing-v1', 'payout-resolution-record', 'fp-record',
  '2026-08-14T07:20:00Z'::timestamptz
);
select app.reserve_payout(
  '00000000-0000-0000-0000-000000012001', 'sandbox', 'BRL', 6000, 500,
  '{"pix_key":"complete"}'::jsonb, 'routing-v1', 'payout-resolution-complete', 'fp-complete',
  '2026-08-14T07:20:01Z'::timestamptz
);
select app.reserve_payout(
  '00000000-0000-0000-0000-000000012001', 'sandbox', 'BRL', 4000, 300,
  '{"pix_key":"fail"}'::jsonb, 'routing-v1', 'payout-resolution-fail', 'fp-fail',
  '2026-08-14T07:20:02Z'::timestamptz
);
select app.reserve_payout(
  '00000000-0000-0000-0000-000000012001', 'sandbox', 'BRL', 2000, 100,
  '{"pix_key":"requested"}'::jsonb, 'routing-v1', 'payout-resolution-requested', 'fp-requested',
  '2026-08-14T07:20:03Z'::timestamptz
);

update app.payouts
set state = 'processing', updated_at = '2026-08-14T07:21:00Z'
where idempotency_key in (
  'payout-resolution-record',
  'payout-resolution-complete',
  'payout-resolution-fail'
);

insert into app.payout_attempts (
  id, payout_id, provider_id, provider_account_id, attempt_number, state,
  client_reference, request_fingerprint, execution_token, started_at, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000012201',
  (select id from app.payouts where idempotency_key='payout-resolution-record'),
  '00000000-0000-0000-0000-000000012100', '00000000-0000-0000-0000-000000012101',
  1, 'executing', 'client-record', 'provider-fp-record', gen_random_uuid(),
  '2026-08-14T07:21:00Z', '2026-08-14T07:21:00Z', '2026-08-14T07:21:00Z'
),
(
  '00000000-0000-0000-0000-000000012202',
  (select id from app.payouts where idempotency_key='payout-resolution-complete'),
  '00000000-0000-0000-0000-000000012100', '00000000-0000-0000-0000-000000012101',
  1, 'executing', 'client-complete', 'provider-fp-complete', gen_random_uuid(),
  '2026-08-14T07:21:00Z', '2026-08-14T07:21:00Z', '2026-08-14T07:21:00Z'
),
(
  '00000000-0000-0000-0000-000000012203',
  (select id from app.payouts where idempotency_key='payout-resolution-fail'),
  '00000000-0000-0000-0000-000000012100', '00000000-0000-0000-0000-000000012101',
  1, 'executing', 'client-fail', 'provider-fp-fail', gen_random_uuid(),
  '2026-08-14T07:21:00Z', '2026-08-14T07:21:00Z', '2026-08-14T07:21:00Z'
),
(
  '00000000-0000-0000-0000-000000012204',
  (select id from app.payouts where idempotency_key='payout-resolution-requested'),
  '00000000-0000-0000-0000-000000012100', '00000000-0000-0000-0000-000000012101',
  1, 'prepared', 'client-requested', 'provider-fp-requested', null,
  null, '2026-08-14T07:21:00Z', '2026-08-14T07:21:00Z'
);

-- record_payout_evidence: durable source identity, replay and conflict semantics.
-- 01
select lives_ok(
  $$select app.record_payout_evidence(
      (select id from app.payouts where idempotency_key='payout-resolution-record'),
      '00000000-0000-0000-0000-000000012201'::uuid,
      'execution_result', 'record-result-1', 'processing', 'PROCESSING', null, null,
      'hash-record-1', '2026-08-14T07:22:00Z'::timestamptz
  )$$,
  'normalized payout evidence can be recorded before application'
);
-- 02
select is((select count(*)::bigint from app.payout_evidence where source_reference='record-result-1'), 1::bigint, 'record creates one durable payout evidence row');
-- 03
select is((select environment from app.payout_evidence where source_reference='record-result-1'), 'sandbox'::text, 'record derives payout environment instead of trusting caller scope');
-- 04
select is((select source_kind from app.payout_evidence where source_reference='record-result-1'), 'execution_result'::text, 'record preserves normalized evidence provenance');
-- 05
select is((select outcome from app.payout_evidence where source_reference='record-result-1'), 'processing'::text, 'record preserves normalized certainty outcome');
-- 06
select lives_ok(
  $$select app.record_payout_evidence(
      (select id from app.payouts where idempotency_key='payout-resolution-record'),
      '00000000-0000-0000-0000-000000012201'::uuid,
      'execution_result', 'record-result-1', 'processing', 'PROCESSING', null, null,
      'hash-record-1', '2026-08-14T07:22:00Z'::timestamptz
  )$$,
  'exact evidence replay returns the existing evidence identity'
);
-- 07
select is((select count(*)::bigint from app.payout_evidence where source_reference='record-result-1'), 1::bigint, 'exact evidence replay creates no duplicate row');
-- 08
select throws_ok(
  $$select app.record_payout_evidence(
      (select id from app.payouts where idempotency_key='payout-resolution-record'),
      '00000000-0000-0000-0000-000000012201'::uuid,
      'execution_result', 'record-result-1', 'execution_unknown', 'TIMEOUT', null, null,
      'hash-record-DIFFERENT', '2026-08-14T07:22:01Z'::timestamptz
  )$$,
  '23505', null,
  'same evidence source identity with different normalized payload conflicts'
);
-- 09
select throws_ok(
  $$select app.record_payout_evidence(
      (select id from app.payouts where idempotency_key='payout-resolution-complete'),
      '00000000-0000-0000-0000-000000012201'::uuid,
      'provider_query', 'mismatched-attempt', 'processing', 'PROCESSING', null, null,
      'hash-mismatch', '2026-08-14T07:22:02Z'::timestamptz
  )$$,
  '23514', null,
  'evidence attempt must belong to the supplied payout'
);
-- 10
select throws_ok(
  $$select app.record_payout_evidence(
      (select id from app.payouts where idempotency_key='payout-resolution-record'),
      '00000000-0000-0000-0000-000000012201'::uuid,
      'provider_query', 'completed-without-cost', 'completed', 'COMPLETED', 'provider-payout-record', null,
      'hash-completed-no-cost', '2026-08-14T07:22:03Z'::timestamptz
  )$$,
  '23514', null,
  'completed payout evidence requires explicit non-negative provider cost'
);

-- Isolate apply behavior from record behavior with explicit durable fixtures.
insert into app.payout_evidence (
  id, payout_id, payout_attempt_id, environment, source_kind, source_reference, outcome,
  provider_status_raw, provider_payout_id, provider_cost_cents, payload_hash, occurred_at
) values
(
  '00000000-0000-0000-0000-000000012301',
  (select id from app.payouts where idempotency_key='payout-resolution-complete'),
  '00000000-0000-0000-0000-000000012202', 'sandbox', 'execution_result', 'complete-timeout',
  'execution_unknown', 'TIMEOUT', null, null, 'hash-complete-timeout', '2026-08-14T07:23:00Z'
),
(
  '00000000-0000-0000-0000-000000012302',
  (select id from app.payouts where idempotency_key='payout-resolution-complete'),
  '00000000-0000-0000-0000-000000012202', 'sandbox', 'provider_query', 'complete-query',
  'completed', 'COMPLETED', 'provider-payout-complete', 100, 'hash-complete-query', '2026-08-14T07:24:00Z'
),
(
  '00000000-0000-0000-0000-000000012303',
  (select id from app.payouts where idempotency_key='payout-resolution-complete'),
  '00000000-0000-0000-0000-000000012202', 'sandbox', 'provider_event', 'complete-event-duplicate',
  'completed', 'PAID', 'provider-payout-complete', 100, 'hash-complete-event', '2026-08-14T07:24:30Z'
),
(
  '00000000-0000-0000-0000-000000012304',
  (select id from app.payouts where idempotency_key='payout-resolution-complete'),
  '00000000-0000-0000-0000-000000012202', 'sandbox', 'provider_event', 'complete-event-stale-failure',
  'definitively_failed', 'FAILED', 'provider-payout-complete', null, 'hash-complete-stale-failure', '2026-08-14T07:25:00Z'
),
(
  '00000000-0000-0000-0000-000000012305',
  (select id from app.payouts where idempotency_key='payout-resolution-fail'),
  '00000000-0000-0000-0000-000000012203', 'sandbox', 'execution_result', 'fail-timeout',
  'execution_unknown', 'TIMEOUT', null, null, 'hash-fail-timeout', '2026-08-14T07:23:10Z'
),
(
  '00000000-0000-0000-0000-000000012306',
  (select id from app.payouts where idempotency_key='payout-resolution-fail'),
  '00000000-0000-0000-0000-000000012203', 'sandbox', 'provider_query', 'fail-query',
  'definitively_failed', 'FAILED', null, null, 'hash-fail-query', '2026-08-14T07:24:10Z'
),
(
  '00000000-0000-0000-0000-000000012307',
  (select id from app.payouts where idempotency_key='payout-resolution-requested'),
  '00000000-0000-0000-0000-000000012204', 'sandbox', 'provider_event', 'requested-event',
  'processing', 'PROCESSING', null, null, 'hash-requested-event', '2026-08-14T07:23:20Z'
);

-- execution_unknown is financially inert and keeps payout funding blocked.
-- 11
select lives_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012301'::uuid)$$, 'ambiguous execution evidence applies without pretending failure');
-- 12
select is((select state from app.payouts where idempotency_key='payout-resolution-complete'), 'execution_unknown'::text, 'ambiguous execution moves payout to execution_unknown');
-- 13
select is((select state from app.payout_attempts where id='00000000-0000-0000-0000-000000012202'), 'execution_unknown'::text, 'ambiguous execution moves provider attempt to execution_unknown');
-- 14
select is((select application_state from app.payout_evidence where id='00000000-0000-0000-0000-000000012301'), 'applied'::text, 'unknown evidence is marked applied');
-- 15
select isnt((select applied_at from app.payout_evidence where id='00000000-0000-0000-0000-000000012301'), null::timestamptz, 'unknown evidence application time is durable');
-- 16
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_payout_blocked_liability'), 13000::bigint, 'execution_unknown leaves all payout-blocked funds unchanged');
-- 17
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_available_liability'), 17000::bigint, 'execution_unknown does not release merchant available funds');
-- 18
select is((select count(*)::bigint from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and posting_type in ('completed','release_failure')), 0::bigint, 'execution_unknown creates no terminal ledger posting');
-- 19
select is((select count(*)::bigint from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-complete')), 0::bigint, 'execution_unknown creates no merchant terminal webhook event');

-- Authoritative completion recovers unknown exactly once and posts explicit economics.
-- 20
select lives_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012302'::uuid)$$, 'authoritative completed evidence resolves execution_unknown');
-- 21
select is((select state from app.payouts where idempotency_key='payout-resolution-complete'), 'completed'::text, 'completed evidence marks payout completed');
-- 22
select is((select state from app.payout_attempts where id='00000000-0000-0000-0000-000000012202'), 'succeeded'::text, 'completed evidence marks attempt succeeded');
-- 23
select is((select provider_cost_cents from app.payout_attempts where id='00000000-0000-0000-0000-000000012202'), 100::bigint, 'completed evidence persists authoritative provider payout cost');
-- 24
select is((select provider_status_raw from app.payout_attempts where id='00000000-0000-0000-0000-000000012202'), 'COMPLETED'::text, 'completed evidence persists normalized raw provider status');
-- 25
select is((select provider_payout_id from app.payout_attempts where id='00000000-0000-0000-0000-000000012202'), 'provider-payout-complete'::text, 'completed evidence persists external payout identity');
-- 26
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_payout_blocked_liability'), 7000::bigint, 'completed payout consumes its gross blocked amount exactly once');
-- 27
select is((select balance_cents from app.accounts where provider_account_id='00000000-0000-0000-0000-000000012101' and account_type='provider_settlement_asset'), (-5600)::bigint, 'completed payout credits provider settlement asset by recipient plus provider cost');
-- 28
select is((select balance_cents from app.accounts where merchant_id is null and provider_account_id is null and account_type='provider_payout_fee_expense'), 100::bigint, 'provider payout cost is explicit expense');
-- 29
select is((select balance_cents from app.accounts where merchant_id is null and provider_account_id is null and account_type='payout_fee_revenue'), 500::bigint, 'merchant payout fee is explicit SwiftPay revenue');
-- 30
select is((select count(*)::bigint from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and posting_type='completed'), 1::bigint, 'completed payout has exactly one completion ledger transaction');
-- 31
select is((select count(*)::bigint from app.ledger_entries where ledger_transaction_id=(select id from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and posting_type='completed')), 4::bigint, 'non-zero provider and merchant fees produce four balanced completion entries');
-- 32
select is((select count(*)::bigint from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and type='payout.completed'), 1::bigint, 'completion materializes one durable merchant payout.completed event');
-- 33
select is((select count(*)::bigint from app.webhook_deliveries where webhook_event_id=(select id from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and type='payout.completed')), 1::bigint, 'completion event fanout is durably materialized before HTTP');
-- 34
select is((select source_type from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and type='payout.completed'), 'payout_evidence'::text, 'merchant completion event is sourced from canonical payout evidence');
-- 35
select is((select source_id from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and type='payout.completed'), '00000000-0000-0000-0000-000000012302'::uuid, 'merchant completion event preserves evidence source identity');
-- 36
select ok(not ((select payload_snapshot from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and type='payout.completed') ? 'provider_cost_cents'), 'public payout.completed payload excludes provider cost internals');
-- 37
select is((select application_state from app.payout_evidence where id='00000000-0000-0000-0000-000000012302'), 'applied'::text, 'completed evidence is marked applied');

-- Same evidence replay is exactly-once.
-- 38
select lives_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012302'::uuid)$$, 'reapplying already applied completion evidence is idempotent');
-- 39
select is((select count(*)::bigint from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and posting_type='completed'), 1::bigint, 'completion replay cannot duplicate ledger posting');
-- 40
select is((select count(*)::bigint from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and type='payout.completed'), 1::bigint, 'completion replay cannot duplicate merchant logical event');

-- New evidence confirming an existing terminal result is absorbed.
-- 41
select lives_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012303'::uuid)$$, 'same-terminal completed evidence is absorbed without financial replay');
-- 42
select is((select application_state from app.payout_evidence where id='00000000-0000-0000-0000-000000012303'), 'absorbed'::text, 'same-terminal evidence is visibly marked absorbed');
-- 43
select is((select count(*)::bigint from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and posting_type='completed'), 1::bigint, 'absorbed terminal confirmation does not duplicate ledger');
-- 44
select is((select count(*)::bigint from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and type='payout.completed'), 1::bigint, 'absorbed terminal confirmation does not duplicate webhook event');

-- Contradictory terminal evidence is retained as conflict and cannot rewind money.
-- 45
select lives_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012304'::uuid)$$, 'stale contradictory failure evidence is retained without rewriting completed payout');
-- 46
select is((select application_state from app.payout_evidence where id='00000000-0000-0000-0000-000000012304'), 'conflict'::text, 'contradictory terminal evidence is visibly marked conflict');
-- 47
select is((select state from app.payouts where idempotency_key='payout-resolution-complete'), 'completed'::text, 'conflicting failure cannot rewind completed payout');
-- 48
select is((select state from app.payout_attempts where id='00000000-0000-0000-0000-000000012202'), 'succeeded'::text, 'conflicting failure cannot rewind succeeded provider attempt');
-- 49
select is((select count(*)::bigint from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-complete') and posting_type='release_failure'), 0::bigint, 'conflicting failure cannot release already consumed payout funds');
-- 50
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_payout_blocked_liability'), 7000::bigint, 'conflicting terminal evidence leaves merchant balances unchanged');

-- A second payout demonstrates execution_unknown -> definitive failure release.
-- 51
select lives_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012305'::uuid)$$, 'ambiguous failure-path execution becomes execution_unknown first');
-- 52
select is((select state from app.payouts where idempotency_key='payout-resolution-fail'), 'execution_unknown'::text, 'failure-path payout remains unknown until authoritative proof');
-- 53
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_payout_blocked_liability'), 7000::bigint, 'failure-path unknown result keeps payout funding blocked');
-- 54
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_available_liability'), 17000::bigint, 'failure-path unknown result releases no available balance');

-- 55
select lives_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012306'::uuid)$$, 'authoritative non-execution evidence resolves unknown payout as failed');
-- 56
select is((select state from app.payouts where idempotency_key='payout-resolution-fail'), 'failed'::text, 'definitive failure marks payout failed');
-- 57
select is((select state from app.payout_attempts where id='00000000-0000-0000-0000-000000012203'), 'definitively_failed'::text, 'definitive failure marks attempt definitively_failed');
-- 58
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_payout_blocked_liability'), 3000::bigint, 'definitive failure consumes the failed payout block by releasing it');
-- 59
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000012001' and account_type='merchant_available_liability'), 21000::bigint, 'definitive failure returns gross payout amount to available');
-- 60
select is((select count(*)::bigint from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-fail') and posting_type='release_failure'), 1::bigint, 'definitive failure has exactly one release ledger transaction');
-- 61
select is((select count(*)::bigint from app.ledger_entries where ledger_transaction_id=(select id from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-fail') and posting_type='release_failure')), 2::bigint, 'failure release is a two-entry blocked-to-available transfer');
-- 62
select is((select count(*)::bigint from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-fail') and type='payout.failed'), 1::bigint, 'definitive failure materializes one merchant payout.failed event');
-- 63
select is((select count(*)::bigint from app.webhook_deliveries where webhook_event_id=(select id from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-fail') and type='payout.failed')), 1::bigint, 'failure event fanout is durably materialized');
-- 64
select is((select source_type from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-fail') and type='payout.failed'), 'payout_evidence'::text, 'merchant failure event is sourced from canonical payout evidence');
-- 65
select is((select application_state from app.payout_evidence where id='00000000-0000-0000-0000-000000012306'), 'applied'::text, 'definitive failure evidence is marked applied');

-- Failure replay is exactly-once.
-- 66
select lives_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012306'::uuid)$$, 'reapplying failure evidence is idempotent');
-- 67
select is((select count(*)::bigint from app.ledger_transactions where source_type='payout' and source_id=(select id from app.payouts where idempotency_key='payout-resolution-fail') and posting_type='release_failure'), 1::bigint, 'failure replay cannot duplicate release posting');
-- 68
select is((select count(*)::bigint from app.webhook_events where resource_id=(select id from app.payouts where idempotency_key='payout-resolution-fail') and type='payout.failed'), 1::bigint, 'failure replay cannot duplicate merchant logical event');

-- Evidence can be stored for audit while payout is pre-execution, but application rejects it.
-- 69
select throws_ok($$select app.apply_payout_evidence('00000000-0000-0000-0000-000000012307'::uuid)$$, '23514', null, 'requested/pre-execution payout cannot be resolved through external evidence boundary');
-- 70
select is((select state from app.payouts where idempotency_key='payout-resolution-requested'), 'requested'::text, 'rejected pre-execution evidence leaves payout requested');
-- 71
select is((select state from app.payout_attempts where id='00000000-0000-0000-0000-000000012204'), 'prepared'::text, 'rejected pre-execution evidence leaves attempt prepared');
-- 72
select is((select application_state from app.payout_evidence where id='00000000-0000-0000-0000-000000012307'), 'received'::text, 'rejected pre-execution evidence remains unapplied for audit');

select * from finish();
rollback;
