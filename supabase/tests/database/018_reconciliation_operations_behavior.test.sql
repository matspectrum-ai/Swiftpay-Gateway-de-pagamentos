create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(87);

insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000018001', 'I2 Reconciliation Merchant', 'active');

select app.ensure_account(
    '00000000-0000-0000-0000-000000018001', null,
    'sandbox', 'BRL', 'merchant_available_liability'
);
select app.ensure_account(
    '00000000-0000-0000-0000-000000018001', null,
    'production', 'BRL', 'merchant_available_liability'
);

create temporary table i2_ids (
    label text primary key,
    id uuid
);

create temporary table i2_baseline as
select
    (select count(*)::bigint from app.ledger_transactions) as ledger_transactions,
    (select count(*)::bigint from app.ledger_entries) as ledger_entries,
    (select count(*)::bigint from app.jobs) as jobs;

-- Coherent environment still creates a durable completed zero-finding run.
select lives_ok(
$i2$
insert into i2_ids(label, id)
values (
  'zero_run',
  app.capture_internal_reconciliation_run(
    'sandbox', 'i2-test-v1', '{"mode":"full_internal"}'::jsonb,
    '2026-08-14T10:00:00Z'::timestamptz,
    '2026-08-14T10:00:01Z'::timestamptz
  )
)
$i2$,
'zero-finding internal reconciliation capture must execute'
);

select ok((select id is not null from i2_ids where label='zero_run'), 'zero-finding run returns a durable id');
select is((select status from app.reconciliation_runs where id=(select id from i2_ids where label='zero_run')), 'completed', 'zero-finding run is completed');
select is((select layer from app.reconciliation_runs where id=(select id from i2_ids where label='zero_run')), 'internal', 'internal capture persists the internal layer');
select is((select environment from app.reconciliation_runs where id=(select id from i2_ids where label='zero_run')), 'sandbox', 'run environment is explicit');
select is((select detector_version from app.reconciliation_runs where id=(select id from i2_ids where label='zero_run')), 'i2-test-v1', 'run detector version is frozen');
select is((select scope from app.reconciliation_runs where id=(select id from i2_ids where label='zero_run')), '{"mode":"full_internal"}'::jsonb, 'run scope snapshot is durable');
select is((select finding_count from app.reconciliation_runs where id=(select id from i2_ids where label='zero_run')), 0::bigint, 'coherent environment records zero findings');
select is((select count(*)::bigint from app.reconciliation_run_observations where run_id=(select id from i2_ids where label='zero_run')), 0::bigint, 'zero-finding run has no observations');
select is((select count(*)::bigint from app.reconciliation_discrepancies), 0::bigint, 'zero-finding run creates no discrepancy');

-- Deliberate cache drift creates one logical finding.
update app.accounts
   set balance_cents = 100
 where merchant_id='00000000-0000-0000-0000-000000018001'
   and environment='sandbox'
   and account_type='merchant_available_liability';

select lives_ok(
$i2$
insert into i2_ids(label, id)
values (
  'sandbox_run_1',
  app.capture_internal_reconciliation_run(
    'sandbox', 'i2-test-v1', '{"mode":"full_internal"}'::jsonb,
    '2026-08-14T10:01:00Z'::timestamptz,
    '2026-08-14T10:01:01Z'::timestamptz
  )
)
$i2$,
'first discrepant Sandbox capture must execute'
);

