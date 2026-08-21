create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(70);

insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000014001', 'Refund Resolution Merchant', 'active');

insert into app.providers (id, code, name, status)
values ('00000000-0000-0000-0000-000000014100', 'refund-resolution-provider', 'Refund Resolution Provider', 'active');

insert into app.provider_accounts (
  id, provider_id, merchant_id, name, environment, status,
  credentials_ciphertext, capabilities, configuration
) values
(
  '00000000-0000-0000-0000-000000014101',
  '00000000-0000-0000-0000-000000014100',
  '00000000-0000-0000-0000-000000014001',
  'Refund Resolution Sandbox', 'sandbox', 'active', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
),
(
  '00000000-0000-0000-0000-000000014102',
  '00000000-0000-0000-0000-000000014100',
  '00000000-0000-0000-0000-000000014001',
  'Refund Resolution Production', 'production', 'active', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
),
(
  '00000000-0000-0000-0000-000000014103',
  '00000000-0000-0000-0000-000000014100',
  '00000000-0000-0000-0000-000000014001',
  'Wrong Sandbox Account', 'sandbox', 'active', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
);

insert into app.payments (
  id, merchant_id, environment, source, collection_status, amount_cents, currency,
  pricing_version, rounding_policy_version, merchant_fee_cents, merchant_net_cents,
  provider_cost_cents, refunded_amount_cents, refund_fee_policy, paid_at
) values
(
  '00000000-0000-0000-0000-000000014201',
  '00000000-0000-0000-0000-000000014001', 'sandbox', 'api', 'paid', 10000, 'BRL',
  'test-v1', 'test-v1', 1000, 9000, 100, 0, 'merchant_fee_non_refundable', '2026-08-14T07:00:00Z'
),
(
  '00000000-0000-0000-0000-000000014202',
  '00000000-0000-0000-0000-000000014001', 'sandbox', 'api', 'paid', 6000, 'BRL',
  'test-v1', 'test-v1', 600, 5400, 60, 0, 'merchant_fee_non_refundable', '2026-08-14T07:00:01Z'
),
(
  '00000000-0000-0000-0000-000000014203',
  '00000000-0000-0000-0000-000000014001', 'production', 'api', 'paid', 1000, 'BRL',
  'test-v1', 'test-v1', 100, 900, 10, 0, 'merchant_fee_non_refundable', '2026-08-14T07:00:02Z'
);

insert into app.provider_attempts (
  id, payment_id, provider_id, provider_account_id, operation, attempt_number, state,
  client_reference, request_fingerprint, provider_payment_id, provider_status_raw,
  created_at, updated_at, finished_at
) values
(
  '00000000-0000-0000-0000-000000014301',
  '00000000-0000-0000-0000-000000014201',
  '00000000-0000-0000-0000-000000014100', '00000000-0000-0000-0000-000000014101',
  'create_pix_charge', 1, 'succeeded', 'payment-a', 'payment-a-fp', 'provider-payment-a', 'PAID',
  '2026-08-14T07:00:00Z', '2026-08-14T07:01:00Z', '2026-08-14T07:01:00Z'
),
(
  '00000000-0000-0000-0000-000000014302',
  '00000000-0000-0000-0000-000000014202',
  '00000000-0000-0000-0000-000000014100', '00000000-0000-0000-0000-000000014101',
  'create_pix_charge', 1, 'succeeded', 'payment-b', 'payment-b-fp', 'provider-payment-b', 'PAID',
  '2026-08-14T07:00:01Z', '2026-08-14T07:01:01Z', '2026-08-14T07:01:01Z'
),
(
  '00000000-0000-0000-0000-000000014303',
  '00000000-0000-0000-0000-000000014203',
  '00000000-0000-0000-0000-000000014100', '00000000-0000-0000-0000-000000014102',
  'create_pix_charge', 1, 'succeeded', 'payment-prod', 'payment-prod-fp', 'provider-payment-prod', 'PAID',
  '2026-08-14T07:00:02Z', '2026-08-14T07:01:02Z', '2026-08-14T07:01:02Z'
);

