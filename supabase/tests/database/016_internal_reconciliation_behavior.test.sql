create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select plan(40);

insert into app.merchants (id,name,lifecycle_status)
values ('00000000-0000-0000-0000-000000016001','Reconciliation Merchant','active');

insert into app.payments (
  id,merchant_id,environment,source,collection_status,amount_cents,currency,
  pricing_version,rounding_policy_version,merchant_fee_cents,merchant_net_cents,
  refunded_amount_cents,refund_fee_policy,paid_at
) values (
  '00000000-0000-0000-0000-000000016100',
  '00000000-0000-0000-0000-000000016001',
  'sandbox','api','paid',10000,'BRL','test-v1','test-v1',1000,9000,0,
  'merchant_fee_non_refundable','2026-08-14T08:00:00Z'
);

select app.ensure_account('00000000-0000-0000-0000-000000016001',null,'sandbox','BRL','merchant_available_liability');
select app.ensure_account('00000000-0000-0000-0000-000000016001',null,'sandbox','BRL','merchant_risk_reserved_liability');
select app.ensure_account(null,null,'sandbox','BRL','payment_fee_revenue');
select app.ensure_account(null,null,'sandbox','BRL','provider_payment_fee_expense');

select app.post_ledger_transaction(
  'sandbox','test_seed','00000000-0000-0000-0000-000000016010','seed_available',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',(select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000016001' and environment='sandbox' and account_type='merchant_available_liability'),
      'direction','credit','amount_cents',30000
    ),
    jsonb_build_object(
      'account_id',(select id from app.accounts where merchant_id is null and provider_account_id is null and environment='sandbox' and account_type='payment_fee_revenue'),
      'direction','debit','amount_cents',30000
    )
  )
);

create temporary table recon_ids (fixture text primary key,id uuid not null);
insert into recon_ids values (
  'payout_missing',
  app.reserve_payout(
    '00000000-0000-0000-0000-000000016001'::uuid,'sandbox'::text,'BRL'::text,
    5000::bigint,100::bigint,'{"pix_key":"masked-a"}'::jsonb,
    'routing-test-v1'::text,'recon-payout-missing'::text,'recon-payout-missing-fp'::text,
    '2026-08-14T08:01:00Z'::timestamptz
  )
);
insert into recon_ids values (
  'refund_missing',
  app.reserve_refund(
    '00000000-0000-0000-0000-000000016100'::uuid,
    '00000000-0000-0000-0000-000000016001'::uuid,'sandbox'::text,3000::bigint,
    'recon-refund-missing'::text,'recon-refund-missing-fp'::text,
    '2026-08-14T08:02:00Z'::timestamptz
  )
);

-- Healthy baseline.
select is((select count(*)::bigint from app.reconciliation_account_cache),(select count(*)::bigint from app.accounts),'every account participates in cache reconciliation');
select is((select coalesce(bool_and(is_consistent),false) from app.reconciliation_account_cache),true,'canonical commands produce cache/ledger parity');
select is((select count(*)::bigint from app.reconciliation_expected_postings),2::bigint,'reserved payout/refund require reservation postings');
select ok(exists(select 1 from app.reconciliation_expected_postings where environment='sandbox' and source_type='payout' and source_id=(select id from recon_ids where fixture='payout_missing') and posting_type='reservation' and resource_state='requested'),'payout reservation expectation is rebuilt');
select ok(exists(select 1 from app.reconciliation_expected_postings where environment='sandbox' and source_type='refund' and source_id=(select id from recon_ids where fixture='refund_missing') and posting_type='reservation' and resource_state='requested'),'refund reservation expectation is rebuilt');
select is((select is_consistent from app.reconciliation_refund_projection where payment_id='00000000-0000-0000-0000-000000016100'),true,'zero completed refunds match Payment cached projection');
select is((select count(*)::bigint from app.internal_reconciliation_findings),0::bigint,'healthy baseline has zero findings');
select is((select rebuilt_balance_cents from app.reconciliation_account_cache where merchant_id='00000000-0000-0000-0000-000000016001' and environment='sandbox' and account_type='merchant_risk_reserved_liability'),0::bigint,'zero-entry account rebuilds to zero');