select is((select finding_count from app.reconciliation_runs where id=(select id from i2_ids where label='sandbox_run_1')), 1::bigint, 'first discrepant run records one finding');
select is((select count(*)::bigint from app.reconciliation_run_observations where run_id=(select id from i2_ids where label='sandbox_run_1')), 1::bigint, 'first discrepant run records one immutable observation');
select is((select count(*)::bigint from app.reconciliation_discrepancies where environment='sandbox'), 1::bigint, 'first finding creates one durable Sandbox discrepancy');
select is(
  (select stable_key from app.reconciliation_discrepancies where environment='sandbox'),
  'account_cache:sandbox:' || (
      select id::text from app.accounts
       where merchant_id='00000000-0000-0000-0000-000000018001'
         and environment='sandbox'
         and account_type='merchant_available_liability'
  ),
  'durable discrepancy preserves detector stable key'
);
select is((select lifecycle_state from app.reconciliation_discrepancies where environment='sandbox'), 'open', 'new discrepancy starts open');
select is((select occurrence_count from app.reconciliation_discrepancies where environment='sandbox'), 1::bigint, 'first observation starts occurrence count at one');
select is((select first_run_id from app.reconciliation_discrepancies where environment='sandbox'), (select id from i2_ids where label='sandbox_run_1'), 'first observing run is frozen');
select is((select last_run_id from app.reconciliation_discrepancies where environment='sandbox'), (select id from i2_ids where label='sandbox_run_1'), 'first observation is also latest run');
select is((select first_seen_at from app.reconciliation_discrepancies where environment='sandbox'), '2026-08-14T10:01:01Z'::timestamptz, 'first-seen time uses capture observation time');
select is((select last_seen_at from app.reconciliation_discrepancies where environment='sandbox'), '2026-08-14T10:01:01Z'::timestamptz, 'last-seen time starts at first observation');
select is((select expected_cents from app.reconciliation_discrepancies where environment='sandbox'), 0::bigint, 'cache discrepancy persists rebuilt expected cents');
select is((select actual_cents from app.reconciliation_discrepancies where environment='sandbox'), 100::bigint, 'cache discrepancy persists cached actual cents');
select ok(
  (select detail ? 'accountType' and detail ? 'deltaCents' from app.reconciliation_discrepancies where environment='sandbox'),
  'durable discrepancy persists operational non-secret detail'
);
select ok(
  (select o.stable_key = d.stable_key and o.expected_cents = d.expected_cents and o.actual_cents = d.actual_cents
     from app.reconciliation_run_observations o
     join app.reconciliation_discrepancies d on d.id=o.discrepancy_id
    where o.run_id=(select id from i2_ids where label='sandbox_run_1')),
  'run observation preserves the detector snapshot linked to stable discrepancy identity'
);
select is(
  (select balance_cents from app.accounts
    where merchant_id='00000000-0000-0000-0000-000000018001'
      and environment='sandbox'
      and account_type='merchant_available_liability'),
  100::bigint,
  'capture never repairs account drift'
);
select is((select count(*)::bigint from app.ledger_transactions), (select ledger_transactions from i2_baseline), 'capture creates no ledger transaction');
select is((select count(*)::bigint from app.ledger_entries), (select ledger_entries from i2_baseline), 'capture creates no ledger entry');
select is((select count(*)::bigint from app.jobs), (select jobs from i2_baseline), 'capture creates no background financial job');

-- Rediscovery creates a new run/observation but reuses durable discrepancy id.
select lives_ok(
$i2$
insert into i2_ids(label, id)
values (
  'sandbox_run_2',
  app.capture_internal_reconciliation_run(
    'sandbox', 'i2-test-v1', '{"mode":"full_internal"}'::jsonb,
    '2026-08-14T10:02:00Z'::timestamptz,
    '2026-08-14T10:02:01Z'::timestamptz
  )
)
$i2$,
'second Sandbox capture must execute'
);
select isnt((select id from i2_ids where label='sandbox_run_2'), (select id from i2_ids where label='sandbox_run_1'), 'reconciliation runs remain distinct executions');
select is((select count(*)::bigint from app.reconciliation_discrepancies where environment='sandbox'), 1::bigint, 'rediscovery reuses one logical discrepancy');
select is((select occurrence_count from app.reconciliation_discrepancies where environment='sandbox'), 2::bigint, 'rediscovery increments occurrence count');
select is((select first_run_id from app.reconciliation_discrepancies where environment='sandbox'), (select id from i2_ids where label='sandbox_run_1'), 'rediscovery preserves first run');
select is((select last_run_id from app.reconciliation_discrepancies where environment='sandbox'), (select id from i2_ids where label='sandbox_run_2'), 'rediscovery advances last run');
select is((select first_seen_at from app.reconciliation_discrepancies where environment='sandbox'), '2026-08-14T10:01:01Z'::timestamptz, 'rediscovery preserves first-seen time');
select is((select last_seen_at from app.reconciliation_discrepancies where environment='sandbox'), '2026-08-14T10:02:01Z'::timestamptz, 'rediscovery advances last-seen time');
select is((select count(*)::bigint from app.reconciliation_run_observations where discrepancy_id=(select id from app.reconciliation_discrepancies where environment='sandbox')), 2::bigint, 'each rediscovery remains an immutable run observation');

