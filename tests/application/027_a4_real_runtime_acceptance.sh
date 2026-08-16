#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_WORKER_DATABASE_URL:?SWIFTPAY_WORKER_DATABASE_URL is required}"
: "${SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY:?SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY is required}"

readonly ADMIN_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
readonly MERCHANT_ID='b4300000-0000-0000-0000-000000000001'
readonly ENDPOINT_ID='b4200000-0000-0000-0000-000000000001'
readonly SECRET_CIPHERTEXT='aes-256-gcm-v1$AAECAwQFBgcICQoL$MGqlfqa6oy_Scaa5gt1NW7TuvlWSGDsZXlfUty5dNYQ2KJedzaJ2_RI$JHRLQtcGf8jjgEcrEbBimQ'
readonly STALE_TOKEN='b4ff0000-0000-0000-0000-000000000001'
readonly DRIVER='tests/application/027_a4_real_runtime_driver.mjs'

read_counts() {
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator=' ' --command \
    "select
       (select count(*) from app.payments),
       (select count(*) from app.accounts),
       (select count(*) from app.ledger_transactions),
       (select count(*) from app.ledger_entries);"
}

record_event() {
  local source_id="$1"
  psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 \
    --set=merchant_id="${MERCHANT_ID}" \
    --set=source_id="${source_id}" <<'SQL' >/dev/null
select app.record_webhook_event(
  :'merchant_id'::uuid,
  'sandbox',
  'payment.paid',
  'payment',
  :'source_id'::uuid,
  'payment',
  :'source_id'::uuid,
  'payment-v1',
  jsonb_build_object(
    'id', :'source_id',
    'amount', 12345,
    'currency', 'BRL',
    'method', 'pix',
    'status', 'paid'
  ),
  '2030-01-01T00:00:00Z'::timestamptz
);
SQL
}

state_for_source() {
  local source_id="$1"
  local projection="$2"
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --set=source_id="${source_id}" --command \
    "select ${projection}
       from app.webhook_events ev
       join app.webhook_deliveries d on d.webhook_event_id=ev.id
       join app.webhook_endpoints ep on ep.id=d.webhook_endpoint_id
       join app.jobs j
         on j.kind='merchant_webhook_delivery'
        and j.resource_type='webhook_delivery'
        and j.resource_id=d.id
      where ev.source_type='payment'
        and ev.source_id=:'source_id'::uuid
        and ev.type='payment.paid';"
}

run_driver() {
  local mode="$1"
  local log_file="/tmp/swiftpay-a4-${mode}.log"
  if ! node "${DRIVER}" "${mode}" >"${log_file}" 2>&1; then
    echo "A4 runtime acceptance driver failed in phase ${mode}" >&2
    grep '^A4_DIAG ' "${log_file}" >&2 || true
    exit 1
  fi
  if grep -Eq 'whsec_|MGqlfqa6|JHRLQtcG|v1=[0-9a-f]{64}' "${log_file}"; then
    echo "A4 runtime acceptance leaked signing material in phase ${mode}" >&2
    exit 1
  fi
  grep -q "A4 runtime phase ${mode}: OK" "${log_file}"
  cat "${log_file}"
}

read -r before_payments before_accounts before_ledger_transactions before_ledger_entries < <(read_counts)

# A1-A3 real acceptances run in the same isolated Postgres before A4. A3
# intentionally leaves its durable payment.paid outbox pending for A4 to consume.
# Quarantine only those pre-existing due items so this acceptance can prove A4
# behavior against its own fixtures without deleting, completing or otherwise
# rewriting historical outbox state. A pre-existing live lease is an error.
psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$
begin
  if exists (
    select 1
      from app.jobs j
      join app.webhook_deliveries d
        on d.id=j.resource_id
     where j.kind='merchant_webhook_delivery'
       and j.resource_type='webhook_delivery'
       and (j.state='leased' or d.state='leased')
  ) then
    raise exception 'pre-existing leased webhook delivery prevents isolated A4 acceptance';
  end if;
end
$$;

update app.jobs j
   set available_at='2099-01-01T00:00:00Z'::timestamptz,
       updated_at=now()
  from app.webhook_deliveries d
 where j.kind='merchant_webhook_delivery'
   and j.resource_type='webhook_delivery'
   and j.resource_id=d.id
   and j.state='pending'
   and d.state='pending';

