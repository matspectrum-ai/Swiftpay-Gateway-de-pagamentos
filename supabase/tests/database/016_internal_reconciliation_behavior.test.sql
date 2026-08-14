create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(47);

-- Coherent baseline: one paid Payment, one reserved Payout and one reserved Refund.
-- All mutations use existing canonical financial commands except where this test
-- deliberately simulates corruption/drift that reconciliation must detect.
insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000016001', 'Reconciliation Merchant', 'active');

insert into app.payments (
    id, merchant_id, environment, source, collection_status,
    amount_cents, currency, pricing_version, rounding_policy_version,
    merchant_fee_cents, merchant_net_cents, refunded_amount_cents,
    refund_fee_policy, paid_at
) values (
    '00000000-0000-0000-0000-000000016100',
    '00000000-0000-0000-0000-000000016001',
    'sandbox', 'api', 'paid',
    10000, 'BRL', 'test-v1', 'test-v1',
    1000, 9000, 0,
    'merchant_fee_non_refundable', '2026-08-14T08:00:00Z'
);

select app.ensure_account(
    '00000000-0000-0000-0000-000000016001', null,
    'sandbox', 'BRL', 'merchant_available_liability'
);
select app.ensure_account(
    '00000000-0000-0000-0000-000000016001', null,
    'sandbox', 'BRL', 'merchant_risk_reserved_liability'
);
select app.ensure_account(null, null, 'sandbox', 'BRL', 'payment_fee_revenue');
select app.ensure_account(null, null, 'sandbox', 'BRL', 'provider_payment_fee_expense');

select app.post_ledger_transaction(
    'sandbox',
    'test_seed',
    '00000000-0000-0000-0000-000000016010',
    'seed_available',
    jsonb_build_array(
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id = '00000000-0000-0000-0000-000000016001'
                  and environment = 'sandbox'
                  and account_type = 'merchant_available_liability'
            ),
            'direction', 'credit',
            'amount_cents', 30000
        ),
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null
                  and provider_account_id is null
                  and environment = 'sandbox'
                  and account_type = 'payment_fee_revenue'
            ),
            'direction', 'debit',
            'amount_cents', 30000
        )
    )
);

create temporary table reconciliation_fixture_ids (
    fixture text primary key,
    id uuid not null
);

insert into reconciliation_fixture_ids (fixture, id)
values (
    'payout_missing',
    app.reserve_payout(
        '00000000-0000-0000-0000-000000016001',
        'sandbox', 'BRL', 5000, 100,
        '{"pix_key":"masked-reconciliation-destination"}'::jsonb,
        'recon-payout-missing', 'recon-payout-missing-fp',
        '2026-08-14T08:01:00Z'
    )
);

insert into reconciliation_fixture_ids (fixture, id)
values (
    'refund_missing',
    app.reserve_refund(
        '00000000-0000-0000-0000-000000016100',
        '00000000-0000-0000-0000-000000016001',
        'sandbox', 3000,
        'recon-refund-missing', 'recon-refund-missing-fp',
        '2026-08-14T08:02:00Z'
    )
);

-- Baseline parity.
select is(
    (select count(*)::bigint from app.reconciliation_account_cache),
    (select count(*)::bigint from app.accounts),
    'every canonical account participates in cache reconciliation'
);

select is(
    (select coalesce(bool_and(is_consistent), false) from app.reconciliation_account_cache),
    true,
    'canonical financial commands leave every account cache consistent with ledger entries'
);

select is(
    (select count(*)::bigint from app.reconciliation_expected_postings),
    2::bigint,
    'reserved Payout and Refund each require exactly one reservation posting'
);

select ok(
    exists(
        select 1 from app.reconciliation_expected_postings
        where environment = 'sandbox'
          and source_type = 'payout'
          and source_id = (select id from reconciliation_fixture_ids where fixture = 'payout_missing')
          and posting_type = 'reservation'
          and resource_state = 'requested'
    ),
    'Payout reservation expectation preserves source identity and canonical state'
);

select ok(
    exists(
        select 1 from app.reconciliation_expected_postings
        where environment = 'sandbox'
          and source_type = 'refund'
          and source_id = (select id from reconciliation_fixture_ids where fixture = 'refund_missing')
          and posting_type = 'reservation'
          and resource_state = 'requested'
    ),
    'Refund reservation expectation preserves source identity and canonical state'
);

