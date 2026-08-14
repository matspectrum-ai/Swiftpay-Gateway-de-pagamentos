create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(45);

-- Coherent baseline. Existing financial commands build the healthy state;
-- direct writes below are used only to manufacture corruption for detection.
insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000016001'::uuid, 'Reconciliation Merchant', 'active');

insert into app.payments (
    id, merchant_id, environment, source, collection_status,
    amount_cents, currency, pricing_version, rounding_policy_version,
    merchant_fee_cents, merchant_net_cents, refunded_amount_cents,
    refund_fee_policy, paid_at
) values (
    '00000000-0000-0000-0000-000000016100'::uuid,
    '00000000-0000-0000-0000-000000016001'::uuid,
    'sandbox', 'api', 'paid', 10000, 'BRL', 'test-v1', 'test-v1',
    1000, 9000, 0, 'merchant_fee_non_refundable',
    '2026-08-14T08:00:00Z'::timestamptz
);

select app.ensure_account(
    '00000000-0000-0000-0000-000000016001'::uuid, null::uuid,
    'sandbox'::text, 'BRL'::text, 'merchant_available_liability'::text
);
select app.ensure_account(
    '00000000-0000-0000-0000-000000016001'::uuid, null::uuid,
    'sandbox'::text, 'BRL'::text, 'merchant_risk_reserved_liability'::text
);
select app.ensure_account(null::uuid, null::uuid, 'sandbox'::text, 'BRL'::text, 'payment_fee_revenue'::text);
select app.ensure_account(null::uuid, null::uuid, 'sandbox'::text, 'BRL'::text, 'provider_payment_fee_expense'::text);

select app.post_ledger_transaction(
    'sandbox'::text,
    'test_seed'::text,
    '00000000-0000-0000-0000-000000016010'::uuid,
    'seed_available'::text,
    jsonb_build_array(
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
                  and environment = 'sandbox'
                  and account_type = 'merchant_available_liability'
            ),
            'direction', 'credit', 'amount_cents', 30000
        ),
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null and provider_account_id is null
                  and environment = 'sandbox' and account_type = 'payment_fee_revenue'
            ),
            'direction', 'debit', 'amount_cents', 30000
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
        '00000000-0000-0000-0000-000000016001'::uuid,
        'sandbox'::text,
        'BRL'::text,
        5000::bigint,
        100::bigint,
        '{"pix_key":"masked-reconciliation-destination"}'::jsonb,
        'recon-payout-missing'::text,
        'recon-payout-missing-fp'::text,
        '2026-08-14T08:01:00Z'::timestamptz
    )
);

insert into reconciliation_fixture_ids (fixture, id)
values (
    'refund_missing',
    app.reserve_refund(
        '00000000-0000-0000-0000-000000016100'::uuid,
        '00000000-0000-0000-0000-000000016001'::uuid,
        'sandbox'::text,
        3000::bigint,
        'recon-refund-missing'::text,
        'recon-refund-missing-fp'::text,
        '2026-08-14T08:02:00Z'::timestamptz
    )
);

