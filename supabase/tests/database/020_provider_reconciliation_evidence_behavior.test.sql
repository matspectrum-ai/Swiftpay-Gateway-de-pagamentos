create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(52);

insert into app.providers (id, code, name, status)
values
    ('00000000-0000-0000-0000-000000020001', 'i3a-provider-a', 'I3a Provider A', 'active'),
    ('00000000-0000-0000-0000-000000020002', 'i3a-provider-b', 'I3a Provider B', 'active');

insert into app.provider_accounts (
    id, provider_id, merchant_id, name, environment, status,
    credentials_ciphertext, capabilities, configuration
)
values
    (
        '00000000-0000-0000-0000-000000020101',
        '00000000-0000-0000-0000-000000020001',
        null,
        'I3a Provider A Sandbox',
        'sandbox',
        'active',
        '{"sealed":"sandbox-a"}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb
    ),
    (
        '00000000-0000-0000-0000-000000020102',
        '00000000-0000-0000-0000-000000020001',
        null,
        'I3a Provider A Production',
        'production',
        'active',
        '{"sealed":"production-a"}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb
    ),
    (
        '00000000-0000-0000-0000-000000020103',
        '00000000-0000-0000-0000-000000020002',
        null,
        'I3a Provider B Sandbox',
        'sandbox',
        'active',
        '{"sealed":"sandbox-b"}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb
    );

create temporary table i3a_ids (
    label text primary key,
    id uuid
);

-- Seed one row directly so append-only behavior is independently testable even
-- while the trusted recording function remains a RED stub.
insert into app.provider_reconciliation_evidence (
    provider_id,
    provider_account_id,
    environment,
    source_kind,
    source_reference,
    request_fingerprint,
    evidence_type,
    operation_type,
    client_reference,
    provider_resource_id,
    normalized_outcome,
    amount_cents,
    provider_fee_cents,
    balance_cents,
    currency,
    evidence_window_start,
    evidence_window_end,
    payload_hash,
    raw_evidence_ref,
    observed_at
)
values (
    '00000000-0000-0000-0000-000000020001',
    '00000000-0000-0000-0000-000000020101',
    'sandbox',
    'provider_event',
    'immutable-seed-001',
    'fp:immutable-seed-001:v1',
    'operation_status',
    'payment',
    'client-immutable-001',
    'provider-payment-immutable-001',
    'processing',
    500,
    null,
    null,
    'BRL',
    null,
    null,
    'sha256:immutable-seed-001',
    'protected://i3a/immutable-seed-001',
    '2026-08-14T10:30:00Z'::timestamptz
);

create temporary table i3a_baseline as
select
    (select count(*)::bigint from app.payments) as payments,
    (select count(*)::bigint from app.payouts) as payouts,
    (select count(*)::bigint from app.refunds) as refunds,
    (select count(*)::bigint from app.ledger_transactions) as ledger_transactions,
    (select count(*)::bigint from app.ledger_entries) as ledger_entries,
    (select count(*)::bigint from app.jobs) as jobs,
    (select count(*)::bigint from app.provider_events) as provider_events,
    (select count(*)::bigint from app.payout_evidence) as payout_evidence,
    (select count(*)::bigint from app.refund_evidence) as refund_evidence;

-- Valid normalized operation evidence persists through the trusted boundary.
select lives_ok(
$i3a$
insert into i3a_ids(label, id)
values (
    'sandbox_operation',
    app.record_provider_reconciliation_evidence(
        '00000000-0000-0000-0000-000000020001',
        '00000000-0000-0000-0000-000000020101',
        'sandbox',
        'provider_query',
        'query-payment-001',
        'fp:query-payment-001:v1',
        'operation_status',
        'payment',
        'swiftpay-client-001',
        'provider-payment-001',
        'completed',
        1000,
        10,
        null,
        null,
        null,
        'sha256:query-payment-001:v1',
        'protected://i3a/query-payment-001',
        '2026-08-14T10:31:00Z'::timestamptz
    )
)
$i3a$,
'valid normalized operation evidence records through trusted boundary'
);

