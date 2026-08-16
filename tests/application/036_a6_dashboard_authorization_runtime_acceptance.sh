#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"

readonly ADMIN_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
readonly MERCHANT_ID='26000000-0000-0000-0000-000000000601'

psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 <<'SQL'
insert into app.merchants (id, name, lifecycle_status)
values ('26000000-0000-0000-0000-000000000601'::uuid, 'A6 Runtime Merchant', 'active');

insert into auth.users (
  id, aud, role, email, raw_user_meta_data, raw_app_meta_data,
  is_anonymous, deleted_at, created_at, updated_at
) values
  ('16000000-0000-0000-0000-000000000601'::uuid, 'authenticated', 'authenticated', 'a6-member@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('16000000-0000-0000-0000-000000000602'::uuid, 'authenticated', 'authenticated', 'a6-admin@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('16000000-0000-0000-0000-000000000603'::uuid, 'authenticated', 'authenticated', 'a6-owner@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('16000000-0000-0000-0000-000000000604'::uuid, 'authenticated', 'authenticated', 'a6-disabled@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('16000000-0000-0000-0000-000000000605'::uuid, 'authenticated', 'authenticated', null, '{}'::jsonb, '{}'::jsonb, true, null, now(), now()),
  ('16000000-0000-0000-0000-000000000606'::uuid, 'authenticated', 'authenticated', 'a6-deleted@example.test', '{}'::jsonb, '{}'::jsonb, false, now(), now(), now()),
  ('16000000-0000-0000-0000-000000000607'::uuid, 'authenticated', 'authenticated', 'a6-spoof@example.test', '{"merchant_id":"26000000-0000-0000-0000-000000000601","role":"owner"}'::jsonb, '{"environment":"production","role":"owner"}'::jsonb, false, null, now(), now()),
  ('16000000-0000-0000-0000-000000000608'::uuid, 'authenticated', 'authenticated', 'a6-mutable@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now());

insert into app.merchant_members (merchant_id, user_id, role, status) values
  ('26000000-0000-0000-0000-000000000601'::uuid, '16000000-0000-0000-0000-000000000601'::uuid, 'member', 'active'),
  ('26000000-0000-0000-0000-000000000601'::uuid, '16000000-0000-0000-0000-000000000602'::uuid, 'admin', 'active'),
  ('26000000-0000-0000-0000-000000000601'::uuid, '16000000-0000-0000-0000-000000000603'::uuid, 'owner', 'active'),
  ('26000000-0000-0000-0000-000000000601'::uuid, '16000000-0000-0000-0000-000000000604'::uuid, 'admin', 'disabled'),
  ('26000000-0000-0000-0000-000000000601'::uuid, '16000000-0000-0000-0000-000000000605'::uuid, 'owner', 'active'),
  ('26000000-0000-0000-0000-000000000601'::uuid, '16000000-0000-0000-0000-000000000606'::uuid, 'owner', 'active'),
  ('26000000-0000-0000-0000-000000000601'::uuid, '16000000-0000-0000-0000-000000000608'::uuid, 'owner', 'active');
SQL

state_counts() {
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator='|' --command \
    "select (select count(*) from app.audit_events),
            (select count(*) from app.payments),
            (select count(*) from app.ledger_transactions),
            (select count(*) from app.jobs),
            (select count(*) from app.webhook_events);"
}

before_counts="$(state_counts)"

run_case() {
  node tests/application/036_a6_dashboard_authorization_runtime_driver.mjs "$@"
}

run_case member "${MERCHANT_ID}" sandbox member authorized member
run_case admin "${MERCHANT_ID}" sandbox member authorized admin
run_case admin "${MERCHANT_ID}" sandbox admin authorized admin
run_case owner "${MERCHANT_ID}" sandbox member authorized owner
run_case owner "${MERCHANT_ID}" sandbox admin authorized owner
run_case owner "${MERCHANT_ID}" sandbox owner authorized owner
run_case member "${MERCHANT_ID}" sandbox admin forbidden
run_case disabled "${MERCHANT_ID}" sandbox member forbidden
run_case anonymous "${MERCHANT_ID}" sandbox member forbidden
run_case deleted "${MERCHANT_ID}" sandbox member forbidden
run_case missing "${MERCHANT_ID}" sandbox member forbidden
run_case spoof "${MERCHANT_ID}" sandbox member forbidden
run_case mutable "${MERCHANT_ID}" sandbox owner authorized owner

psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 --command \
  "update app.merchant_members
      set role = 'member'
    where merchant_id = '${MERCHANT_ID}'::uuid
      and user_id = '16000000-0000-0000-0000-000000000608'::uuid;"

run_case mutable "${MERCHANT_ID}" sandbox member authorized member
run_case mutable "${MERCHANT_ID}" sandbox owner forbidden

psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 --command \
  "update app.merchant_members
      set status = 'disabled'
    where merchant_id = '${MERCHANT_ID}'::uuid
      and user_id = '16000000-0000-0000-0000-000000000608'::uuid;"

run_case mutable "${MERCHANT_ID}" sandbox member forbidden

after_counts="$(state_counts)"
[[ "${after_counts}" == "${before_counts}" ]]

echo 'SwiftPay A6 dashboard authorization real-database acceptance: OK'