-- Healthy baseline.
select is(
    (select count(*)::bigint from app.reconciliation_account_cache),
    (select count(*)::bigint from app.accounts),
    'every canonical account participates in cache reconciliation'
);
select is(
    (select coalesce(bool_and(is_consistent), false) from app.reconciliation_account_cache),
    true,
    'canonical financial commands leave account caches equal to rebuilt ledger balances'
);
select is(
    (select count(*)::bigint from app.reconciliation_expected_postings),
    2::bigint,
    'reserved Payout and Refund require one reservation posting each'
);
select ok(
    exists(
        select 1 from app.reconciliation_expected_postings
        where environment = 'sandbox' and source_type = 'payout'
          and source_id = (select id from reconciliation_fixture_ids where fixture = 'payout_missing')
          and posting_type = 'reservation' and resource_state = 'requested'
    ),
    'Payout reservation expectation preserves canonical source identity/state'
);
select ok(
    exists(
        select 1 from app.reconciliation_expected_postings
        where environment = 'sandbox' and source_type = 'refund'
          and source_id = (select id from reconciliation_fixture_ids where fixture = 'refund_missing')
          and posting_type = 'reservation' and resource_state = 'requested'
    ),
    'Refund reservation expectation preserves canonical source identity/state'
);
select is(
    (select rebuilt_refunded_amount_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'::uuid),
    0::bigint,
    'refund projection rebuilds zero before a Refund completes'
);
select is(
    (select is_consistent from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'::uuid),
    true,
    'zero cached and rebuilt refund totals are consistent'
);
select is(
    (select count(*)::bigint from app.internal_reconciliation_findings),
    0::bigint,
    'coherent baseline produces zero findings'
);
select is(
    (select rebuilt_balance_cents from app.reconciliation_account_cache
      where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
        and environment = 'sandbox' and account_type = 'merchant_risk_reserved_liability'),
    0::bigint,
    'account with no ledger entries rebuilds to zero'
);

-- REC-002: cached balance drift.
update app.accounts
   set balance_cents = balance_cents + 123
 where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
   and environment = 'sandbox'
   and account_type = 'merchant_available_liability';

select is(
    (select delta_cents from app.reconciliation_account_cache
      where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
        and environment = 'sandbox' and account_type = 'merchant_available_liability'),
    123::bigint,
    'cache parity exposes cached-minus-rebuilt drift'
);
select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
              and environment = 'sandbox' and account_type = 'merchant_available_liability'
        )),
    1::bigint,
    'cache drift creates one cache_mismatch finding'
);
select is(
    (select expected_cents from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
              and environment = 'sandbox' and account_type = 'merchant_available_liability'
        )),
    (select rebuilt_balance_cents from app.reconciliation_account_cache
      where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
        and environment = 'sandbox' and account_type = 'merchant_available_liability'),
    'cache finding exposes rebuilt balance as expected cents'
);
select is(
    (select actual_cents from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
              and environment = 'sandbox' and account_type = 'merchant_available_liability'
        )),
    (select balance_cents from app.accounts
      where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
        and environment = 'sandbox' and account_type = 'merchant_available_liability'),
    'cache finding exposes persisted cache as actual cents'
);
select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
              and environment = 'sandbox' and account_type = 'merchant_available_liability'
        )),
    'account_cache:sandbox:' || (
        select id::text from app.accounts
        where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
          and environment = 'sandbox' and account_type = 'merchant_available_liability'
    ),
    'cache discrepancy stable key is deterministic and environment-scoped'
);

update app.accounts
   set balance_cents = balance_cents - 123
 where merchant_id = '00000000-0000-0000-0000-000000016001'::uuid
   and environment = 'sandbox'
   and account_type = 'merchant_available_liability';

-- REC-001: canonical terminal truth with missing required terminal posting.
update app.payouts
   set state = 'completed', updated_at = '2026-08-14T08:03:00Z'::timestamptz
 where id = (select id from reconciliation_fixture_ids where fixture = 'payout_missing');
update app.refunds
   set state = 'completed', completed_at = '2026-08-14T08:04:00Z'::timestamptz,
       updated_at = '2026-08-14T08:04:00Z'::timestamptz
 where id = (select id from reconciliation_fixture_ids where fixture = 'refund_missing');
update app.payments
   set refunded_amount_cents = 3000,
       updated_at = '2026-08-14T08:04:00Z'::timestamptz
 where id = '00000000-0000-0000-0000-000000016100'::uuid;

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
    'missing Payout completion has deterministic source key'
);
select ok(
    exists(
        select 1 from app.internal_reconciliation_findings
        where discrepancy_type = 'missing_required_posting'
          and stable_key = 'missing_posting:sandbox:refund:' ||
              (select id::text from reconciliation_fixture_ids where fixture = 'refund_missing') || ':completed'
    ),
    'missing Refund completion has deterministic source key'
);
select is(
    (select count(*)::bigint from app.reconciliation_expected_postings),
    4::bigint,
    'terminal canonical states add one required terminal posting per resource'
);
select is(
    (select is_consistent from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'::uuid),
    true,
    'refund projection can remain consistent while ledger terminal posting is missing'
);

-- Existing canonical source + posting invalid for current state => unexpected.
insert into reconciliation_fixture_ids (fixture, id)
values (
    'payout_unexpected',
    app.reserve_payout(
        '00000000-0000-0000-0000-000000016001'::uuid,
        'sandbox'::text,
        'BRL'::text,
        1000::bigint,
        10::bigint,
        '{"pix_key":"masked-unexpected-destination"}'::jsonb,
        'recon-payout-unexpected'::text,
        'recon-payout-unexpected-fp'::text,
        '2026-08-14T08:05:00Z'::timestamptz
    )
);

select app.post_ledger_transaction(
    'sandbox'::text,
    'payout'::text,
    (select id from reconciliation_fixture_ids where fixture = 'payout_unexpected'),
    'completed'::text,
    jsonb_build_array(
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null and provider_account_id is null
                  and environment = 'sandbox' and account_type = 'provider_payment_fee_expense'
            ),
            'direction', 'debit', 'amount_cents', 1
        ),
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null and provider_account_id is null
                  and environment = 'sandbox' and account_type = 'payment_fee_revenue'
            ),
            'direction', 'credit', 'amount_cents', 1
        )
    )
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'unexpected_posting' and resource_type = 'payout'
        and resource_id = (select id from reconciliation_fixture_ids where fixture = 'payout_unexpected')),
    1::bigint,
    'terminal posting on requested Payout is unexpected'
);
select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'missing_required_posting'
        and resource_id = (select id from reconciliation_fixture_ids where fixture = 'payout_unexpected')),
    0::bigint,
    'requested Payout with reservation has no missing required posting'
);
select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'unexpected_posting'
        and resource_id = (select id from reconciliation_fixture_ids where fixture = 'payout_unexpected')),
    'unexpected_posting:sandbox:payout:' ||
        (select id::text from reconciliation_fixture_ids where fixture = 'payout_unexpected') || ':completed',
    'unexpected posting stable key is deterministic'
);