select ok((select id is not null from i3a_ids where label='sandbox_operation'), 'recording returns a durable evidence id');
select is((select count(*)::bigint from app.provider_reconciliation_evidence where source_reference='query-payment-001' and environment='sandbox'), 1::bigint, 'valid operation evidence creates exactly one row');
select is((select provider_id from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), '00000000-0000-0000-0000-000000020001'::uuid, 'provider identity is persisted');
select is((select provider_account_id from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), '00000000-0000-0000-0000-000000020101'::uuid, 'provider account identity is persisted');
select is((select environment from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'sandbox', 'environment is persisted');
select is((select source_kind from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'provider_query', 'source kind is persisted');
select is((select source_reference from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'query-payment-001', 'logical source reference is persisted');
select is((select request_fingerprint from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'fp:query-payment-001:v1', 'canonical request fingerprint is persisted');
select is((select evidence_type from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'operation_status', 'evidence type is persisted');
select is((select operation_type from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'payment', 'operation type is persisted');
select is((select client_reference from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'swiftpay-client-001', 'client correlation fact is persisted');
select is((select provider_resource_id from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'provider-payment-001', 'provider resource correlation fact is persisted');
select is((select normalized_outcome from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'completed', 'normalized outcome is persisted');
select is((select amount_cents from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 1000::bigint, 'provider-reported amount uses integer cents');
select is((select provider_fee_cents from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 10::bigint, 'provider-reported fee uses integer cents');
select ok((select balance_cents is null from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'operation evidence does not claim provider balance');
select is((select currency from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'BRL', 'V1 provider evidence currency is BRL');
select is((select payload_hash from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'sha256:query-payment-001:v1', 'payload integrity hash is persisted');
select is((select raw_evidence_ref from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'protected://i3a/query-payment-001', 'protected raw evidence reference is persisted');
select is((select observed_at from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), '2026-08-14T10:31:00Z'::timestamptz, 'provider fact observation time is persisted');
select ok((select evidence_window_start is null and evidence_window_end is null from app.provider_reconciliation_evidence where id=(select id from i3a_ids where label='sandbox_operation')), 'point operation evidence has no invented report window');

-- Exact replay is idempotent.
select lives_ok(
$i3a$
insert into i3a_ids(label, id)
values (
    'sandbox_operation_replay',
    app.record_provider_reconciliation_evidence(
        '00000000-0000-0000-0000-000000020001',
        '00000000-0000-0000-0000-000000020101',
        'sandbox',
        'provider_query',
        'query-payment-001',
        'fp:query-payment-001:v1',
        'operation_status',
        'payment',
        'swiftpay-client-001',
        'provider-payment-001',
        'completed',
        1000,
        10,
        null,
        null,
        null,
        'sha256:query-payment-001:v1',
        'protected://i3a/query-payment-001',
        '2026-08-14T10:31:00Z'::timestamptz
    )
)
$i3a$,
'exact provider evidence replay must execute idempotently'
);
select is((select id from i3a_ids where label='sandbox_operation_replay'), (select id from i3a_ids where label='sandbox_operation'), 'exact replay returns the original evidence id');
select is((select count(*)::bigint from app.provider_reconciliation_evidence where source_reference='query-payment-001' and environment='sandbox'), 1::bigint, 'exact replay does not duplicate durable evidence');

select throws_ok(
$i3a$
select app.record_provider_reconciliation_evidence(
    '00000000-0000-0000-0000-000000020001',
    '00000000-0000-0000-0000-000000020101',
    'sandbox',
    'provider_query',
    'query-payment-001',
    'fp:query-payment-001:changed',
    'operation_status',
    'payment',
    'swiftpay-client-001',
    'provider-payment-001',
    'completed',
    1000,
    10,
    null,
    null,
    null,
    'sha256:query-payment-001:changed',
    'protected://i3a/query-payment-001',
    '2026-08-14T10:31:00Z'::timestamptz
)
$i3a$,
'23505',
null,
'same logical source with changed fingerprint conflicts instead of overwriting history'
);

-- Provider/account/environment ownership is fail-closed.
select throws_ok(
$i3a$
select app.record_provider_reconciliation_evidence(
    '00000000-0000-0000-0000-000000020002',
    '00000000-0000-0000-0000-000000020101',
    'sandbox',
    'provider_query',
    'provider-mismatch-001',
    'fp:provider-mismatch-001',
    'operation_status',
    'payment',
    null,
    'provider-payment-mismatch-001',
    'processing',
    100,
    null,
    null,
    null,
    null,
    'sha256:provider-mismatch-001',
    null,
    '2026-08-14T10:32:00Z'::timestamptz
)
$i3a$,
'23514',
null,
'provider account belonging to another provider is rejected'
);

select throws_ok(
$i3a$
select app.record_provider_reconciliation_evidence(
    '00000000-0000-0000-0000-000000020001',
    '00000000-0000-0000-0000-000000020101',
    'production',
    'provider_query',
    'environment-mismatch-001',
    'fp:environment-mismatch-001',
    'operation_status',
    'payment',
    null,
    'provider-payment-environment-001',
    'processing',
    100,
    null,
    null,
    null,
    null,
    'sha256:environment-mismatch-001',
    null,
    '2026-08-14T10:32:00Z'::timestamptz
)
$i3a$,
'23514',
null,
'provider account from another environment is rejected'
);

-- Shape validation remains fail-closed through the function boundary.
select throws_ok(
$i3a$
select app.record_provider_reconciliation_evidence(
    '00000000-0000-0000-0000-000000020001',
    '00000000-0000-0000-0000-000000020101',
    'sandbox',
    'invented_source',
    'invalid-source-001',
    'fp:invalid-source-001',
    'operation_status',
    'payment',
    null,
    null,
    'processing',
    100,
    null,
    null,
    null,
    null,
    'sha256:invalid-source-001',
    null,
    '2026-08-14T10:33:00Z'::timestamptz
)
$i3a$,
'23514',
null,
'unrecognized provider evidence source kind is rejected'
);

select throws_ok(
$i3a$
select app.record_provider_reconciliation_evidence(
    '00000000-0000-0000-0000-000000020001',
    '00000000-0000-0000-0000-000000020101',
    'sandbox',
    'balance_snapshot',
    'invalid-balance-shape-001',
    'fp:invalid-balance-shape-001',
    'provider_balance',
    'payment',
    null,
    null,
    null,
    null,
    null,
    1000,
    '2026-08-14T10:00:00Z'::timestamptz,
    '2026-08-14T10:30:00Z'::timestamptz,
    'sha256:invalid-balance-shape-001',
    null,
    '2026-08-14T10:34:00Z'::timestamptz
)
$i3a$,
'23514',
null,
'provider balance evidence cannot claim an operation type'
);

select throws_ok(
$i3a$
select app.record_provider_reconciliation_evidence(
    '00000000-0000-0000-0000-000000020001',
    '00000000-0000-0000-0000-000000020101',
    'sandbox',
    'provider_query',
    'invalid-operation-balance-001',
    'fp:invalid-operation-balance-001',
    'operation_status',
    'payment',
    null,
    null,
    'processing',
    100,
    null,
    5000,
    null,
    null,
    'sha256:invalid-operation-balance-001',
    null,
    '2026-08-14T10:34:00Z'::timestamptz
)
$i3a$,
'23514',
null,
'operation evidence cannot claim provider balance'
);

select throws_ok(
$i3a$
select app.record_provider_reconciliation_evidence(
    '00000000-0000-0000-0000-000000020001',
    '00000000-0000-0000-0000-000000020101',
    'sandbox',
    'statement_export',
    'invalid-window-001',
    'fp:invalid-window-001',
    'settlement_item',
    'payment',
    null,
    'provider-payment-window-001',
    'completed',
    100,
    1,
    null,
    '2026-08-14T10:30:00Z'::timestamptz,
    '2026-08-14T10:00:00Z'::timestamptz,
    'sha256:invalid-window-001',
    null,
    '2026-08-14T10:35:00Z'::timestamptz
)
$i3a$,
'23514',
null,
'report evidence window ending before it starts is rejected'
);

-- Identical external source text in Production is a distinct scoped identity.
select lives_ok(
$i3a$
insert into i3a_ids(label, id)
values (
    'production_operation',
    app.record_provider_reconciliation_evidence(
        '00000000-0000-0000-0000-000000020001',
        '00000000-0000-0000-0000-000000020102',
        'production',
        'provider_query',
        'query-payment-001',
        'fp:query-payment-001:production:v1',
        'operation_status',
        'payment',
        'swiftpay-client-production-001',
        'provider-payment-production-001',
        'processing',
        1000,
        null,
        null,
        null,
        null,
        'sha256:query-payment-production-001:v1',
        'protected://i3a/production/query-payment-001',
        '2026-08-14T10:36:00Z'::timestamptz
    )
)
$i3a$,
'identical source reference text may be recorded independently in Production'
);
select isnt((select id from i3a_ids where label='production_operation'), (select id from i3a_ids where label='sandbox_operation'), 'Sandbox and Production evidence have distinct durable ids');
select is((select count(*)::bigint from app.provider_reconciliation_evidence where source_reference='query-payment-001'), 2::bigint, 'same source reference text remains isolated by provider account/environment scope');

-- Disabled accounts remain reconcilable for historical operations.
update app.provider_accounts
   set status='disabled'
 where id='00000000-0000-0000-0000-000000020101';

select lives_ok(
$i3a$
insert into i3a_ids(label, id)
values (
    'disabled_account_history',
    app.record_provider_reconciliation_evidence(
        '00000000-0000-0000-0000-000000020001',
        '00000000-0000-0000-0000-000000020101',
        'sandbox',
        'provider_query',
        'historical-disabled-account-001',
        'fp:historical-disabled-account-001',
        'operation_status',
        'payout',
        'historical-client-001',
        'historical-provider-payout-001',
        'completed',
        700,
        5,
        null,
        null,
        null,
        'sha256:historical-disabled-account-001',
        'protected://i3a/historical-disabled-account-001',
        '2026-08-14T10:37:00Z'::timestamptz
    )
)
$i3a$,
'disabled provider account remains eligible for historical reconciliation evidence'
);
select is((select count(*)::bigint from app.provider_reconciliation_evidence where source_reference='historical-disabled-account-001'), 1::bigint, 'historical evidence is retained after routing deactivation');

-- Valid provider balance snapshot persists without operation semantics.
select lives_ok(
$i3a$
insert into i3a_ids(label, id)
values (
    'sandbox_balance',
    app.record_provider_reconciliation_evidence(
        '00000000-0000-0000-0000-000000020001',
        '00000000-0000-0000-0000-000000020101',
        'sandbox',
        'balance_snapshot',
        'balance-window-001',
        'fp:balance-window-001',
        'provider_balance',
        null,
        null,
        null,
        null,
        null,
        null,
        500000,
        '2026-08-14T10:00:00Z'::timestamptz,
        '2026-08-14T10:30:00Z'::timestamptz,
        'sha256:balance-window-001',
        'protected://i3a/balance-window-001',
        '2026-08-14T10:38:00Z'::timestamptz
    )
)
$i3a$,
'valid provider balance snapshot records through trusted boundary'
);
select ok(
    (
        select evidence_type='provider_balance'
           and operation_type is null
           and normalized_outcome is null
           and amount_cents is null
           and provider_fee_cents is null
           and balance_cents=500000
           and evidence_window_start='2026-08-14T10:00:00Z'::timestamptz
           and evidence_window_end='2026-08-14T10:30:00Z'::timestamptz
        from app.provider_reconciliation_evidence
        where id=(select id from i3a_ids where label='sandbox_balance')
    ),
    'provider balance snapshot preserves only balance/window facts'
);

-- Recording external evidence is side-effect-free outside its own append-only table.
select is((select count(*)::bigint from app.payments), (select payments from i3a_baseline), 'provider reconciliation evidence recording does not create or mutate Payment resources');
select is((select count(*)::bigint from app.payouts), (select payouts from i3a_baseline), 'provider reconciliation evidence recording does not create or mutate Payout resources');
select is((select count(*)::bigint from app.refunds), (select refunds from i3a_baseline), 'provider reconciliation evidence recording does not create or mutate Refund resources');
select is((select count(*)::bigint from app.ledger_transactions), (select ledger_transactions from i3a_baseline), 'provider reconciliation evidence recording creates no ledger transaction');
select is((select count(*)::bigint from app.ledger_entries), (select ledger_entries from i3a_baseline), 'provider reconciliation evidence recording creates no ledger entry');
select is((select count(*)::bigint from app.jobs), (select jobs from i3a_baseline), 'provider reconciliation evidence recording enqueues no job');
select is((select count(*)::bigint from app.provider_events), (select provider_events from i3a_baseline), 'provider reconciliation recording does not mutate provider event evidence');
select is((select count(*)::bigint from app.payout_evidence), (select payout_evidence from i3a_baseline), 'provider reconciliation recording does not mutate payout evidence');
select is((select count(*)::bigint from app.refund_evidence), (select refund_evidence from i3a_baseline), 'provider reconciliation recording does not mutate refund evidence');

-- Provider reconciliation evidence history is append-only.
select throws_ok(
$i3a$
update app.provider_reconciliation_evidence
   set payload_hash='sha256:mutated'
 where source_reference='immutable-seed-001'
   and environment='sandbox'
$i3a$,
'55000',
null,
'persisted provider reconciliation evidence cannot be updated'
);

select throws_ok(
$i3a$
delete from app.provider_reconciliation_evidence
 where source_reference='immutable-seed-001'
   and environment='sandbox'
$i3a$,
'55000',
null,
'persisted provider reconciliation evidence cannot be deleted'
);

select is((select count(*)::bigint from app.provider_reconciliation_evidence where source_reference='immutable-seed-001'), 1::bigint, 'append-only seed survives rejected mutation attempts');
select is((select count(*)::bigint from app.provider_reconciliation_evidence), 5::bigint, 'behavioral scenario leaves exactly five independent evidence facts');

select * from finish();
rollback;
