#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"
: "${SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY:?SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY is required}"

readonly ADMIN_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
readonly MERCHANT_A='29000000-0000-0000-0000-000000000901'
readonly MERCHANT_B='29000000-0000-0000-0000-000000000902'

psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 <<'SQL'
insert into app.merchants (id, name, lifecycle_status) values
  ('29000000-0000-0000-0000-000000000901'::uuid, 'A9 Runtime Merchant A', 'active'),
  ('29000000-0000-0000-0000-000000000902'::uuid, 'A9 Runtime Merchant B', 'active');

insert into auth.users (
  id, aud, role, email, raw_user_meta_data, raw_app_meta_data,
  is_anonymous, deleted_at, created_at, updated_at
) values
  ('19000000-0000-0000-0000-000000000901'::uuid, 'authenticated', 'authenticated', 'a9-member@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('19000000-0000-0000-0000-000000000902'::uuid, 'authenticated', 'authenticated', 'a9-disabled@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('19000000-0000-0000-0000-000000000903'::uuid, 'authenticated', 'authenticated', 'a9-deleted@example.test', '{}'::jsonb, '{}'::jsonb, false, now(), now(), now()),
  ('19000000-0000-0000-0000-000000000904'::uuid, 'authenticated', 'authenticated', 'a9-outsider@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now());

insert into app.merchant_members (merchant_id, user_id, role, status) values
  ('29000000-0000-0000-0000-000000000901'::uuid, '19000000-0000-0000-0000-000000000901'::uuid, 'member', 'active'),
  ('29000000-0000-0000-0000-000000000901'::uuid, '19000000-0000-0000-0000-000000000902'::uuid, 'member', 'disabled'),
  ('29000000-0000-0000-0000-000000000901'::uuid, '19000000-0000-0000-0000-000000000903'::uuid, 'member', 'active');

insert into app.providers (id, code, name, status)
values ('59000000-0000-0000-0000-000000000901'::uuid, 'a9-runtime-provider', 'A9 Runtime Provider', 'active');

insert into app.provider_accounts (
  id, provider_id, merchant_id, name, environment, status,
  credentials_ciphertext, capabilities, configuration
) values (
  '69000000-0000-0000-0000-000000000901'::uuid,
  '59000000-0000-0000-0000-000000000901'::uuid,
  '29000000-0000-0000-0000-000000000901'::uuid,
  'A9 synthetic provider account', 'sandbox', 'active',
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
);

insert into app.payments (
  id, merchant_id, environment, external_id, source, collection_status,
  amount_cents, currency, description, customer_snapshot, metadata,
  pricing_version, rounding_policy_version, merchant_fee_cents, merchant_net_cents,
  provider_cost_cents, refunded_amount_cents, expires_at, paid_at, created_at, updated_at
) values
  (
    '39000000-0000-0000-0000-000000000901'::uuid, '29000000-0000-0000-0000-000000000901'::uuid,
    'sandbox', 'Order A9-001', 'api', 'paid', 1500, 'BRL', 'A9 paid fixture',
    '{"name":"SENSITIVE_CUSTOMER_A9"}'::jsonb, '{"secret":"SENSITIVE_METADATA_A9"}'::jsonb,
    'a9-pricing-v0', 'ceil-bp-v1', 100, 1400, 75, 500,
    '2026-08-17T07:00:00Z'::timestamptz, '2026-08-17T06:10:00Z'::timestamptz,
    '2026-08-17T06:00:00Z'::timestamptz, '2026-08-17T06:10:00Z'::timestamptz
  ),
  (
    '39000000-0000-0000-0000-000000000902'::uuid, '29000000-0000-0000-0000-000000000901'::uuid,
    'sandbox', ' Exact Ref ', 'api', 'pending', 2000, 'BRL', 'A9 pending fixture',
    '{"email":"SENSITIVE_CUSTOMER_A9"}'::jsonb, '{"private":"SENSITIVE_METADATA_A9"}'::jsonb,
    'a9-pricing-v0', 'ceil-bp-v1', 0, 2000, null, 0,
    '2026-08-17T07:00:00Z'::timestamptz, null,
    '2026-08-17T06:00:00Z'::timestamptz, '2026-08-17T06:00:00Z'::timestamptz
  ),
  (
    '39000000-0000-0000-0000-000000000903'::uuid, '29000000-0000-0000-0000-000000000901'::uuid,
    'sandbox', 'CaseSensitive', 'api', 'creating', 3000, 'BRL', 'A9 execution unknown fixture',
    '{"document":"SENSITIVE_CUSTOMER_A9"}'::jsonb, '{"private":"SENSITIVE_METADATA_A9"}'::jsonb,
    'a9-pricing-v0', 'ceil-bp-v1', 0, 3000, null, 0,
    '2026-08-17T07:00:00Z'::timestamptz, null,
    '2026-08-17T05:00:00Z'::timestamptz, '2026-08-17T05:00:00Z'::timestamptz
  ),
  (
    '39000000-0000-0000-0000-000000000904'::uuid, '29000000-0000-0000-0000-000000000901'::uuid,
    'sandbox', 'casesensitive', 'api', 'failed', 4000, 'BRL', 'A9 failed fixture',
    null, null, 'a9-pricing-v0', 'ceil-bp-v1', 0, 4000, null, 0,
    null, null, '2026-08-17T04:00:00Z'::timestamptz, '2026-08-17T04:00:00Z'::timestamptz
  ),
  (
    '39000000-0000-0000-0000-000000000905'::uuid, '29000000-0000-0000-0000-000000000901'::uuid,
    'sandbox', 'cancelled-a9', 'api', 'cancelled', 5000, 'BRL', 'A9 cancelled fixture',
    null, null, 'a9-pricing-v0', 'ceil-bp-v1', 0, 5000, null, 0,
    null, null, '2026-08-17T03:00:00Z'::timestamptz, '2026-08-17T03:00:00Z'::timestamptz
  ),
  (
    '39000000-0000-0000-0000-000000000906'::uuid, '29000000-0000-0000-0000-000000000901'::uuid,
    'sandbox', repeat('X', 5000), 'api', 'expired', 6000, 'BRL', 'A9 large external id fixture',
    null, null, 'a9-pricing-v0', 'ceil-bp-v1', 0, 6000, null, 0,
    null, null, '2026-08-17T02:00:00Z'::timestamptz, '2026-08-17T02:00:00Z'::timestamptz
  ),
  (
    '39000000-0000-0000-0000-000000000907'::uuid, '29000000-0000-0000-0000-000000000901'::uuid,
    'sandbox', 'pending-older-a9', 'api', 'pending', 7000, 'BRL', 'A9 older pending fixture',
    null, null, 'a9-pricing-v0', 'ceil-bp-v1', 0, 7000, null, 0,
    '2026-08-17T02:00:00Z'::timestamptz, null,
    '2026-08-17T01:00:00Z'::timestamptz, '2026-08-17T01:00:00Z'::timestamptz
  ),
  (
    '39000000-0000-0000-0000-000000000908'::uuid, '29000000-0000-0000-0000-000000000901'::uuid,
    'production', 'production-a9', 'api', 'paid', 8000, 'BRL', 'A9 production fixture',
    null, null, 'a9-pricing-v0', 'ceil-bp-v1', 0, 8000, null, 0,
    null, '2026-08-17T01:10:00Z'::timestamptz,
    '2026-08-17T01:00:00Z'::timestamptz, '2026-08-17T01:10:00Z'::timestamptz
  ),
  (
    '39000000-0000-0000-0000-000000000909'::uuid, '29000000-0000-0000-0000-000000000902'::uuid,
    'sandbox', 'foreign-a9', 'api', 'paid', 9000, 'BRL', 'A9 foreign tenant fixture',
    null, null, 'a9-pricing-v0', 'ceil-bp-v1', 0, 9000, null, 0,
    null, '2026-08-17T08:10:00Z'::timestamptz,
    '2026-08-17T08:00:00Z'::timestamptz, '2026-08-17T08:10:00Z'::timestamptz
  );

insert into app.provider_attempts (
  id, payment_id, provider_id, provider_account_id, operation, attempt_number, state,
  client_reference, request_fingerprint, provider_payment_id, provider_txid,
  provider_status_raw, pix_copy_paste, pix_qr_reference, expires_at, created_at, updated_at
) values
  (
    '79000000-0000-0000-0000-000000000901'::uuid, '39000000-0000-0000-0000-000000000901'::uuid,
    '59000000-0000-0000-0000-000000000901'::uuid, '69000000-0000-0000-0000-000000000901'::uuid,
    'create_pix_charge', 1, 'succeeded', 'a9-client-paid', repeat('a', 64),
    'a9-provider-paid', 'a9-paid-tx', 'provider-sensitive-status-a9',
    'A9_PAID_COPY', 'A9_PAID_QR', '2026-08-17T07:00:00Z'::timestamptz,
    '2026-08-17T06:00:00Z'::timestamptz, '2026-08-17T06:05:00Z'::timestamptz
  ),
  (
    '79000000-0000-0000-0000-000000000902'::uuid, '39000000-0000-0000-0000-000000000902'::uuid,
    '59000000-0000-0000-0000-000000000901'::uuid, '69000000-0000-0000-0000-000000000901'::uuid,
    'create_pix_charge', 1, 'succeeded', 'a9-client-pending', repeat('b', 64),
    'a9-provider-pending', 'a9-pending-tx', 'provider-sensitive-status-a9',
    'A9_PENDING_COPY', 'A9_PENDING_QR', '2026-08-17T07:00:00Z'::timestamptz,
    '2026-08-17T06:00:00Z'::timestamptz, '2026-08-17T06:01:00Z'::timestamptz
  ),
  (
    '79000000-0000-0000-0000-000000000903'::uuid, '39000000-0000-0000-0000-000000000903'::uuid,
    '59000000-0000-0000-0000-000000000901'::uuid, '69000000-0000-0000-0000-000000000901'::uuid,
    'create_pix_charge', 1, 'execution_unknown', 'a9-client-unknown', repeat('c', 64),
    null, null, 'provider-sensitive-status-a9', null, null, '2026-08-17T07:00:00Z'::timestamptz,
    '2026-08-17T05:00:00Z'::timestamptz, '2026-08-17T05:00:00Z'::timestamptz
  );
SQL

state_counts() {
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator='|' --command \
    "select (select count(*) from app.payments),
            (select count(*) from app.provider_attempts),
            (select count(*) from app.provider_events),
            (select count(*) from app.request_idempotency),
            (select count(*) from app.audit_events),
            (select count(*) from app.accounts),
            (select count(*) from app.ledger_transactions),
            (select count(*) from app.ledger_entries),
            (select count(*) from app.payouts),
            (select count(*) from app.payout_attempts),
            (select count(*) from app.refunds),
            (select count(*) from app.refund_attempts),
            (select count(*) from app.jobs),
            (select count(*) from app.webhook_events),
            (select count(*) from app.webhook_deliveries),
            (select count(*) from app.webhook_endpoints),
            (select count(*) from app.api_credentials),
            (select count(*) from app.api_credential_token_windows);"
}

before_counts="$(state_counts)"
node tests/application/049_a9_merchant_transaction_operations_runtime_driver.mjs
after_counts="$(state_counts)"
[[ "${after_counts}" == "${before_counts}" ]]

psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_api_execute bigint;
  v_worker_execute bigint;
  v_status_index text;
  v_external_index text;
begin
  if not has_function_privilege(
    'swiftpay_api',
    'app.list_dashboard_transactions(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'swiftpay_api', 'app.get_dashboard_transaction(uuid,uuid,text,uuid)', 'EXECUTE'
  ) then
    raise exception 'A9 API routine capability missing';
  end if;

  if has_function_privilege(
    'swiftpay_worker',
    'app.list_dashboard_transactions(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'swiftpay_worker', 'app.get_dashboard_transaction(uuid,uuid,text,uuid)', 'EXECUTE'
  ) then
    raise exception 'A9 worker gained transaction read capability';
  end if;

  if has_table_privilege('swiftpay_api', 'app.payments', 'SELECT')
     or has_table_privilege('swiftpay_api', 'app.provider_attempts', 'SELECT')
     or has_table_privilege('swiftpay_worker', 'app.payments', 'SELECT')
     or has_table_privilege('swiftpay_worker', 'app.provider_attempts', 'SELECT') then
    raise exception 'A9 direct protected table SELECT widened';
  end if;

  select count(*) into v_api_execute
  from information_schema.routine_privileges
  where routine_schema = 'app' and grantee = 'swiftpay_api' and privilege_type = 'EXECUTE';

  select count(*) into v_worker_execute
  from information_schema.routine_privileges
  where routine_schema = 'app' and grantee = 'swiftpay_worker' and privilege_type = 'EXECUTE';

  if v_api_execute <> 24 then
    raise exception 'A9 post-A14 API capability count drift: %', v_api_execute;
  end if;
  if v_worker_execute <> 6 then
    raise exception 'A9 worker capability count drift: %', v_worker_execute;
  end if;

  if not coalesce((
    select prosecdef and provolatile = 's' and 'search_path=""' = any(proconfig)
    from pg_proc where oid = to_regprocedure(
      'app.list_dashboard_transactions(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer)'
    )
  ), false) then
    raise exception 'A9 list routine security/volatility/search_path drift';
  end if;

  if not coalesce((
    select prosecdef and provolatile = 's' and 'search_path=""' = any(proconfig)
    from pg_proc where oid = to_regprocedure('app.get_dashboard_transaction(uuid,uuid,text,uuid)')
  ), false) then
    raise exception 'A9 detail routine security/volatility/search_path drift';
  end if;

  select pg_get_indexdef(to_regclass('app.payments_dashboard_status_created_idx')) into v_status_index;
  select pg_get_indexdef(to_regclass('app.payments_dashboard_external_id_created_idx')) into v_external_index;
  if v_status_index is null or position('collection_status' in v_status_index) = 0
     or position('created_at DESC' in v_status_index) = 0 then
    raise exception 'A9 status index definition drift';
  end if;
  if v_external_index is null or position('md5(external_id)' in v_external_index) = 0
     or position('WHERE (external_id IS NOT NULL)' in v_external_index) = 0 then
    raise exception 'A9 externalId expression index definition drift';
  end if;
end;
$$;
SQL

echo 'SwiftPay A9 merchant transaction operations real-database acceptance: OK'
