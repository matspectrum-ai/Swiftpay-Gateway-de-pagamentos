create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select plan(8);

insert into app.merchants (id,name,lifecycle_status) values ('00000000-0000-0000-0000-000000007001','Payout Merchant','active');
select app.ensure_account('00000000-0000-0000-0000-000000007001',null,'sandbox','BRL','merchant_available_liability');
select app.ensure_account('00000000-0000-0000-0000-000000007001',null,'sandbox','BRL','merchant_payout_blocked_liability');

-- Seed merchant available funds through the canonical ledger, never by mutating cache directly.
select app.ensure_account(null,null,'sandbox','BRL','payment_fee_revenue');
select app.post_ledger_transaction('sandbox','test_seed','00000000-0000-0000-0000-000000007010','seed_available',jsonb_build_array(
 jsonb_build_object('account_id',(select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000007001' and account_type='merchant_available_liability'),'direction','credit','amount_cents',10000),
 jsonb_build_object('account_id',(select id from app.accounts where merchant_id is null and provider_account_id is null and account_type='payment_fee_revenue'),'direction','debit','amount_cents',10000)
));

select lives_ok($$select app.reserve_payout('00000000-0000-0000-0000-000000007001','sandbox','BRL',6000,500,'{"pix_key":"masked"}'::jsonb,'payout-key-1','fp-6000',now())$$,'reservation succeeds when available funds cover gross payout');
select is((select count(*)::bigint from app.payouts),1::bigint,'one payout resource is created');
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000007001' and account_type='merchant_available_liability'),4000::bigint,'available is debited by gross payout amount');
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000007001' and account_type='merchant_payout_blocked_liability'),6000::bigint,'gross payout is reserved in payout-blocked liability');
select is((select count(*)::bigint from app.ledger_transactions where source_type='payout' and posting_type='reservation'),1::bigint,'reservation posts exactly one ledger transaction');

select lives_ok($$select app.reserve_payout('00000000-0000-0000-0000-000000007001','sandbox','BRL',6000,500,'{"pix_key":"masked"}'::jsonb,'payout-key-1','fp-6000',now())$$,'same idempotency key and fingerprint returns existing payout without reposting');
select is((select count(*)::bigint from app.payouts),1::bigint,'idempotent replay creates no second payout');
select throws_ok($$select app.reserve_payout('00000000-0000-0000-0000-000000007001','sandbox','BRL',5000,500,'{"pix_key":"masked"}'::jsonb,'payout-key-2','fp-5000',now())$$,'23514',null,'insufficient available funds rejects reservation atomically');

select * from finish();
rollback;