-- Cache drift.
update app.accounts set balance_cents=balance_cents+123
where merchant_id='00000000-0000-0000-0000-000000016001' and environment='sandbox' and account_type='merchant_available_liability';
select is((select delta_cents from app.reconciliation_account_cache where merchant_id='00000000-0000-0000-0000-000000016001' and environment='sandbox' and account_type='merchant_available_liability'),123::bigint,'cache delta is cached minus rebuilt');
select is((select count(*)::bigint from app.internal_reconciliation_findings where discrepancy_type='cache_mismatch' and account_id=(select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000016001' and environment='sandbox' and account_type='merchant_available_liability')),1::bigint,'cache drift creates one finding');
select is((select stable_key from app.internal_reconciliation_findings where discrepancy_type='cache_mismatch' and account_id=(select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000016001' and environment='sandbox' and account_type='merchant_available_liability')),'account_cache:sandbox:'||(select id::text from app.accounts where merchant_id='00000000-0000-0000-0000-000000016001' and environment='sandbox' and account_type='merchant_available_liability'),'cache finding key is deterministic');
update app.accounts set balance_cents=balance_cents-123
where merchant_id='00000000-0000-0000-0000-000000016001' and environment='sandbox' and account_type='merchant_available_liability';

-- Canonical terminal state with missing terminal ledger posting.
update app.payouts set state='completed',updated_at='2026-08-14T08:03:00Z' where id=(select id from recon_ids where fixture='payout_missing');
update app.refunds set state='completed',completed_at='2026-08-14T08:04:00Z',updated_at='2026-08-14T08:04:00Z' where id=(select id from recon_ids where fixture='refund_missing');
update app.payments set refunded_amount_cents=3000,updated_at='2026-08-14T08:04:00Z' where id='00000000-0000-0000-0000-000000016100';
select is((select count(*)::bigint from app.internal_reconciliation_findings where discrepancy_type='missing_required_posting'),2::bigint,'missing payout/refund terminal postings are detected');
select ok(exists(select 1 from app.internal_reconciliation_findings where stable_key='missing_posting:sandbox:payout:'||(select id::text from recon_ids where fixture='payout_missing')||':completed'),'missing payout posting has deterministic key');
select ok(exists(select 1 from app.internal_reconciliation_findings where stable_key='missing_posting:sandbox:refund:'||(select id::text from recon_ids where fixture='refund_missing')||':completed'),'missing refund posting has deterministic key');
select is((select count(*)::bigint from app.reconciliation_expected_postings),4::bigint,'terminal states add required terminal expectations');
select is((select is_consistent from app.reconciliation_refund_projection where payment_id='00000000-0000-0000-0000-000000016100'),true,'refund projection can be consistent while ledger posting is missing');

-- Existing source + invalid terminal posting for requested state.
insert into recon_ids values (
  'payout_unexpected',
  app.reserve_payout(
    '00000000-0000-0000-0000-000000016001'::uuid,'sandbox'::text,'BRL'::text,
    1000::bigint,10::bigint,'{"pix_key":"masked-b"}'::jsonb,
    'routing-test-v1'::text,'recon-payout-unexpected'::text,'recon-payout-unexpected-fp'::text,
    '2026-08-14T08:05:00Z'::timestamptz
  )
);
select app.post_ledger_transaction(
  'sandbox','payout',(select id from recon_ids where fixture='payout_unexpected'),'completed',
  jsonb_build_array(
    jsonb_build_object('account_id',(select id from app.accounts where merchant_id is null and provider_account_id is null and environment='sandbox' and account_type='provider_payment_fee_expense'),'direction','debit','amount_cents',1),
    jsonb_build_object('account_id',(select id from app.accounts where merchant_id is null and provider_account_id is null and environment='sandbox' and account_type='payment_fee_revenue'),'direction','credit','amount_cents',1)
  )
);
select is((select count(*)::bigint from app.internal_reconciliation_findings where discrepancy_type='unexpected_posting' and resource_type='payout' and resource_id=(select id from recon_ids where fixture='payout_unexpected')),1::bigint,'invalid terminal posting is unexpected');
select is((select count(*)::bigint from app.internal_reconciliation_findings where discrepancy_type='missing_required_posting' and resource_id=(select id from recon_ids where fixture='payout_unexpected')),0::bigint,'requested payout reservation is not missing');
select is((select stable_key from app.internal_reconciliation_findings where discrepancy_type='unexpected_posting' and resource_id=(select id from recon_ids where fixture='payout_unexpected')),'unexpected_posting:sandbox:payout:'||(select id::text from recon_ids where fixture='payout_unexpected')||':completed','unexpected posting key is deterministic');

-- Ledger source without canonical resource.
select app.post_ledger_transaction(
  'sandbox','refund','00000000-0000-0000-0000-000000016999','completed',
  jsonb_build_array(
    jsonb_build_object('account_id',(select id from app.accounts where merchant_id is null and provider_account_id is null and environment='sandbox' and account_type='provider_payment_fee_expense'),'direction','debit','amount_cents',1),
    jsonb_build_object('account_id',(select id from app.accounts where merchant_id is null and provider_account_id is null and environment='sandbox' and account_type='payment_fee_revenue'),'direction','credit','amount_cents',1)
  )
);
select is((select count(*)::bigint from app.internal_reconciliation_findings where discrepancy_type='orphan_posting' and resource_type='refund' and resource_id='00000000-0000-0000-0000-000000016999'),1::bigint,'orphan refund posting is detected');
select is((select count(*)::bigint from app.internal_reconciliation_findings where discrepancy_type='unexpected_posting' and resource_type='refund' and resource_id='00000000-0000-0000-0000-000000016999'),0::bigint,'orphan is not double-classified as unexpected');
select is((select stable_key from app.internal_reconciliation_findings where discrepancy_type='orphan_posting' and resource_id='00000000-0000-0000-0000-000000016999'),'orphan_posting:sandbox:refund:00000000-0000-0000-0000-000000016999:completed','orphan posting key is deterministic');

-- Payment refund projection drift.
update app.payments set refunded_amount_cents=1000,updated_at='2026-08-14T08:06:00Z' where id='00000000-0000-0000-0000-000000016100';
select is((select rebuilt_refunded_amount_cents from app.reconciliation_refund_projection where payment_id='00000000-0000-0000-0000-000000016100'),3000::bigint,'completed Refunds rebuild the refund aggregate');
select is((select delta_cents from app.reconciliation_refund_projection where payment_id='00000000-0000-0000-0000-000000016100'),(-2000)::bigint,'refund projection delta is cached minus rebuilt');
select is((select count(*)::bigint from app.internal_reconciliation_findings where discrepancy_type='refund_projection_mismatch' and resource_id='00000000-0000-0000-0000-000000016100'),1::bigint,'refund projection drift creates one finding');
select ok(exists(select 1 from app.internal_reconciliation_findings where discrepancy_type='refund_projection_mismatch' and resource_id='00000000-0000-0000-0000-000000016100' and expected_cents=3000 and actual_cents=1000),'refund projection finding exposes expected and actual cents');
select is((select collection_status from app.payments where id='00000000-0000-0000-0000-000000016100'),'paid'::text,'refund reconciliation never rewinds Payment collection state');

-- Environment isolation.
insert into app.merchants (id,name,lifecycle_status) values ('00000000-0000-0000-0000-000000016002','Production Reconciliation Merchant','active');
select app.ensure_account('00000000-0000-0000-0000-000000016002',null,'production','BRL','merchant_available_liability');
update app.accounts set balance_cents=7 where merchant_id='00000000-0000-0000-0000-000000016002' and environment='production' and account_type='merchant_available_liability';
select is((select count(*)::bigint from app.internal_reconciliation_findings where discrepancy_type='cache_mismatch' and environment='production'),1::bigint,'Production cache discrepancy remains environment-isolated');
select is((select stable_key from app.internal_reconciliation_findings where discrepancy_type='cache_mismatch' and environment='production'),'account_cache:production:'||(select id::text from app.accounts where merchant_id='00000000-0000-0000-0000-000000016002' and environment='production' and account_type='merchant_available_liability'),'Production key contains Production scope');
select is((select count(*)::bigint from app.reconciliation_account_cache),(select count(*)::bigint from app.accounts),'new Production account also participates');

-- Determinism, secrecy and read-only behavior.
select is((select count(*)::bigint from app.internal_reconciliation_findings),6::bigint,'fixture yields six independent discrepancies');
select is((select count(*)::bigint from app.internal_reconciliation_findings),(select count(distinct stable_key)::bigint from app.internal_reconciliation_findings),'stable keys are unique by logical discrepancy');
create temporary table recon_snapshot as select * from app.internal_reconciliation_findings;
select is((select count(*)::bigint from (select * from recon_snapshot except select * from app.internal_reconciliation_findings) q),0::bigint,'re-read cannot mutate/remove findings');
select is((select count(*)::bigint from (select * from app.internal_reconciliation_findings except select * from recon_snapshot) q),0::bigint,'re-read cannot mint findings');
select is((select coalesce(bool_and(not(detail ?| array['credentials_ciphertext','secret_ciphertext','destination_snapshot','destination_ciphertext','customer_snapshot','pix_copy_paste','raw_evidence_ref'])),false) from app.internal_reconciliation_findings),true,'finding detail excludes secrets/PII/raw evidence references');

create temporary table recon_read_snapshot as
select (select count(*)::bigint from app.accounts) account_count,
       (select count(*)::bigint from app.ledger_transactions) tx_count,
       (select count(*)::bigint from app.ledger_entries) entry_count,
       (select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000016100') refunded_amount;
select lives_ok($$select count(*) from app.internal_reconciliation_findings$$,'findings surface is read-only queryable');
select is((select count(*)::bigint from app.accounts),(select account_count from recon_read_snapshot),'reconciliation SELECT does not mutate accounts');
select is((select count(*)::bigint from app.ledger_transactions),(select tx_count from recon_read_snapshot),'reconciliation SELECT does not mutate ledger transactions');
select is((select count(*)::bigint from app.ledger_entries),(select entry_count from recon_read_snapshot),'reconciliation SELECT does not mutate ledger entries');
select is((select refunded_amount_cents from app.payments where id='00000000-0000-0000-0000-000000016100'),(select refunded_amount from recon_read_snapshot),'reconciliation SELECT does not repair domain state');

select * from finish();
rollback;