-- Ledger source with no canonical resource => orphan only.
select app.post_ledger_transaction(
    'sandbox'::text,
    'refund'::text,
    '00000000-0000-0000-0000-000000016999'::uuid,
    'completed'::text,
    jsonb_build_array(
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null and provider_account_id is null
                  and environment = 'sandbox' and account_type = 'provider_payment_fee_expense'
            ),
            'direction', 'debit', 'amount_cents', 1
        ),
        jsonb_build_object(
            'account_id', (
                select id from app.accounts
                where merchant_id is null and provider_account_id is null
                  and environment = 'sandbox' and account_type = 'payment_fee_revenue'
            ),
            'direction', 'credit', 'amount_cents', 1
        )
    )
);

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'orphan_posting' and resource_type = 'refund'
        and resource_id = '00000000-0000-0000-0000-000000016999'::uuid),
    1::bigint,
    'ledger source without canonical Refund is detected as orphan'
);
select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'unexpected_posting' and resource_type = 'refund'
        and resource_id = '00000000-0000-0000-0000-000000016999'::uuid),
    0::bigint,
    'orphan source is not double-classified as unexpected'
);
select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'orphan_posting'
        and resource_id = '00000000-0000-0000-0000-000000016999'::uuid),
    'orphan_posting:sandbox:refund:00000000-0000-0000-0000-000000016999:completed',
    'orphan posting stable key is deterministic'
);

-- Refund projection drift remains independent from Payment collection truth.
update app.payments
   set refunded_amount_cents = 1000,
       updated_at = '2026-08-14T08:06:00Z'::timestamptz
 where id = '00000000-0000-0000-0000-000000016100'::uuid;

select is(
    (select cached_refunded_amount_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'::uuid),
    1000::bigint,
    'refund projection exposes cached Payment aggregate'
);
select is(
    (select rebuilt_refunded_amount_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'::uuid),
    3000::bigint,
    'refund projection rebuilds aggregate from completed Refund resources'
);
select is(
    (select delta_cents from app.reconciliation_refund_projection
      where payment_id = '00000000-0000-0000-0000-000000016100'::uuid),
    (-2000)::bigint,
    'refund projection exposes cached-minus-rebuilt drift'
);
select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'refund_projection_mismatch'
        and resource_id = '00000000-0000-0000-0000-000000016100'::uuid),
    1::bigint,
    'refund projection drift creates one finding'
);
select ok(
    exists(
        select 1 from app.internal_reconciliation_findings
        where discrepancy_type = 'refund_projection_mismatch'
          and resource_id = '00000000-0000-0000-0000-000000016100'::uuid
          and expected_cents = 3000 and actual_cents = 1000
    ),
    'refund projection finding exposes rebuilt expected and cached actual cents'
);
select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'refund_projection_mismatch'
        and resource_id = '00000000-0000-0000-0000-000000016100'::uuid),
    'refund_projection:sandbox:00000000-0000-0000-0000-000000016100',
    'refund projection stable key is deterministic'
);
select is(
    (select collection_status from app.payments
      where id = '00000000-0000-0000-0000-000000016100'::uuid),
    'paid'::text,
    'refund reconciliation never reinterprets canonical Payment collection state'
);