update app.webhook_deliveries d
   set next_attempt_at='2099-01-01T00:00:00Z'::timestamptz,
       updated_at=now()
  from app.jobs j
 where j.kind='merchant_webhook_delivery'
   and j.resource_type='webhook_delivery'
   and j.resource_id=d.id
   and j.state='pending'
   and d.state='pending'
   and j.available_at='2099-01-01T00:00:00Z'::timestamptz;
SQL

psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=merchant_id="${MERCHANT_ID}" \
  --set=endpoint_id="${ENDPOINT_ID}" \
  --set=secret_ciphertext="${SECRET_CIPHERTEXT}" <<'SQL' >/dev/null
insert into app.merchants (id, name, lifecycle_status)
values (:'merchant_id'::uuid, 'A4 Runtime Acceptance Merchant', 'active');

insert into app.webhook_endpoints (
  id,
  merchant_id,
  environment,
  url,
  status,
  secret_ciphertext,
  secret_version,
  previous_secret_ciphertext,
  previous_secret_version,
  previous_secret_expires_at,
  subscribed_events
) values (
  :'endpoint_id'::uuid,
  :'merchant_id'::uuid,
  'sandbox',
  'https://merchant.example.test/swiftpay',
  'active',
  :'secret_ciphertext',
  7,
  null,
  null,
  null,
  '["payment.paid"]'::jsonb
);
SQL

# Phase 1: freeze version 7 on the delivery, rotate the endpoint to version 8,
# and hold the first transport call while a second worker competes for the lease.
readonly CONCURRENCY_SOURCE='b4400000-0000-0000-0000-000000000001'
record_event "${CONCURRENCY_SOURCE}"
psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=endpoint_id="${ENDPOINT_ID}" \
  --set=secret_ciphertext="${SECRET_CIPHERTEXT}" <<'SQL' >/dev/null
update app.webhook_endpoints
   set secret_ciphertext='cipher-v8-not-valid-for-snapshot-v7',
       secret_version=8,
       previous_secret_ciphertext=:'secret_ciphertext',
       previous_secret_version=7,
       previous_secret_expires_at='2099-01-01T00:00:00Z'::timestamptz,
       updated_at=now()
 where id=:'endpoint_id'::uuid;
SQL
run_driver 'concurrency-success'

concurrency_state="$(state_for_source "${CONCURRENCY_SOURCE}" \
  "j.state || '|' || d.state || '|' || j.attempt_count || '|' || d.attempt_count || '|' || d.signing_secret_version || '|' || ep.secret_version || '|' || ep.previous_secret_version")"
[[ "${concurrency_state}" == 'completed|succeeded|1|1|7|8|7' ]]

# Restore a valid current v7 secret for independent subsequent phases.
psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=endpoint_id="${ENDPOINT_ID}" \
  --set=secret_ciphertext="${SECRET_CIPHERTEXT}" <<'SQL' >/dev/null
update app.webhook_endpoints
   set status='active',
       secret_ciphertext=:'secret_ciphertext',
       secret_version=7,
       previous_secret_ciphertext=null,
       previous_secret_version=null,
       previous_secret_expires_at=null,
       updated_at=now()
 where id=:'endpoint_id'::uuid;
SQL

# Phase 2: a 503 is one network attempt and one durable retry, never an
# in-process HTTP retry. Job and Delivery must share exactly the same next due time.
readonly RETRY_SOURCE='b4400000-0000-0000-0000-000000000002'
record_event "${RETRY_SOURCE}"
run_driver 'retry-once'
retry_state="$(state_for_source "${RETRY_SOURCE}" \
  "j.state || '|' || d.state || '|' || j.attempt_count || '|' || d.attempt_count || '|' || coalesce(d.last_http_status::text,'') || '|' || coalesce(j.last_error_class,'') || '|' || coalesce(j.last_error_code,'') || '|' || coalesce(d.last_error_class,'') || '|' || coalesce(d.last_error_code,'') || '|' || (j.available_at=d.next_attempt_at)::text || '|' || (j.available_at>now())::text")"
[[ "${retry_state}" == 'pending|pending|1|1|503|transient|http_503|transient|http_503|true|true' ]]

# Keep the proven retry pending but move it outside this acceptance horizon so it
# cannot interfere with the disable/reclaim scenarios below.
psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 --set=source_id="${RETRY_SOURCE}" <<'SQL' >/dev/null
with target as (
  select d.id as delivery_id, j.id as job_id
    from app.webhook_events ev
    join app.webhook_deliveries d on d.webhook_event_id=ev.id
    join app.jobs j on j.resource_id=d.id and j.kind='merchant_webhook_delivery'
   where ev.source_type='payment' and ev.source_id=:'source_id'::uuid and ev.type='payment.paid'
)
update app.jobs j
   set available_at='2099-01-01T00:00:00Z'::timestamptz,
       updated_at=now()
  from target t
 where j.id=t.job_id;