-- Explicit acknowledgement is idempotent and append-only.
select lives_ok(
$i2$
select app.acknowledge_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='sandbox'),
  'operator', 'ops-018', 'investigating cache drift',
  '2026-08-14T10:03:00Z'::timestamptz
)
$i2$,
'open discrepancy acknowledgement must execute'
);
select is((select lifecycle_state from app.reconciliation_discrepancies where environment='sandbox'), 'acknowledged', 'acknowledgement changes only operator lifecycle state');
select ok(
  (select acknowledged_at='2026-08-14T10:03:00Z'::timestamptz
       and acknowledged_by_actor_type='operator'
       and acknowledged_by_actor_id='ops-018'
       and acknowledgement_note='investigating cache drift'
     from app.reconciliation_discrepancies where environment='sandbox'),
  'acknowledgement persists explicit actor/time/note metadata'
);
select is((select count(*)::bigint from app.reconciliation_discrepancy_events where event_type='acknowledged'), 1::bigint, 'acknowledgement appends exactly one lifecycle event');
select ok(
  (select actor_type='operator' and actor_id='ops-018' and note='investigating cache drift' and resolution_code is null
     from app.reconciliation_discrepancy_events where event_type='acknowledged'),
  'acknowledgement event preserves explicit non-secret operator context'
);
select lives_ok(
$i2$
select app.acknowledge_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='sandbox'),
  'operator', 'ops-018', 'investigating cache drift',
  '2026-08-14T10:03:00Z'::timestamptz
)
$i2$,
'repeating identical acknowledgement must be idempotent'
);
select is((select count(*)::bigint from app.reconciliation_discrepancy_events where event_type='acknowledged'), 1::bigint, 'idempotent acknowledgement does not append a duplicate event');

select lives_ok(
$i2$
insert into i2_ids(label, id)
values (
  'sandbox_run_3',
  app.capture_internal_reconciliation_run(
    'sandbox', 'i2-test-v1', '{"mode":"full_internal"}'::jsonb,
    '2026-08-14T10:04:00Z'::timestamptz,
    '2026-08-14T10:04:01Z'::timestamptz
  )
)
$i2$,
'rediscovery after acknowledgement must execute'
);
select is((select lifecycle_state from app.reconciliation_discrepancies where environment='sandbox'), 'acknowledged', 'rediscovery never downgrades acknowledged lifecycle state');
select is((select occurrence_count from app.reconciliation_discrepancies where environment='sandbox'), 3::bigint, 'acknowledged discrepancy still records rediscovery');

-- Absence in a later run never auto-resolves.
update app.accounts
   set balance_cents = 0
 where merchant_id='00000000-0000-0000-0000-000000018001'
   and environment='sandbox'
   and account_type='merchant_available_liability';

select lives_ok(
$i2$
insert into i2_ids(label, id)
values (
  'sandbox_clear_run',
  app.capture_internal_reconciliation_run(
    'sandbox', 'i2-test-v1', '{"mode":"full_internal"}'::jsonb,
    '2026-08-14T10:05:00Z'::timestamptz,
    '2026-08-14T10:05:01Z'::timestamptz
  )
)
$i2$,
'capture after finding disappears must execute'
);
select is((select finding_count from app.reconciliation_runs where id=(select id from i2_ids where label='sandbox_clear_run')), 0::bigint, 'later coherent run records zero observations');
select is((select lifecycle_state from app.reconciliation_discrepancies where environment='sandbox'), 'acknowledged', 'finding disappearance does not silently resolve discrepancy');
select is((select occurrence_count from app.reconciliation_discrepancies where environment='sandbox'), 3::bigint, 'finding disappearance does not increment occurrence count');