select is(
    (select cached_refunded_amount_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'),
    0::bigint,
    'refund projection exposes canonical Payment cached refunded amount'
);

select is(
    (select rebuilt_refunded_amount_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'),
    0::bigint,
    'refund projection rebuilds zero before any Refund is completed'
);

select is(
    (select is_consistent from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'),
    true,
    'zero cached and rebuilt refund totals are consistent'
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings),
    0::bigint,
    'coherent baseline produces no internal reconciliation findings'
);

select is(
    (select rebuilt_balance_cents from app.reconciliation_account_cache
      where merchant_id = '00000000-0000-0000-0000-000000016001'
        and environment = 'sandbox'
        and account_type = 'merchant_risk_reserved_liability'),
    0::bigint,
    'account with no ledger entries rebuilds to zero'
);

select is(
    (select is_consistent from app.reconciliation_account_cache
      where merchant_id = '00000000-0000-0000-0000-000000016001'
        and environment = 'sandbox'
        and account_type = 'merchant_risk_reserved_liability'),
    true,
    'zero-entry canonical account remains cache-consistent'
);

-- REC-002: direct test tamper of the account cache is detected read-only.
update app.accounts
   set balance_cents = balance_cents + 123
 where merchant_id = '00000000-0000-0000-0000-000000016001'
   and environment = 'sandbox'
   and account_type = 'merchant_available_liability';

select is(
    (select delta_cents from app.reconciliation_account_cache
      where merchant_id = '00000000-0000-0000-0000-000000016001'
        and environment = 'sandbox'
        and account_type = 'merchant_available_liability'),
    123::bigint,
    'cache parity exposes signed cached-minus-rebuilt drift'
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016001'
              and environment = 'sandbox'
              and account_type = 'merchant_available_liability'
        )),
    1::bigint,
    'cache drift creates one deterministic cache_mismatch finding'
);

select is(
    (select expected_cents from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016001'
              and environment = 'sandbox'
              and account_type = 'merchant_available_liability'
        )),
    (select rebuilt_balance_cents from app.reconciliation_account_cache
      where merchant_id = '00000000-0000-0000-0000-000000016001'
        and environment = 'sandbox'
        and account_type = 'merchant_available_liability'),
    'cache finding exposes rebuilt ledger balance as expected cents'
);

select is(
    (select actual_cents from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016001'
              and environment = 'sandbox'
              and account_type = 'merchant_available_liability'
        )),
    (select balance_cents from app.accounts
      where merchant_id = '00000000-0000-0000-0000-000000016001'
        and environment = 'sandbox'
        and account_type = 'merchant_available_liability'),
    'cache finding exposes persisted cache as actual cents'
);

select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016001'
              and environment = 'sandbox'
              and account_type = 'merchant_available_liability'
        )),
    'account_cache:sandbox:' || (
        select id::text from app.accounts
        where merchant_id = '00000000-0000-0000-0000-000000016001'
          and environment = 'sandbox'
          and account_type = 'merchant_available_liability'
    ),
    'cache discrepancy identity is deterministic and environment-scoped'
);

-- Restore only the deliberate cache tamper before creating other discrepancies.
update app.accounts
   set balance_cents = balance_cents - 123
 where merchant_id = '00000000-0000-0000-0000-000000016001'
   and environment = 'sandbox'
   and account_type = 'merchant_available_liability';

-- REC-001: terminal domain truth without its required terminal ledger posting.
update app.payouts
   set state = 'completed', updated_at = '2026-08-14T08:03:00Z'
 where id = (select id from reconciliation_fixture_ids where fixture = 'payout_missing');

update app.refunds
   set state = 'completed',
       completed_at = '2026-08-14T08:04:00Z',
       updated_at = '2026-08-14T08:04:00Z'
 where id = (select id from reconciliation_fixture_ids where fixture = 'refund_missing');

update app.payments
   set refunded_amount_cents = 3000,
       updated_at = '2026-08-14T08:04:00Z'
 where id = '00000000-0000-0000-0000-000000016100';

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'missing_required_posting'),
    2::bigint,
    'completed Payout and Refund without terminal postings are both detected'
);

select ok(
    exists(
        select 1 from app.internal_reconciliation_findings
        where discrepancy_type = 'missing_required_posting'
          and stable_key = 'missing_posting:sandbox:payout:' ||
              (select id::text from reconciliation_fixture_ids where fixture = 'payout_missing') || ':completed'
    ),
    'missing Payout completion posting has deterministic source key'
);

select ok(
    exists(
        select 1 from app.internal_reconciliation_findings
        where discrepancy_type = 'missing_required_posting'
          and stable_key = 'missing_posting:sandbox:refund:' ||
              (select id::text from reconciliation_fixture_ids where fixture = 'refund_missing') || ':completed'
    ),
    'missing Refund completion posting has deterministic source key'
);

select is(
    (select count(*)::bigint from app.reconciliation_expected_postings),
    4::bigint,
    'terminal canonical states add one required terminal posting per resource'
);