with target as (
  select d.id as delivery_id
    from app.webhook_events ev
    join app.webhook_deliveries d on d.webhook_event_id=ev.id
   where ev.source_type='payment' and ev.source_id=:'source_id'::uuid and ev.type='payment.paid'
)
update app.webhook_deliveries d
   set next_attempt_at='2099-01-01T00:00:00Z'::timestamptz,
       updated_at=now()
  from target t
 where d.id=t.delivery_id;
SQL

# Phase 3: disable after fanout. Claim path terminalizes locally without
# incrementing dispatch attempts and without invoking endpoint policy/transport.
readonly DISABLED_SOURCE='b4400000-0000-0000-0000-000000000003'
record_event "${DISABLED_SOURCE}"
psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=endpoint_id="${ENDPOINT_ID}" --command \
  "update app.webhook_endpoints set status='disabled', updated_at=now() where id=:'endpoint_id'::uuid;" >/dev/null
run_driver 'disabled'
disabled_state="$(state_for_source "${DISABLED_SOURCE}" \
  "j.state || '|' || d.state || '|' || j.attempt_count || '|' || d.attempt_count")"
[[ "${disabled_state}" == 'completed|disabled|0|0' ]]

# Phase 4: seed one expired shared lease, reclaim it as attempt two, prove the
# stale token is rejected false, then resolve with the new current token.
readonly STALE_SOURCE='b4400000-0000-0000-0000-000000000004'
psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=endpoint_id="${ENDPOINT_ID}" --command \
  "update app.webhook_endpoints set status='active', updated_at=now() where id=:'endpoint_id'::uuid;" >/dev/null
record_event "${STALE_SOURCE}"
psql "${ADMIN_DB_URL}" --quiet --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=source_id="${STALE_SOURCE}" --set=stale_token="${STALE_TOKEN}" <<'SQL' >/dev/null
with target as (
  select d.id as delivery_id, j.id as job_id
    from app.webhook_events ev
    join app.webhook_deliveries d on d.webhook_event_id=ev.id
    join app.jobs j on j.resource_id=d.id and j.kind='merchant_webhook_delivery'
   where ev.source_type='payment' and ev.source_id=:'source_id'::uuid and ev.type='payment.paid'
)
update app.jobs j
   set state='leased',
       attempt_count=1,
       lease_owner='a4-stale-worker',
       lease_token=:'stale_token'::uuid,
       lease_expires_at=now()-interval '60 seconds',
       last_started_at=now()-interval '90 seconds',
       updated_at=now()
  from target t
 where j.id=t.job_id;

with target as (
  select d.id as delivery_id
    from app.webhook_events ev
    join app.webhook_deliveries d on d.webhook_event_id=ev.id
   where ev.source_type='payment' and ev.source_id=:'source_id'::uuid and ev.type='payment.paid'
)
update app.webhook_deliveries d
   set state='leased',
       attempt_count=1,
       lease_token=:'stale_token'::uuid,
       lease_expires_at=now()-interval '60 seconds',
       first_attempt_at=now()-interval '90 seconds',
       last_attempt_at=now()-interval '90 seconds',
       updated_at=now()
  from target t
 where d.id=t.delivery_id;
SQL
run_driver 'stale-fence'
stale_state="$(state_for_source "${STALE_SOURCE}" \
  "j.state || '|' || d.state || '|' || j.attempt_count || '|' || d.attempt_count || '|' || coalesce(d.last_http_status::text,'') || '|' || (j.lease_token is null)::text || '|' || (d.lease_token is null)::text")"
[[ "${stale_state}" == 'completed|succeeded|2|2|204|true|true' ]]

read -r after_payments after_accounts after_ledger_transactions after_ledger_entries < <(read_counts)
[[ "${after_payments}" == "${before_payments}" ]]
[[ "${after_accounts}" == "${before_accounts}" ]]
[[ "${after_ledger_transactions}" == "${before_ledger_transactions}" ]]
[[ "${after_ledger_entries}" == "${before_ledger_entries}" ]]

echo 'SwiftPay A4 real merchant webhook runtime acceptance: OK'