-- Explicit resolution remains operational metadata only.
select lives_ok(
$i2$
select app.resolve_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='sandbox'),
  'operator', 'ops-018', 'verified_test_drift', 'fixture drift confirmed',
  '2026-08-14T10:06:00Z'::timestamptz
)
$i2$,
'acknowledged discrepancy resolution must execute'
);
select is((select lifecycle_state from app.reconciliation_discrepancies where environment='sandbox'), 'resolved', 'resolution moves discrepancy to resolved');
select ok(
  (select resolved_at='2026-08-14T10:06:00Z'::timestamptz
       and resolved_by_actor_type='operator'
       and resolved_by_actor_id='ops-018'
       and resolution_code='verified_test_drift'
       and resolution_note='fixture drift confirmed'
     from app.reconciliation_discrepancies where environment='sandbox'),
  'resolution persists actor/code/note metadata'
);
select is((select count(*)::bigint from app.reconciliation_discrepancy_events), 2::bigint, 'resolution appends one event after acknowledgement');
select ok(
  (select actor_type='operator' and actor_id='ops-018'
       and resolution_code='verified_test_drift' and note='fixture drift confirmed'
     from app.reconciliation_discrepancy_events where event_type='resolved'),
  'resolution event preserves explicit operator context'
);
select lives_ok(
$i2$
select app.resolve_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='sandbox'),
  'operator', 'ops-018', 'verified_test_drift', 'fixture drift confirmed',
  '2026-08-14T10:06:00Z'::timestamptz
)
$i2$,
'repeating identical resolution must be idempotent'
);
select is((select count(*)::bigint from app.reconciliation_discrepancy_events), 2::bigint, 'idempotent resolution appends no duplicate lifecycle event');
select throws_ok(
$i2$
select app.resolve_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='sandbox'),
  'operator', 'ops-018', 'different_resolution', 'conflicting resolution',
  '2026-08-14T10:06:30Z'::timestamptz
)
$i2$,
'23514', null,
'conflicting resolution metadata is rejected'
);
select throws_ok(
$i2$
select app.acknowledge_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='sandbox'),
  'operator', 'ops-018', 'cannot reopen resolved',
  '2026-08-14T10:06:30Z'::timestamptz
)
$i2$,
'23514', null,
'resolved discrepancy cannot be acknowledged/reopened'
);

-- Rediscovery after resolution keeps the durable case resolved.
update app.accounts
   set balance_cents = 100
 where merchant_id='00000000-0000-0000-0000-000000018001'
   and environment='sandbox'
   and account_type='merchant_available_liability';

select lives_ok(
$i2$
insert into i2_ids(label, id)
values (
  'sandbox_run_4',
  app.capture_internal_reconciliation_run(
    'sandbox', 'i2-test-v1', '{"mode":"full_internal"}'::jsonb,
    '2026-08-14T10:07:00Z'::timestamptz,
    '2026-08-14T10:07:01Z'::timestamptz
  )
)
$i2$,
'rediscovery after resolution must execute'
);
select is((select lifecycle_state from app.reconciliation_discrepancies where environment='sandbox'), 'resolved', 'rediscovery never reopens a resolved discrepancy');
select is((select occurrence_count from app.reconciliation_discrepancies where environment='sandbox'), 4::bigint, 'resolved discrepancy remains traceable across rediscovery');
select is((select finding_count from app.reconciliation_runs where id=(select id from i2_ids where label='sandbox_run_4')), 1::bigint, 'resolved rediscovery remains visible in the new run');

-- Production capture is isolated from Sandbox.
update app.accounts
   set balance_cents = 200
 where merchant_id='00000000-0000-0000-0000-000000018001'
   and environment='production'
   and account_type='merchant_available_liability';

select lives_ok(
$i2$
insert into i2_ids(label, id)
values (
  'production_run',
  app.capture_internal_reconciliation_run(
    'production', 'i2-test-v1', '{"mode":"full_internal"}'::jsonb,
    '2026-08-14T10:08:00Z'::timestamptz,
    '2026-08-14T10:08:01Z'::timestamptz
  )
)
$i2$,
'Production reconciliation capture must execute'
);
select is((select finding_count from app.reconciliation_runs where id=(select id from i2_ids where label='production_run')), 1::bigint, 'Production run captures only Production finding');
select is((select count(*)::bigint from app.reconciliation_discrepancies where environment='production'), 1::bigint, 'Production finding receives its own durable discrepancy');
select is((select count(*)::bigint from app.reconciliation_discrepancies where environment='sandbox'), 1::bigint, 'Production capture does not duplicate Sandbox discrepancy');
select is((select occurrence_count from app.reconciliation_discrepancies where environment='sandbox'), 4::bigint, 'Production capture does not touch Sandbox occurrence count');
select isnt(
  (select id from app.reconciliation_discrepancies where environment='production'),
  (select id from app.reconciliation_discrepancies where environment='sandbox'),
  'Production and Sandbox never share discrepancy durable identity'
);

