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
if ! node tests/application/046_a8_api_credential_management_runtime_driver.mjs; then
  echo 'A8_DIAG sanitized create failure state follows' >&2
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator='|' --command \
    "select 'credential', count(*), coalesce(string_agg(status || ':' || revision::text || ':' || secret_version::text, ',' order by id), '')
       from app.api_credentials where merchant_id = '${MERCHANT_ID}'::uuid
     union all
     select 'idempotency', count(*), coalesce(string_agg(operation || ':' || state, ',' order by operation), '')
       from app.request_idempotency where merchant_id = '${MERCHANT_ID}'::uuid
     union all
     select 'audit', count(*), coalesce(string_agg(action, ',' order by action), '')
       from app.audit_events where merchant_id = '${MERCHANT_ID}'::uuid;" >&2
  exit 1
fi
after_financial="$(financial_counts)"
[[ "${after_financial}" == "${before_financial}" ]]

psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_merchant uuid := '28000000-0000-0000-0000-000000000801'::uuid;
  v_api_execute_count bigint;
  v_worker_execute_count bigint;
begin
  if (select count(*) from app.api_credentials where merchant_id = v_merchant) <> 12 then
    raise exception 'A8 credential count drift';
  end if;
  if (select count(*) from app.api_credentials where merchant_id = v_merchant and environment = 'sandbox' and status = 'active') <> 10 then
    raise exception 'A8 transactional active credential limit drift';
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
  if (select count(*) from app.audit_events where merchant_id = v_merchant and resource_type = 'api_credential') <> 14 then
    raise exception 'A8 audit exactly-once count drift';
  end if;

  if has_table_privilege('swiftpay_api', 'app.api_credentials', 'SELECT')
     or has_table_privilege('swiftpay_api', 'app.api_credentials', 'INSERT')
     or has_table_privilege('swiftpay_api', 'app.api_credentials', 'UPDATE')
     or has_table_privilege('swiftpay_api', 'app.api_credentials', 'DELETE')
     or has_table_privilege('swiftpay_api', 'app.api_credential_token_windows', 'SELECT')
     or has_table_privilege('swiftpay_api', 'app.request_idempotency', 'SELECT')
     or has_table_privilege('swiftpay_api', 'app.audit_events', 'SELECT') then
    raise exception 'A8 swiftpay_api direct protected-table authority widened';
  end if;
  if has_table_privilege('swiftpay_worker', 'app.api_credentials', 'SELECT')
     or has_table_privilege('swiftpay_worker', 'app.api_credentials', 'INSERT')
     or has_table_privilege('swiftpay_worker', 'app.api_credentials', 'UPDATE')
     or has_table_privilege('swiftpay_worker', 'app.api_credentials', 'DELETE')
     or has_table_privilege('swiftpay_worker', 'app.api_credential_token_windows', 'SELECT')
     or has_table_privilege('swiftpay_worker', 'app.request_idempotency', 'SELECT')
     or has_table_privilege('swiftpay_worker', 'app.audit_events', 'SELECT') then
    raise exception 'A8 swiftpay_worker direct protected-table authority widened';
  end if;

  if has_function_privilege('swiftpay_api', 'app._a8_begin_api_credential_command(uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('swiftpay_api', 'app._a8_complete_api_credential_command(uuid,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('swiftpay_worker', 'app._a8_begin_api_credential_command(uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('swiftpay_worker', 'app._a8_complete_api_credential_command(uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'A8 private helper execution leaked to runtime role';
  end if;

  select count(*) into v_api_execute_count
    from information_schema.routine_privileges
   where routine_schema = 'app'
     and grantee = 'swiftpay_api'
     and privilege_type = 'EXECUTE';
  select count(*) into v_worker_execute_count
    from information_schema.routine_privileges
   where routine_schema = 'app'
     and grantee = 'swiftpay_worker'
     and privilege_type = 'EXECUTE';

  if v_api_execute_count <> 21 then
    raise exception 'A8 swiftpay_api capability count drift: %', v_api_execute_count;
  end if;
  if v_worker_execute_count <> 6 then
    raise exception 'A8 swiftpay_worker capability count drift: %', v_worker_execute_count;
  end if;
end;
$$;
SQL

echo 'SwiftPay A8 API credential management real-database acceptance: OK'
