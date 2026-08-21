create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select plan(10);

insert into app.merchants (id,name,lifecycle_status) values ('00000000-0000-0000-0000-000000008001','Refund Merchant','active');
insert into app.payments (id,merchant_id,environment,source,collection_status,amount_cents,currency,pricing_version,rounding_policy_version,merchant_fee_cents,merchant_net_cents,refunded_amount_cents,refund_fee_policy,paid_at)
values ('00000000-0000-0000-0000-000000008100','00000000-0000-0000-0000-000000008001','sandbox','api','paid',10000,'BRL','test-v1','test-v1',1000,9000,0,'merchant_fee_non_refundable',now());
select app.ensure_account('00000000-0000-0000-0000-000000008001',null,'sandbox','BRL','merchant_available_liability');
select app.ensure_account('00000000-0000-0000-0000-000000008001',null,'sandbox','BRL','merchant_refund_blocked_liability');
select app.ensure_account(null,null,'sandbox','BRL','payment_fee_revenue');
select app.post_ledger_transaction('sandbox','test_seed','00000000-0000-0000-0000-000000008010','seed_available',jsonb_build_array(
 jsonb_build_object('account_id',(select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000008001' and account_type='merchant_available_liability'),'direction','credit','amount_cents',10000),
 jsonb_build_object('account_id',(select id from app.accounts where merchant_id is null and provider_account_id is null and account_type='payment_fee_revenue'),'direction','debit','amount_cents',10000)
));

select lives_ok($$select app.reserve_refund('00000000-0000-0000-0000-000000008100','00000000-0000-0000-0000-000000008001','sandbox',4000,'refund-key-1','refund-fp-4000',now())$$,'first partial refund reservation succeeds');
select is((select count(*)::bigint from app.refunds),1::bigint,'first refund creates one resource');
select is((select fee_policy_version from app.refunds limit 1),'merchant_fee_non_refundable'::text,'Refund snapshots the source Payment refund-fee policy');
select is((select collection_status from app.payments where id='00000000-0000-0000-0000-000000008100'),'paid'::text,'refund reservation does not mutate canonical Payment collection state');
select is((select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000008001' and account_type='merchant_refund_blocked_liability'),4000::bigint,'refund funding remains blocked before provider certainty');
select lives_ok($$select app.reserve_refund('00000000-0000-0000-0000-000000008100','00000000-0000-0000-0000-000000008001','sandbox',4000,'refund-key-1','refund-fp-4000',now())$$,'same refund request is idempotent');
select is((select count(*)::bigint from app.refunds),1::bigint,'refund replay creates no duplicate resource');
select throws_ok($$select app.reserve_refund('00000000-0000-0000-0000-000000008100','00000000-0000-0000-0000-000000008001','sandbox',4000,'refund-key-1','refund-fp-DIFFERENT',now())$$,'23505',null,'same refund idempotency key with different request fingerprint conflicts');
select lives_ok($$select app.reserve_refund('00000000-0000-0000-0000-000000008100','00000000-0000-0000-0000-000000008001','sandbox',6000,'refund-key-2','refund-fp-6000',now())$$,'second refund may reserve exactly the remaining refundable amount');
select throws_ok($$select app.reserve_refund('00000000-0000-0000-0000-000000008100','00000000-0000-0000-0000-000000008001','sandbox',1,'refund-key-3','refund-fp-over',now())$$,'23514',null,'completed plus active reserved refunds cannot exceed payment refundable limit');

select * from finish();
rollback;