select is(
    (select is_consistent from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'),
    true,
    'refund projection may be internally consistent even when terminal ledger posting is missing'
);

-- Existing source + terminal posting invalid for current state => unexpected.
insert into reconciliation_fixture_ids (fixture, id)
values (
    'payout_unexpected',
    app.reserve_payout(
        '00000000-0000-0000-0000-000000016001',
        'sandbox', 'BRL', 1000, 10,
        '{"pix_key":"masked-unexpected-destination"}'::jsonb,
        'recon-payout-unexpected', 'recon-payout-unexpected-fp',
        '2026-08-14T08:05:00Z'
    )
);

select app.post_ledger_transaction(
    'sandbox',
    'payout',
    (select id from reconciliation_fixture_ids where fixture = 'payout_unexpected'),
    'completed',
    jsonb_build_array(
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null
                  and provider_account_id is null
                  and environment = 'sandbox'
                  and account_type = 'provider_payment_fee_expense'
            ),
            'direction', 'debit',
            'amount_cents', 1
        ),
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null
                  and provider_account_id is null
                  and environment = 'sandbox'
                  and account_type = 'payment_fee_revenue'
            ),
            'direction', 'credit',
            'amount_cents', 1
        )
    )
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'unexpected_posting'
        and resource_type = 'payout'
        and resource_id = (select id from reconciliation_fixture_ids where fixture = 'payout_unexpected')),
    1::bigint,
    'terminal posting on requested Payout is detected as unexpected'
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'missing_required_posting'
        and resource_id = (select id from reconciliation_fixture_ids where fixture = 'payout_unexpected')),
    0::bigint,
    'requested Payout with valid reservation posting has no missing required posting'
);

select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'unexpected_posting'
        and resource_id = (select id from reconciliation_fixture_ids where fixture = 'payout_unexpected')),
    'unexpected_posting:sandbox:payout:' ||
        (select id::text from reconciliation_fixture_ids where fixture = 'payout_unexpected') || ':completed',
    'unexpected posting identity is deterministic'
);

-- Ledger source with no canonical resource => orphan, never double-classified as unexpected.
select app.post_ledger_transaction(
    'sandbox',
    'refund',
    '00000000-0000-0000-0000-000000016999',
    'completed',
    jsonb_build_array(
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null
                  and provider_account_id is null
                  and environment = 'sandbox'
                  and account_type = 'provider_payment_fee_expense'
            ),
            'direction', 'debit',
            'amount_cents', 1
        ),
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null
                  and provider_account_id is null
                  and environment = 'sandbox'
                  and account_type = 'payment_fee_revenue'
            ),
            'direction', 'credit',
            'amount_cents', 1
        )
    )
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'orphan_posting'
        and resource_type = 'refund'
        and resource_id = '00000000-0000-0000-0000-000000016999'),
    1::bigint,
    'payout/refund ledger source without canonical resource is detected as orphan'
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'unexpected_posting'
        and resource_type = 'refund'
        and resource_id = '00000000-0000-0000-0000-000000016999'),
    0::bigint,
    'orphan source is not double-classified as unexpected posting'
);

select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'orphan_posting'
        and resource_id = '00000000-0000-0000-0000-000000016999'),
    'orphan_posting:sandbox:refund:00000000-0000-0000-0000-000000016999:completed',
    'orphan posting identity is deterministic'
);

-- Refund read-model projection drift is independent from collection_status=paid.
update app.payments
   set refunded_amount_cents = 1000,
       updated_at = '2026-08-14T08:06:00Z'
 where id = '00000000-0000-0000-0000-000000016100';

select is(
    (select cached_refunded_amount_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'),
    1000::bigint,
    'refund projection exposes tampered cached amount'
);

select is(
    (select rebuilt_refunded_amount_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'),
    3000::bigint,
    'refund projection rebuilds total only from completed first-class Refund resources'
);

select is(
    (select delta_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'),
    (-2000)::bigint,
    'refund projection exposes cached-minus-rebuilt signed drift'
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'refund_projection_mismatch'
        and resource_id = '00000000-0000-0000-0000-000000016100'),
    1::bigint,
    'Payment refund aggregate drift creates one finding'
);

select is(
    (select expected_cents from app.internal_reconciliation_findings
      where discrepancy_type = 'refund_projection_mismatch'
        and resource_id = '00000000-0000-0000-0000-000000016100'),
    3000::bigint,
    'refund projection finding uses completed Refund aggregate as expected cents'
);

select is(
    (select actual_cents from app.internal_reconciliation_findings
      where discrepancy_type = 'refund_projection_mismatch'
        and resource_id = '00000000-0000-0000-0000-000000016100'),
    1000::bigint,
    'refund projection finding uses Payment cached aggregate as actual cents'
);

select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'refund_projection_mismatch'
        and resource_id = '00000000-0000-0000-0000-000000016100'),
    'refund_projection:sandbox:00000000-0000-0000-0000-000000016100',
    'refund projection discrepancy identity is deterministic and environment-scoped'
);

