#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"
: "${SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY:?SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY is required}"

readonly ADMIN_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
readonly MERCHANT_ID='28000000-0000-0000-0000-000000000801'

psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 <<'SQL'
insert into app.merchants (id, name, lifecycle_status)
values ('28000000-0000-0000-0000-000000000801'::uuid, 'A8 Runtime Merchant', 'active');

insert into auth.users (
  id, aud, role, email, raw_user_meta_data, raw_app_meta_data,
  is_anonymous, deleted_at, created_at, updated_at
) values
  ('18000000-0000-0000-0000-000000000801'::uuid, 'authenticated', 'authenticated', 'a8-member@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('18000000-0000-0000-0000-000000000802'::uuid, 'authenticated', 'authenticated', 'a8-admin@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('18000000-0000-0000-0000-000000000803'::uuid, 'authenticated', 'authenticated', 'a8-owner@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now());

insert into app.merchant_members (merchant_id, user_id, role, status) values
  ('28000000-0000-0000-0000-000000000801'::uuid, '18000000-0000-0000-0000-000000000801'::uuid, 'member', 'active'),
  ('28000000-0000-0000-0000-000000000801'::uuid, '18000000-0000-0000-0000-000000000802'::uuid, 'admin', 'active'),
  ('28000000-0000-0000-0000-000000000801'::uuid, '18000000-0000-0000-0000-000000000803'::uuid, 'owner', 'active');
SQL

financial_counts() {
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator='|' --command \
    "select (select count(*) from app.payments),
            (select count(*) from app.provider_attempts),
            (select count(*) from app.provider_events),
            (select count(*) from app.ledger_transactions),
            (select count(*) from app.ledger_entries),
            (select count(*) from app.payouts),
            (select count(*) from app.refunds),
            (select count(*) from app.jobs),
            (select count(*) from app.webhook_events),
            (select count(*) from app.webhook_deliveries);"
}

before_financial="$(financial_counts)"
node tests/application/046_a8_api_credential_management_runtime_driver.mjs
after_financial="$(financial_counts)"
[[ "${after_financial}" == "${before_financial}" ]]

psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_merchant uuid := '28000000-0000-0000-0000-000000000801'::uuid;
begin
  if (select count(*) from app.api_credentials where merchant_id = v_merchant) <> 2 then
    raise exception 'A8 credential count drift';
  end if;
  if (select count(*) from app.api_credentials where merchant_id = v_merchant and environment = 'sandbox' and status = 'revoked') <> 1 then
    raise exception 'A8 sandbox revoke state drift';
  end if;
  if (select count(*) from app.api_credentials where merchant_id = v_merchant and environment = 'production' and status = 'active') <> 1 then
    raise exception 'A8 production owner create drift';
  end if;
  if exists (
    select 1 from app.api_credentials
     where merchant_id = v_merchant
       and (secret_verifier like '%sk_sandbox_%' or secret_verifier like '%sk_production_%')
  ) then
    raise exception 'A8 plaintext secret persisted in credential verifier';
  end if;
  if exists (
    select 1 from app.request_idempotency
     where merchant_id = v_merchant
       and (coalesce(response_snapshot::text, '') like '%sk_sandbox_%'
            or coalesce(response_snapshot::text, '') like '%sk_production_%'
            or coalesce(response_snapshot::text, '') like '%scrypt-v1%')
  ) then
    raise exception 'A8 secret material leaked into idempotency snapshot';
  end if;
  if exists (
    select 1 from app.audit_events
     where merchant_id = v_merchant
       and (metadata::text like '%sk_sandbox_%'
            or metadata::text like '%sk_production_%'
            or metadata::text like '%scrypt-v1%')
  ) then
    raise exception 'A8 secret material leaked into audit metadata';
  end if;
  if (select count(*) from app.audit_events where merchant_id = v_merchant and resource_type = 'api_credential') <> 4 then
    raise exception 'A8 audit exactly-once count drift';
  end if;

  if has_table_privilege('swiftpay_api', 'app.api_credentials', 'SELECT')
     or has_table_privilege('swiftpay_api', 'app.api_credentials', 'INSERT')
     or has_table_privilege('swiftpay_api', 'app.api_credentials', 'UPDATE')
     or has_table_privilege('swiftpay_api', 'app.api_credentials', 'DELETE') then
    raise exception 'A8 swiftpay_api direct credential table authority widened';
  end if;
  if has_table_privilege('swiftpay_worker', 'app.api_credentials', 'SELECT')
     or has_table_privilege('swiftpay_worker', 'app.api_credentials', 'INSERT')
     or has_table_privilege('swiftpay_worker', 'app.api_credentials', 'UPDATE')
     or has_table_privilege('swiftpay_worker', 'app.api_credentials', 'DELETE') then
    raise exception 'A8 swiftpay_worker direct credential table authority widened';
  end if;
end;
$$;
SQL

echo 'SwiftPay A8 API credential management real-database acceptance: OK'