-- Environment isolation.
insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000016002'::uuid, 'Production Reconciliation Merchant', 'active');
select app.ensure_account(
    '00000000-0000-0000-0000-000000016002'::uuid, null::uuid,
    'production'::text, 'BRL'::text, 'merchant_available_liability'::text
);
update app.accounts
   set balance_cents = 7
 where merchant_id = '00000000-0000-0000-0000-000000016002'::uuid
   and environment = 'production' and account_type = 'merchant_available_liability';

select is(
    (select count(*)::bigint from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch' and environment = 'production'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016002'::uuid
              and environment = 'production' and account_type = 'merchant_available_liability'
        )),
    1::bigint,
    'Production cache discrepancy stays isolated from Sandbox findings'
);
select is(
    (select stable_key from app.internal_reconciliation_findings
      where discrepancy_type = 'cache_mismatch' and environment = 'production'
        and account_id = (
            select id from app.accounts
            where merchant_id = '00000000-0000-0000-0000-000000016002'::uuid
              and environment = 'production' and account_type = 'merchant_available_liability'
        )),
    'account_cache:production:' || (
        select id::text from app.accounts
        where merchant_id = '00000000-0000-0000-0000-000000016002'::uuid
          and environment = 'production' and account_type = 'merchant_available_liability'
    ),
    'Production stable key explicitly preserves environment scope'
);
select is(
    (select count(*)::bigint from app.reconciliation_account_cache),
    (select count(*)::bigint from app.accounts),
    'new Production account also participates in cache reconciliation'
);

-- Determinism, non-secret details and no side effects.
select is(
    (select count(*)::bigint from app.internal_reconciliation_findings),
    6::bigint,
    'fixture produces exactly six independent discrepancies'
);
select is(
    (select count(*)::bigint from app.internal_reconciliation_findings),
    (select count(distinct stable_key)::bigint from app.internal_reconciliation_findings),
    'logical discrepancies have unique stable keys'
);

create temporary table reconciliation_findings_snapshot as
select stable_key, discrepancy_type, environment, resource_type, resource_id,
       account_id, expected_cents, actual_cents, detail
from app.internal_reconciliation_findings;

select is(
    (select count(*)::bigint from (
        select * from reconciliation_findings_snapshot
        except
        select stable_key, discrepancy_type, environment, resource_type, resource_id,
               account_id, expected_cents, actual_cents, detail
        from app.internal_reconciliation_findings
    ) q),
    0::bigint,
    're-reading findings cannot remove or mutate a logical discrepancy'
);
select is(
    (select count(*)::bigint from (
        select stable_key, discrepancy_type, environment, resource_type, resource_id,
               account_id, expected_cents, actual_cents, detail
        from app.internal_reconciliation_findings
        except
        select * from reconciliation_findings_snapshot
    ) q),
    0::bigint,
    're-reading findings cannot mint a new logical discrepancy'
);
select is(
    (select coalesce(bool_and(not (detail ?| array[
        'credentials_ciphertext', 'secret_ciphertext', 'destination_snapshot',
        'destination_ciphertext', 'customer_snapshot', 'pix_copy_paste',
        'raw_evidence_ref'
    ])), false) from app.internal_reconciliation_findings),
    true,
    'finding detail omits secrets, customer snapshots and raw evidence references'
);

create temporary table reconciliation_read_snapshot as
select
    (select count(*)::bigint from app.accounts) as account_count,
    (select count(*)::bigint from app.ledger_transactions) as transaction_count,
    (select count(*)::bigint from app.ledger_entries) as entry_count,
    (select refunded_amount_cents from app.payments
      where id = '00000000-0000-0000-0000-000000016100'::uuid) as refunded_amount_cents;

select lives_ok(
    $$select count(*) from app.internal_reconciliation_findings$$,
    'internal reconciliation findings are queryable read-only'
);
select is(
    (select count(*)::bigint from app.accounts),
    (select account_count from reconciliation_read_snapshot),
    'reconciliation SELECT does not mutate accounts'
);
select is(
    (select count(*)::bigint from app.ledger_transactions),
    (select transaction_count from reconciliation_read_snapshot),
    'reconciliation SELECT does not mutate ledger transactions'
);
select is(
    (select count(*)::bigint from app.ledger_entries),
    (select entry_count from reconciliation_read_snapshot),
    'reconciliation SELECT does not mutate ledger entries'
);
select is(
    (select refunded_amount_cents from app.payments
      where id = '00000000-0000-0000-0000-000000016100'::uuid),
    (select refunded_amount_cents from reconciliation_read_snapshot),
    'reconciliation SELECT does not repair domain projections implicitly'
);

select * from finish();
rollback;
