create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(24);

select has_table('app', 'accounts', 'canonical financial accounts table must exist');
select has_table('app', 'ledger_transactions', 'immutable ledger transaction table must exist');
select has_table('app', 'ledger_entries', 'immutable ledger entries table must exist');
select has_function('app', 'ensure_account', array['uuid','uuid','text','text','text'], 'deterministic account upsert function must exist');
select has_function('app', 'post_ledger_transaction', array['text','text','uuid','text','jsonb'], 'trusted balanced posting function must exist');
select has_index('app', 'ledger_transactions', 'ledger_transactions_source_uq', 'financial source/posting identity must be unique');
select has_index('app', 'accounts', 'accounts_merchant_identity_uq', 'merchant account identity must be unique');
select has_index('app', 'accounts', 'accounts_provider_identity_uq', 'provider account identity must be unique');
select has_index('app', 'accounts', 'accounts_platform_identity_uq', 'platform revenue/expense identity must be unique');

insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000001001', 'Ledger Merchant', 'active');

insert into app.providers (id, code, name, status)
values ('00000000-0000-0000-0000-000000001101', 'ledger-provider', 'Ledger Provider', 'active');

insert into app.provider_accounts (
  id, provider_id, merchant_id, name, environment, status,
  credentials_ciphertext, capabilities, configuration
) values (
  '00000000-0000-0000-0000-000000001102',
  '00000000-0000-0000-0000-000000001101',
  '00000000-0000-0000-0000-000000001001',
  'Ledger Provider Account', 'sandbox', 'active', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
);

select lives_ok(
  $$select app.ensure_account('00000000-0000-0000-0000-000000001001'::uuid, null::uuid, 'sandbox', 'BRL', 'merchant_available_liability')$$,
  'merchant account can be deterministically ensured'
);
select is(
  (select count(*)::bigint from app.accounts where merchant_id='00000000-0000-0000-0000-000000001001' and environment='sandbox' and currency='BRL' and account_type='merchant_available_liability'),
  1::bigint,
  'first ensure creates one merchant account'
);
select lives_ok(
  $$select app.ensure_account('00000000-0000-0000-0000-000000001001'::uuid, null::uuid, 'sandbox', 'BRL', 'merchant_available_liability')$$,
  're-ensuring an account is idempotent'
);
select is(
  (select count(*)::bigint from app.accounts where merchant_id='00000000-0000-0000-0000-000000001001' and environment='sandbox' and currency='BRL' and account_type='merchant_available_liability'),
  1::bigint,
  'repeated ensure still leaves one account'
);

select app.ensure_account(null, '00000000-0000-0000-0000-000000001102', 'sandbox', 'BRL', 'provider_settlement_asset');
select app.ensure_account('00000000-0000-0000-0000-000000001001', null, 'sandbox', 'BRL', 'merchant_pending_liability');
select app.ensure_account(null, null, 'sandbox', 'BRL', 'payment_fee_revenue');
select app.ensure_account(null, null, 'sandbox', 'BRL', 'provider_payment_fee_expense');

select throws_ok(
  $$select app.post_ledger_transaction(
      'sandbox', 'payment', '00000000-0000-0000-0000-000000001200'::uuid, 'settlement_paid',
      jsonb_build_array(
        jsonb_build_object('account_id',(select id from app.accounts where provider_account_id='00000000-0000-0000-0000-000000001102' and account_type='provider_settlement_asset'),'direction','debit','amount_cents',9700),
        jsonb_build_object('account_id',(select id from app.accounts where account_type='provider_payment_fee_expense' and merchant_id is null and provider_account_id is null),'direction','debit','amount_cents',300),
        jsonb_build_object('account_id',(select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000001001' and account_type='merchant_pending_liability'),'direction','credit','amount_cents',9000),
        jsonb_build_object('account_id',(select id from app.accounts where account_type='payment_fee_revenue' and merchant_id is null and provider_account_id is null),'direction','credit','amount_cents',900)
      )
    )$$,
  '23514', null,
  'LEDGER-004: unbalanced posting is rejected atomically'
);
select is((select count(*)::bigint from app.ledger_transactions),0::bigint,'rejected posting leaves no ledger transaction');
select is((select coalesce(sum(balance_cents),0)::bigint from app.accounts),0::bigint,'rejected posting leaves account caches unchanged');

select lives_ok(
  $$select app.post_ledger_transaction(
      'sandbox', 'payment', '00000000-0000-0000-0000-000000001200'::uuid, 'settlement_paid',
      jsonb_build_array(
        jsonb_build_object('account_id',(select id from app.accounts where provider_account_id='00000000-0000-0000-0000-000000001102' and account_type='provider_settlement_asset'),'direction','debit','amount_cents',9700),
        jsonb_build_object('account_id',(select id from app.accounts where account_type='provider_payment_fee_expense' and merchant_id is null and provider_account_id is null),'direction','debit','amount_cents',300),
        jsonb_build_object('account_id',(select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000001001' and account_type='merchant_pending_liability'),'direction','credit','amount_cents',9000),
        jsonb_build_object('account_id',(select id from app.accounts where account_type='payment_fee_revenue' and merchant_id is null and provider_account_id is null),'direction','credit','amount_cents',1000)
      )
    )$$,
  'balanced paid-payment posting succeeds'
);
select is((select count(*)::bigint from app.ledger_transactions),1::bigint,'one logical paid posting creates one ledger transaction');
select is((select count(*)::bigint from app.ledger_entries),4::bigint,'paid posting creates four immutable entries');

select throws_ok(
  $$insert into app.ledger_entries (ledger_transaction_id,account_id,direction,amount_cents)
    values ((select id from app.ledger_transactions where source_id='00000000-0000-0000-0000-000000001200'::uuid),(select id from app.accounts limit 1),'debit',0)$$,
  '23514', null,
  'LEDGER-002: zero-value ledger entry is rejected'
);
select is(
  (select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000001001' and account_type='merchant_pending_liability'),
  9000::bigint,
  'merchant pending liability cache is credited by merchant net'
);
select is(
  (select balance_cents from app.accounts where provider_account_id='00000000-0000-0000-0000-000000001102' and account_type='provider_settlement_asset'),
  9700::bigint,
  'provider settlement asset cache follows its debit-normal natural side'
);

select throws_ok(
  $$select app.post_ledger_transaction(
      'sandbox', 'payment', '00000000-0000-0000-0000-000000001200'::uuid, 'settlement_paid',
      jsonb_build_array(
        jsonb_build_object('account_id',(select id from app.accounts where provider_account_id='00000000-0000-0000-0000-000000001102' and account_type='provider_settlement_asset'),'direction','debit','amount_cents',9700),
        jsonb_build_object('account_id',(select id from app.accounts where account_type='provider_payment_fee_expense' and merchant_id is null and provider_account_id is null),'direction','debit','amount_cents',300),
        jsonb_build_object('account_id',(select id from app.accounts where merchant_id='00000000-0000-0000-0000-000000001001' and account_type='merchant_pending_liability'),'direction','credit','amount_cents',9000),
        jsonb_build_object('account_id',(select id from app.accounts where account_type='payment_fee_revenue' and merchant_id is null and provider_account_id is null),'direction','credit','amount_cents',1000)
      )
    )$$,
  '23505', null,
  'LEDGER-005: duplicate source/posting identity cannot post twice'
);
select is(
  (select balance_cents from app.accounts where merchant_id='00000000-0000-0000-0000-000000001001' and account_type='merchant_risk_reserved_liability'),
  null::bigint,
  'reserve-disabled payment flow creates no risk-reserve account/posting'
);

select * from finish();
rollback;