select is(
    (select collection_status from app.payments
      where id = '00000000-0000-0000-0000-000000016100'),
    'paid'::text,
    'refund reconciliation does not reinterpret canonical Payment collection state'
);

-- Environment isolation: a Production cache discrepancy remains separate.
insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000016002', 'Production Reconciliation Merchant', 'active');

select app.ensure_account(
    '00000000-0000-0000-0000-000000016002', null,
    'production', 'BRL', 'merchant_available_liability'
);

update app.accounts
   set balance_cents = 7
 where merchant_id = '00000000-0000-0000-0000-000000016002'
   and environment = 'production'
   and account_type = 'merchant_available_liability';

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and environment = 'production'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016002'
              and environment = 'production'
              and account_type = 'merchant_available_liability'
        )),
    1::bigint,
    'Production cache discrepancy is isolated from Sandbox findings'
);

select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and environment = 'production'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016002'
              and environment = 'production'
              and account_type = 'merchant_available_liability'
        )),
    'account_cache:production:' || (
        select id::text from app.accounts
        where merchant_id = '00000000-0000-0000-0000-000000016002'
          and environment = 'production'
          and account_type = 'merchant_available_liability'
    ),
    'Production finding stable key explicitly contains Production scope'
);

select is(
    (select count(*)::bigint from app.reconciliation_account_cache),
    (select count(*)::bigint from app.accounts),
    'newly introduced Production account also participates in reconciliation'
);

-- Findings are deterministic, unique by logical discrepancy, non-secret and read-only.
select is(
    (select count(*)::bigint from app.internal_reconciliation_findings),
    6::bigint,
    'fixture produces exactly six independent internal discrepancies'
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings),
    (select count(distinct stable_key)::bigint from app.internal_reconciliation_findings),
    'each logical internal discrepancy has a unique stable key'
);

create temporary table reconciliation_findings_snapshot as
select stable_key, discrepancy_type, environment, resource_type, resource_id, account_id,
       expected_cents, actual_cents, detail
from app.internal_reconciliation_findings;

select is(
    (select count(*)::bigint
       from (
           select * from reconciliation_findings_snapshot
           except
           select stable_key, discrepancy_type, environment, resource_type, resource_id,
                  account_id, expected_cents, actual_cents, detail
             from app.internal_reconciliation_findings
       ) q),
    0::bigint,
    're-reading reconciliation findings cannot change an existing logical finding'
);

select is(
    (select count(*)::bigint
       from (
           select stable_key, discrepancy_type, environment, resource_type, resource_id,
                  account_id, expected_cents, actual_cents, detail
             from app.internal_reconciliation_findings
           except
           select * from reconciliation_findings_snapshot
       ) q),
    0::bigint,
    're-reading reconciliation findings cannot mint a new logical finding'
);

select is(
    (select coalesce(bool_and(
        not (detail ?| array[
            'credentials_ciphertext', 'secret_ciphertext', 'destination_snapshot',
            'destination_ciphertext', 'customer_snapshot', 'pix_copy_paste',
            'raw_evidence_ref'
        ])
    ), false) from app.internal_reconciliation_findings),
    true,
    'internal findings do not copy secrets, encrypted destinations, customer snapshots or raw evidence references'
);

create temporary table reconciliation_read_snapshot as
select
    (select count(*)::bigint from app.accounts) as account_count,
    (select count(*)::bigint from app.ledger_transactions) as transaction_count,
    (select count(*)::bigint from app.ledger_entries) as entry_count,
    (select refunded_amount_cents from app.payments where id = '00000000-0000-0000-0000-000000016100') as refunded_amount_cents;

select lives_ok(
    $$select count(*) from app.internal_reconciliation_findings$$,
    'internal reconciliation findings surface is queryable read-only'
);

select is(
    (select count(*)::bigint from app.accounts),
    (select account_count from reconciliation_read_snapshot),
    'querying reconciliation does not mutate canonical accounts'
);

select is(
    (select count(*)::bigint from app.ledger_transactions),
    (select transaction_count from reconciliation_read_snapshot),
    'querying reconciliation does not append or rewrite ledger transactions'
);

select is(
    (select count(*)::bigint from app.ledger_entries),
    (select entry_count from reconciliation_read_snapshot),
    'querying reconciliation does not append or rewrite ledger entries'
);

select is(
    (select refunded_amount_cents from app.payments where id = '00000000-0000-0000-0000-000000016100'),
    (select refunded_amount_cents from reconciliation_read_snapshot),
    'querying reconciliation does not repair domain projections implicitly'
);

select * from finish();
rollback;