-- Invalid capture/lifecycle requests fail closed.
select throws_ok(
  $$select app.capture_internal_reconciliation_run('staging','i2-test-v1','{}'::jsonb,'2026-08-14T10:09:00Z','2026-08-14T10:09:01Z')$$,
  '23514', null,
  'invalid reconciliation environment is rejected'
);
select throws_ok(
  $$select app.capture_internal_reconciliation_run('sandbox','','{}'::jsonb,'2026-08-14T10:09:00Z','2026-08-14T10:09:01Z')$$,
  '23514', null,
  'empty detector version is rejected'
);
select throws_ok(
  $$select app.capture_internal_reconciliation_run('sandbox','i2-test-v1','[]'::jsonb,'2026-08-14T10:09:00Z','2026-08-14T10:09:01Z')$$,
  '23514', null,
  'non-object reconciliation scope is rejected'
);
select throws_ok(
  $$select app.capture_internal_reconciliation_run('sandbox','i2-test-v1','{}'::jsonb,'2026-08-14T10:09:02Z','2026-08-14T10:09:01Z')$$,
  '23514', null,
  'capture completion before start is rejected'
);
select throws_ok(
$i2$
select app.acknowledge_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='production'),
  'operator', '', 'bad actor',
  '2026-08-14T10:09:30Z'::timestamptz
)
$i2$,
'23514', null,
'empty acknowledgement actor identity is rejected'
);
select throws_ok(
$i2$
select app.resolve_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='production'),
  'operator', 'ops-018', '', 'missing code',
  '2026-08-14T10:09:30Z'::timestamptz
)
$i2$,
'23514', null,
'empty resolution code is rejected'
);

-- Lifecycle events and run observations are append-only even to trusted SQL.
select lives_ok(
$i2$
select app.acknowledge_reconciliation_discrepancy(
  (select id from app.reconciliation_discrepancies where environment='production'),
  'operator', 'ops-018', 'reviewing production fixture',
  '2026-08-14T10:10:00Z'::timestamptz
)
$i2$,
'Production discrepancy can be acknowledged for append-only tests'
);
select throws_ok(
  $$update app.reconciliation_discrepancy_events set note='mutated' where event_type='acknowledged' and actor_id='ops-018'$$,
  '23514', null,
  'lifecycle event rows are immutable after append'
);
select throws_ok(
  $$delete from app.reconciliation_discrepancy_events where event_type='acknowledged' and actor_id='ops-018'$$,
  '23514', null,
  'lifecycle event rows cannot be deleted'
);
select throws_ok(
  $$update app.reconciliation_run_observations set actual_cents=999 where run_id=(select id from i2_ids where label='production_run')$$,
  '23514', null,
  'run observation rows are immutable after capture'
);
select throws_ok(
  $$delete from app.reconciliation_run_observations where run_id=(select id from i2_ids where label='production_run')$$,
  '23514', null,
  'run observation rows cannot be deleted'
);

-- No I2 operation creates financial history or background work.
select is((select count(*)::bigint from app.ledger_transactions), (select ledger_transactions from i2_baseline), 'I2 lifecycle creates no ledger transaction');
select is((select count(*)::bigint from app.ledger_entries), (select ledger_entries from i2_baseline), 'I2 lifecycle creates no ledger entry');
select is((select count(*)::bigint from app.jobs), (select jobs from i2_baseline), 'I2 lifecycle creates no job');
select is(
  (select balance_cents from app.accounts
    where merchant_id='00000000-0000-0000-0000-000000018001'
      and environment='sandbox'
      and account_type='merchant_available_liability'),
  100::bigint,
  'I2 does not repair Sandbox account balance'
);
select is(
  (select balance_cents from app.accounts
    where merchant_id='00000000-0000-0000-0000-000000018001'
      and environment='production'
      and account_type='merchant_available_liability'),
  200::bigint,
  'I2 does not repair Production account balance'
);

select * from finish();
rollback;