insert into app.webhook_endpoints (
  id, merchant_id, environment, url, status, secret_ciphertext, secret_version, subscribed_events
) values
(
  '00000000-0000-0000-0000-000000014401',
  '00000000-0000-0000-0000-000000014001', 'sandbox',
  'https://merchant.example.test/refund-webhook', 'active', 'ciphertext', 1,
  '["refund.completed","refund.failed"]'::jsonb
),
(
  '00000000-0000-0000-0000-000000014402',
  '00000000-0000-0000-0000-000000014001', 'production',
  'https://merchant.example.test/refund-webhook-production', 'active', 'ciphertext', 1,
  '["refund.completed","refund.failed"]'::jsonb
);

-- Seed merchant available balances independently by environment.
select app.ensure_account('00000000-0000-0000-0000-000000014001', null, 'sandbox', 'BRL', 'merchant_available_liability');
select app.ensure_account('00000000-0000-0000-0000-000000014001', null, 'production', 'BRL', 'merchant_available_liability');
select app.ensure_account(null, null, 'sandbox', 'BRL', 'payment_fee_revenue');
select app.ensure_account(null, null, 'production', 'BRL', 'payment_fee_revenue');

select app.post_ledger_transaction(
  'sandbox', 'test_seed', '00000000-0000-0000-0000-000000014410', 'seed_available',
  jsonb_build_array(
    jsonb_build_object(
      'account_id', (select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000014001' and environment='sandbox' and account_type='merchant_available_liability'),
      'direction', 'credit', 'amount_cents', 16000
    ),
    jsonb_build_object(
      'account_id', (select id from app.accounts where merchant_id is null and provider_account_id is null and environment='sandbox' and account_type='payment_fee_revenue'),
      'direction', 'debit', 'amount_cents', 16000
    )
  )
);

select app.post_ledger_transaction(
  'production', 'test_seed', '00000000-0000-0000-0000-000000014411', 'seed_available',
  jsonb_build_array(
    jsonb_build_object(
      'account_id', (select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000014001' and environment='production' and account_type='merchant_available_liability'),
      'direction', 'credit', 'amount_cents', 1000
    ),
    jsonb_build_object(
      'account_id', (select id from app.accounts where merchant_id is null and provider_account_id is null and environment='production' and account_type='payment_fee_revenue'),
      'direction', 'debit', 'amount_cents', 1000
    )
  )
);

-- Payment A: two equal partial refunds followed by final cumulative refund.
select app.reserve_refund('00000000-0000-0000-0000-000000014201','00000000-0000-0000-0000-000000014001','sandbox',3000,'refund-a1','refund-a1-fp','2026-08-14T07:10:00Z');
select app.reserve_refund('00000000-0000-0000-0000-000000014201','00000000-0000-0000-0000-000000014001','sandbox',3000,'refund-a2','refund-a2-fp','2026-08-14T07:10:01Z');
select app.reserve_refund('00000000-0000-0000-0000-000000014201','00000000-0000-0000-0000-000000014001','sandbox',4000,'refund-a3','refund-a3-fp','2026-08-14T07:10:02Z');
-- Payment B: one failure-path refund plus one requested refund used for pre-execution rejection.
select app.reserve_refund('00000000-0000-0000-0000-000000014202','00000000-0000-0000-0000-000000014001','sandbox',5000,'refund-b1','refund-b1-fp','2026-08-14T07:10:03Z');
select app.reserve_refund('00000000-0000-0000-0000-000000014202','00000000-0000-0000-0000-000000014001','sandbox',1000,'refund-b2','refund-b2-fp','2026-08-14T07:10:04Z');
-- Production refund exists only to prove sandbox simulation cannot be applied/recorded there.
select app.reserve_refund('00000000-0000-0000-0000-000000014203','00000000-0000-0000-0000-000000014001','production',1000,'refund-prod','refund-prod-fp','2026-08-14T07:10:05Z');

update app.refunds
set state='processing', updated_at='2026-08-14T07:11:00Z'
where idempotency_key in ('refund-a1','refund-a2','refund-a3','refund-b1');

-- record_refund_evidence: stable source identity and provider-account scope.
-- 01
select lives_ok(
  $$select app.record_refund_evidence(
      (select id from app.refunds where idempotency_key='refund-a1'),
      '00000000-0000-0000-0000-000000014101'::uuid,
      'sandbox_simulation','a1-processing','processing','not_supplied',null,
      'PROCESSING',null,'hash-a1-processing','2026-08-14T07:12:00Z'::timestamptz
  )$$,
  'sandbox refund evidence can be recorded without external provider execution'
);
-- 02
select is((select count(*)::bigint from app.refund_evidence where source_reference='a1-processing'),1::bigint,'record creates one refund evidence row');
-- 03
select is((select environment from app.refund_evidence where source_reference='a1-processing'),'sandbox'::text,'record derives Refund environment instead of trusting caller scope');
-- 04
select is((select amount_semantics from app.refund_evidence where source_reference='a1-processing'),'not_supplied'::text,'record preserves declared refund amount semantics');
-- 05
select lives_ok(
  $$select app.record_refund_evidence(
      (select id from app.refunds where idempotency_key='refund-a1'),
      '00000000-0000-0000-0000-000000014101'::uuid,
      'sandbox_simulation','a1-processing','processing','not_supplied',null,
      'PROCESSING',null,'hash-a1-processing','2026-08-14T07:12:00Z'::timestamptz
  )$$,
  'exact refund evidence replay returns existing evidence identity'
);
-- 06
select is((select count(*)::bigint from app.refund_evidence where source_reference='a1-processing'),1::bigint,'exact refund evidence replay creates no duplicate');
-- 07
select throws_ok(
  $$select app.record_refund_evidence(
      (select id from app.refunds where idempotency_key='refund-a1'),
      '00000000-0000-0000-0000-000000014101'::uuid,
      'sandbox_simulation','a1-processing','execution_unknown','not_supplied',null,
      'TIMEOUT',null,'hash-a1-DIFFERENT','2026-08-14T07:12:01Z'::timestamptz
  )$$,
  '23505',null,'same provider evidence identity with different normalized payload conflicts'
);
-- 08
select throws_ok(
  $$select app.record_refund_evidence(
      (select id from app.refunds where idempotency_key='refund-a1'),
      '00000000-0000-0000-0000-000000014103'::uuid,
      'reconciliation','wrong-provider-account','completed','event_delta',3000,
      'COMPLETED','provider-refund-wrong','hash-wrong-provider','2026-08-14T07:12:02Z'::timestamptz
  )$$,
  '23514',null,'refund evidence provider account must match the succeeded source Payment provider account'
);
-- 09
select throws_ok(
  $$select app.record_refund_evidence(
      (select id from app.refunds where idempotency_key='refund-prod'),
      '00000000-0000-0000-0000-000000014102'::uuid,
      'sandbox_simulation','production-simulation','completed','event_delta',1000,
      'SIMULATED_COMPLETED',null,'hash-production-sim','2026-08-14T07:12:03Z'::timestamptz
  )$$,
  '23514',null,'sandbox simulation is structurally forbidden for Production Refunds'
);

-- Provider-originated evidence is durable but application remains fail-closed until provider refund conformance exists.
-- 10
select lives_ok(
  $$select app.record_refund_evidence(
      (select id from app.refunds where idempotency_key='refund-b1'),
      '00000000-0000-0000-0000-000000014101'::uuid,
      'provider_event','provider-event-unproven','completed','event_delta',5000,
      'REFUNDED','provider-refund-b1','hash-provider-event-b1','2026-08-14T07:13:00Z'::timestamptz
  )$$,
  'unproven provider refund evidence may be retained durably for audit'
);
-- 11
select throws_ok(
  $$select app.apply_refund_evidence((select id from app.refund_evidence where source_reference='provider-event-unproven'))$$,
  '0A000',null,'provider refund evidence cannot mutate money before retained-provider refund conformance is activated'
);
-- 12
select is((select state from app.refunds where idempotency_key='refund-b1'),'processing'::text,'blocked provider evidence leaves Refund state unchanged');
-- 13
select is((select application_state from app.refund_evidence where source_reference='provider-event-unproven'),'received'::text,'blocked provider evidence remains unapplied and auditable');
-- 14
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000014202'),0::bigint,'blocked provider evidence cannot change Payment refunded total');

-- Explicit evidence fixtures isolate application behavior from record behavior.
insert into app.refund_evidence (
  id, refund_id, provider_account_id, environment, source_kind, source_reference, outcome,
  amount_semantics, provider_reported_amount_cents, provider_status_raw, provider_refund_id,
  payload_hash, occurred_at
) values
(
  '00000000-0000-0000-0000-000000014501',
  (select id from app.refunds where idempotency_key='refund-a1'),
  '00000000-0000-0000-0000-000000014101','sandbox','sandbox_simulation','a1-timeout','execution_unknown',
  'not_supplied',null,'TIMEOUT',null,'hash-a1-timeout','2026-08-14T07:14:00Z'
),
(
  '00000000-0000-0000-0000-000000014502',
  (select id from app.refunds where idempotency_key='refund-a1'),
  '00000000-0000-0000-0000-000000014101','sandbox','sandbox_simulation','a1-complete','completed',
  'event_delta',3000,'SIMULATED_COMPLETED',null,'hash-a1-complete','2026-08-14T07:15:00Z'
),
(
  '00000000-0000-0000-0000-000000014503',
  (select id from app.refunds where idempotency_key='refund-a1'),
  '00000000-0000-0000-0000-000000014101','sandbox','reconciliation','a1-complete-confirm','completed',
  'event_delta',3000,'CONFIRMED',null,'hash-a1-confirm','2026-08-14T07:15:30Z'
),
(
  '00000000-0000-0000-0000-000000014504',
  (select id from app.refunds where idempotency_key='refund-a1'),
  '00000000-0000-0000-0000-000000014101','sandbox','reconciliation','a1-stale-failure','definitively_failed',
  'not_supplied',null,'FAILED',null,'hash-a1-stale-failure','2026-08-14T07:16:00Z'
),
(
  '00000000-0000-0000-0000-000000014505',
  (select id from app.refunds where idempotency_key='refund-a2'),
  '00000000-0000-0000-0000-000000014101','sandbox','sandbox_simulation','a2-complete','completed',
  'event_delta',3000,'SIMULATED_COMPLETED',null,'hash-a2-complete','2026-08-14T07:17:00Z'
),
(
  '00000000-0000-0000-0000-000000014506',
  (select id from app.refunds where idempotency_key='refund-a3'),
  '00000000-0000-0000-0000-000000014101','sandbox','reconciliation','a3-stale-cumulative','completed',
  'cumulative_total',9000,'REFUNDED_TOTAL_9000',null,'hash-a3-stale-total','2026-08-14T07:18:00Z'
),
(
  '00000000-0000-0000-0000-000000014507',
  (select id from app.refunds where idempotency_key='refund-a3'),
  '00000000-0000-0000-0000-000000014101','sandbox','reconciliation','a3-final-cumulative','completed',
  'cumulative_total',10000,'REFUNDED_TOTAL_10000',null,'hash-a3-final-total','2026-08-14T07:19:00Z'
),
(
  '00000000-0000-0000-0000-000000014508',
  (select id from app.refunds where idempotency_key='refund-b1'),
  '00000000-0000-0000-0000-000000014101','sandbox','sandbox_simulation','b1-timeout','execution_unknown',
  'not_supplied',null,'TIMEOUT',null,'hash-b1-timeout','2026-08-14T07:20:00Z'
),
(
  '00000000-0000-0000-0000-000000014509',
  (select id from app.refunds where idempotency_key='refund-b1'),
  '00000000-0000-0000-0000-000000014101','sandbox','reconciliation','b1-definitive-failure','definitively_failed',
  'not_supplied',null,'NOT_EXECUTED',null,'hash-b1-failure','2026-08-14T07:21:00Z'
),
(
  '00000000-0000-0000-0000-000000014510',
  (select id from app.refunds where idempotency_key='refund-b2'),
  '00000000-0000-0000-0000-000000014101','sandbox','sandbox_simulation','b2-requested-evidence','processing',
  'not_supplied',null,'PROCESSING',null,'hash-b2-requested','2026-08-14T07:22:00Z'
);

-- Refund A1: unknown is financially inert.
-- 15
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014501'::uuid)$$,'ambiguous refund execution becomes execution_unknown');
-- 16
select is((select state from app.refunds where idempotency_key='refund-a1'),'execution_unknown'::text,'ambiguous evidence moves Refund to execution_unknown');
-- 17
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000014201'),0::bigint,'unknown result does not increment Payment refunded amount');
-- 18
select is((select collection_status from app.payments where id='00000000-0000-0000-0000-000000014201'),'paid'::text,'unknown refund never changes canonical Payment collection truth');
-- 19
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000014001' and environment='sandbox' and account_type='merchant_refund_blocked_liability'),16000::bigint,'unknown result leaves all sandbox refund funding blocked');
-- 20
select is((select count(*)::bigint from app.ledger_transactions where source_type='refund' and source_id=(select id from app.refunds where idempotency_key='refund-a1') and posting_type in ('completed','release_failure')),0::bigint,'unknown refund produces no terminal ledger posting');

-- A1 completion: first partial refund, exactly once.
-- 21
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014502'::uuid)$$,'sandbox completion resolves unknown first partial refund');
-- 22
select is((select state from app.refunds where idempotency_key='refund-a1'),'completed'::text,'first partial Refund becomes completed');
-- 23
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000014201'),3000::bigint,'first partial completion increments Payment refunded total once');
-- 24
select is((select collection_status from app.payments where id='00000000-0000-0000-0000-000000014201'),'paid'::text,'completed refund preserves canonical Payment paid state');
-- 25
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000014001' and environment='sandbox' and account_type='merchant_refund_blocked_liability'),13000::bigint,'first refund completion consumes exactly its blocked funding');
-- 26
select is((select balance_cents from app.accounts where provider_account_id='00000000-0000-0000-0000-000000014101' and environment='sandbox' and account_type='provider_settlement_asset'),(-3000)::bigint,'first refund completion records provider asset outflow');
-- 27
select is((select count(*)::bigint from app.ledger_transactions where source_type='refund' and source_id=(select id from app.refunds where idempotency_key='refund-a1') and posting_type='completed'),1::bigint,'first Refund has one completion ledger transaction');
-- 28
select is((select count(*)::bigint from app.ledger_entries where ledger_transaction_id=(select id from app.ledger_transactions where source_type='refund' and source_id=(select id from app.refunds where idempotency_key='refund-a1') and posting_type='completed')),2::bigint,'merchant-fee-non-refundable completion is a two-entry blocked-to-provider transfer');
-- 29
select is((select count(*)::bigint from app.webhook_events where resource_id=(select id from app.refunds where idempotency_key='refund-a1') and type='refund.completed'),1::bigint,'first refund completion materializes one merchant refund.completed event');
-- 30
select is((select count(*)::bigint from app.webhook_deliveries where webhook_event_id=(select id from app.webhook_events where resource_id=(select id from app.refunds where idempotency_key='refund-a1') and type='refund.completed')),1::bigint,'refund.completed delivery is durable before HTTP');
-- 31
select ok(not ((select payload_snapshot from app.webhook_events where resource_id=(select id from app.refunds where idempotency_key='refund-a1') and type='refund.completed') ? 'provider_account_id'),'public refund.completed payload excludes provider internals');

-- A1 replay/terminal evidence behavior.
-- 32
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014502'::uuid)$$,'same completion evidence replay is idempotent');
-- 33
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000014201'),3000::bigint,'completion replay cannot increment Payment twice');
-- 34
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014503'::uuid)$$,'new evidence confirming completed refund is absorbed');
-- 35
select is((select application_state from app.refund_evidence where id='00000000-0000-0000-0000-000000014503'),'absorbed'::text,'same-terminal refund evidence is marked absorbed');
-- 36
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014504'::uuid)$$,'stale failure after completed refund is retained without rewind');
-- 37
select is((select application_state from app.refund_evidence where id='00000000-0000-0000-0000-000000014504'),'conflict'::text,'contradictory refund terminal evidence is marked conflict');
-- 38
select is((select state from app.refunds where idempotency_key='refund-a1'),'completed'::text,'stale failure cannot rewind completed Refund');
-- 39
select is((select count(*)::bigint from app.ledger_transactions where source_type='refund' and source_id=(select id from app.refunds where idempotency_key='refund-a1') and posting_type='release_failure'),0::bigint,'stale failure cannot release already consumed refund funding');

-- A2: same-value distinct Refund must also complete by refund_id, not by amount.
-- 40
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014505'::uuid)$$,'second distinct equal-value partial Refund completes independently');
-- 41
select is((select state from app.refunds where idempotency_key='refund-a2'),'completed'::text,'second equal-value Refund becomes completed');
-- 42
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000014201'),6000::bigint,'second equal-value Refund adds a second distinct financial movement');
-- 43
select is((select count(*)::bigint from app.ledger_transactions where source_type='refund' and posting_type='completed' and source_id in (select id from app.refunds where idempotency_key in ('refund-a1','refund-a2'))),2::bigint,'equal-value refunds remain two distinct ledger source identities');
-- 44
select is((select balance_cents from app.accounts where provider_account_id='00000000-0000-0000-0000-000000014101' and environment='sandbox' and account_type='provider_settlement_asset'),(-6000)::bigint,'two equal refunds produce two real provider-asset outflows');

-- A3: cumulative total must prove exactly the newly completed Refund delta.
-- 45
select throws_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014506'::uuid)$$,'23514',null,'cumulative total whose newly proven delta differs from Refund amount is rejected');
-- 46
select is((select state from app.refunds where idempotency_key='refund-a3'),'processing'::text,'invalid cumulative total leaves final Refund processing');
-- 47
select is((select application_state from app.refund_evidence where id='00000000-0000-0000-0000-000000014506'),'received'::text,'rejected cumulative evidence remains unapplied for audit');
-- 48
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014507'::uuid)$$,'valid cumulative total completes final Refund');
-- 49
select is((select state from app.refunds where idempotency_key='refund-a3'),'completed'::text,'final Refund reaches completed');
-- 50
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000014201'),10000::bigint,'partial followed by final refund reaches full cumulative Payment amount');
-- 51
select is((select collection_status from app.payments where id='00000000-0000-0000-0000-000000014201'),'paid'::text,'fully refunded projection still does not rewrite Payment collection state');
-- 52
select is((select balance_cents from app.accounts where provider_account_id='00000000-0000-0000-0000-000000014101' and environment='sandbox' and account_type='provider_settlement_asset'),(-10000)::bigint,'full sequence records exact cumulative provider asset outflow');
-- 53
select is((select count(*)::bigint from app.ledger_transactions where source_type='refund' and source_id in (select id from app.refunds where payment_id='00000000-0000-0000-0000-000000014201') and posting_type='completed'),3::bigint,'three first-class Refunds create three completion postings');

-- B1: unknown then definitive failure releases exactly once.
-- 54
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014508'::uuid)$$,'failure-path refund becomes execution_unknown before proof');
-- 55
select is((select state from app.refunds where idempotency_key='refund-b1'),'execution_unknown'::text,'failure-path Refund remains unknown until authoritative proof');
-- 56
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000014202'),0::bigint,'unknown failure path leaves Payment refunded amount unchanged');
-- 57
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000014001' and environment='sandbox' and account_type='merchant_refund_blocked_liability'),6000::bigint,'after Payment A completions, B1 unknown plus B2 requested remain blocked');
-- 58
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014509'::uuid)$$,'authoritative non-execution reconciliation resolves refund as failed');
-- 59
select is((select state from app.refunds where idempotency_key='refund-b1'),'failed'::text,'definitive non-execution marks Refund failed');
-- 60
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000014001' and environment='sandbox' and account_type='merchant_refund_blocked_liability'),1000::bigint,'failed Refund releases only its own blocked funding');
-- 61
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000014001' and environment='sandbox' and account_type='merchant_available_liability'),5000::bigint,'definitive refund failure restores its gross reservation to available');
-- 62
select is((select count(*)::bigint from app.ledger_transactions where source_type='refund' and source_id=(select id from app.refunds where idempotency_key='refund-b1') and posting_type='release_failure'),1::bigint,'definitive refund failure has one release posting');
-- 63
select is((select count(*)::bigint from app.webhook_events where resource_id=(select id from app.refunds where idempotency_key='refund-b1') and type='refund.failed'),1::bigint,'definitive refund failure materializes one refund.failed event');
-- 64
select lives_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014509'::uuid)$$,'failure evidence replay is idempotent');
-- 65
select is((select count(*)::bigint from app.ledger_transactions where source_type='refund' and source_id=(select id from app.refunds where idempotency_key='refund-b1') and posting_type='release_failure'),1::bigint,'failure replay cannot duplicate release posting');

-- Requested refund cannot be resolved through external/simulation evidence boundary.
-- 66
select throws_ok($$select app.apply_refund_evidence('00000000-0000-0000-0000-000000014510'::uuid)$$,'23514',null,'requested Refund cannot be resolved before execution/recovery ownership exists');
-- 67
select is((select state from app.refunds where idempotency_key='refund-b2'),'requested'::text,'rejected pre-execution evidence leaves Refund requested');
-- 68
select is((select application_state from app.refund_evidence where id='00000000-0000-0000-0000-000000014510'),'received'::text,'rejected requested evidence remains unapplied');
-- 69
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000014202'),0::bigint,'pre-execution evidence cannot alter Payment refund projection');
-- 70
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000014001' and environment='production' and account_type='merchant_refund_blocked_liability'),1000::bigint,'Production refund remains blocked and untouched by rejected sandbox simulation');

select * from finish();
rollback;
