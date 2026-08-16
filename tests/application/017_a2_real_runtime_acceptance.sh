#!/usr/bin/env bash
set -Eeuo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"
: "${SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY:?SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY is required}"

readonly ADMIN_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
readonly API_ONE_PORT='32211'
readonly API_TWO_PORT='32212'
readonly FIXTURE_PATH='tests/application/fixtures/a2_pix_runtime.sql'
readonly OWNER_PUBLIC_KEY='pk_a2_runtime_owner'
readonly FOREIGN_PUBLIC_KEY='pk_a2_runtime_foreign'
readonly PRODUCTION_PUBLIC_KEY='pk_a2_runtime_production'
readonly OWNER_MERCHANT_ID='63000000-0000-0000-0000-000000000001'
readonly FOREIGN_MERCHANT_ID='63000000-0000-0000-0000-000000000002'
readonly EMULATOR_ACCOUNT_ID='66000000-0000-0000-0000-000000000001'
readonly IDEMPOTENCY_KEY='idem-a2-real-runtime-001'

stage='bootstrap'
api_pids=()
cleanup() {
  local pid
  for pid in "${api_pids[@]:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
      wait "${pid}" >/dev/null 2>&1 || true
    fi
  done
}
on_error() {
  local rc="$?"
  trap - ERR
  echo "SwiftPay A2 acceptance failed at stage: ${stage}" >&2
  exit "${rc}"
}
trap cleanup EXIT
trap on_error ERR

wait_for_live() {
  local port="$1"
  for _ in $(seq 1 80); do
    if curl --silent --fail "http://127.0.0.1:${port}/health/live" >/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  echo "A2 API did not become live on port ${port}" >&2
  return 1
}

start_api() {
  local port="$1"
  local log_file="$2"

  SWIFTPAY_ENVIRONMENT=sandbox \
  SWIFTPAY_API_DATABASE_URL="${SWIFTPAY_API_DATABASE_URL}" \
  SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY="${SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY}" \
  SWIFTPAY_API_HOST=127.0.0.1 \
  SWIFTPAY_API_PORT="${port}" \
    node apps/api/dist/index.js >"${log_file}" 2>&1 &
  api_pids+=("$!")
  wait_for_live "${port}"
  [[ "$(curl --silent --output /tmp/swiftpay-a2-ready.json --write-out '%{http_code}' "http://127.0.0.1:${port}/health/ready")" == '200' ]]
}

token_request() {
  local base_url="$1"
  local public_key="$2"
  local secret_key="$3"
  local request_id="$4"
  local body_file="$5"
  local payload

  payload="$(printf '{"grantType":"client_credentials","publicKey":"%s","secretKey":"%s"}' "${public_key}" "${secret_key}")"
  curl --silent --show-error \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    --header 'content-type: application/json' \
    --header "x-request-id: ${request_id}" \
    --data "${payload}" \
    "${base_url}/v1/auth/token"
}

extract_access_token() {
  local body_file="$1"
  node --input-type=module - "${body_file}" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const body = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(typeof body.accessToken, 'string');
assert.ok(body.accessToken.length > 20);
assert.equal(body.tokenType, 'Bearer');
assert.equal(body.expiresIn, 900);
process.stdout.write(body.accessToken);
NODE
}

pix_create_request() {
  local base_url="$1"
  local token="$2"
  local idempotency_key="$3"
  local payload="$4"
  local request_id="$5"
  local body_file="$6"

  curl --silent --show-error \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    --header "authorization: Bearer ${token}" \
    --header 'content-type: application/json' \
    --header "idempotency-key: ${idempotency_key}" \
    --header "x-request-id: ${request_id}" \
    --data "${payload}" \
    "${base_url}/v1/transactions"
}

payment_get_request() {
  local base_url="$1"
  local token="$2"
  local payment_id="$3"
  local request_id="$4"
  local body_file="$5"

  curl --silent --show-error \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    --header "authorization: Bearer ${token}" \
    --header "x-request-id: ${request_id}" \
    "${base_url}/v1/transactions/${payment_id}"
}

assert_race_bodies() {
  local body_one="$1"
  local status_one="$2"
  local body_two="$3"
  local status_two="$4"
  node --input-type=module - "${body_one}" "${status_one}" "${body_two}" "${status_two}" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [bodyOne, statusOne, bodyTwo, statusTwo] = await Promise.all([
  readFile(process.argv[2], 'utf8').then(JSON.parse),
  Promise.resolve(Number(process.argv[3])),
  readFile(process.argv[4], 'utf8').then(JSON.parse),
  Promise.resolve(Number(process.argv[5])),
]);
for (const [body, status] of [[bodyOne, statusOne], [bodyTwo, statusTwo]]) {
  assert.ok(status === 201 || status === 202, `unexpected create status ${status}`);
  assert.equal(typeof body.id, 'string');
  assert.equal(body.method, 'pix');
  assert.equal(body.amount, 12345);
  assert.equal(body.fee, 0);
  assert.equal(body.netAmount, 12345);
  assert.equal(body.currency, 'BRL');
  assert.equal(body.environment, 'sandbox');
  assert.equal(body.externalId, 'order-a2-real-runtime-001');
  assert.equal(body.description, 'A2 real runtime');
  if (body.status === 'creating') {
    assert.equal(status, 202, 'creating response must use 202');
    assert.equal(body.pix, null);
  } else {
    assert.equal(body.status, 'pending');
    assert.match(body.pix?.copyAndPaste ?? '', /^SWIFTPAY_EMULATOR_COPY_/);
    assert.match(body.pix?.qrCode ?? '', /^SWIFTPAY_EMULATOR_QR_/);
    assert.match(body.pix?.txId ?? '', /^swiftpay-emulator-tx:/);
  }
}
assert.equal(bodyOne.id, bodyTwo.id, 'concurrent callers must observe the same logical Payment');
assert.ok(statusOne === 201 || statusTwo === 201, 'at least the execution owner must finish with 201');
NODE
}

assert_final_payment() {
  local body_file="$1"
  node --input-type=module - "${body_file}" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const body = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(typeof body.id, 'string');
assert.equal(body.method, 'pix');
assert.equal(body.amount, 12345);
assert.equal(body.fee, 0);
assert.equal(body.netAmount, 12345);
assert.equal(body.currency, 'BRL');
assert.equal(body.status, 'pending');
assert.equal(body.environment, 'sandbox');
assert.equal(body.externalId, 'order-a2-real-runtime-001');
assert.equal(body.description, 'A2 real runtime');
assert.match(body.pix?.copyAndPaste ?? '', /^SWIFTPAY_EMULATOR_COPY_/);
assert.match(body.pix?.qrCode ?? '', /^SWIFTPAY_EMULATOR_QR_/);
assert.match(body.pix?.txId ?? '', /^swiftpay-emulator-tx:/);
NODE
}

stage='fixture-generation'
A2_SECRET="$(node --input-type=module -e "import { randomBytes } from 'node:crypto'; process.stdout.write(randomBytes(32).toString('base64url')); ")"
A2_VERIFIER="$(A2_SECRET="${A2_SECRET}" node --input-type=module <<'NODE'
import { scryptSync } from 'node:crypto';
const salt = Buffer.from('102132435465768798a9bacbdcedfe0f', 'hex');
const key = scryptSync(process.env.A2_SECRET, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
process.stdout.write(`scrypt-v1$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`);
NODE
)"

stage='fixture-load'
psql "${ADMIN_DB_URL}" \
  --set ON_ERROR_STOP=1 \
  --set "a2_secret_verifier=${A2_VERIFIER}" \
  --file "${FIXTURE_PATH}" >/tmp/swiftpay-a2-fixture.log

stage='fixture-contract'
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.api_credentials where id between '64000000-0000-0000-0000-000000000001'::uuid and '64000000-0000-0000-0000-000000000003'::uuid;")" == '3' ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.provider_accounts where id = '${EMULATOR_ACCOUNT_ID}'::uuid and environment = 'sandbox' and status = 'active' and capabilities @> '{\"create_pix_charge\":true}'::jsonb;")" == '1' ]]
! grep -Fq "${A2_SECRET}" "${FIXTURE_PATH}"
! grep -Fq "${A2_SECRET}" /tmp/swiftpay-a2-fixture.log

stage='dual-api-startup'
start_api "${API_ONE_PORT}" /tmp/swiftpay-a2-api-one.log
start_api "${API_TWO_PORT}" /tmp/swiftpay-a2-api-two.log
readonly API_ONE="http://127.0.0.1:${API_ONE_PORT}"
readonly API_TWO="http://127.0.0.1:${API_TWO_PORT}"

stage='token-exchange'
owner_token_status="$(token_request "${API_ONE}" "${OWNER_PUBLIC_KEY}" "${A2_SECRET}" 'req-a2-owner-token' /tmp/swiftpay-a2-owner-token.json)"
foreign_token_status="$(token_request "${API_TWO}" "${FOREIGN_PUBLIC_KEY}" "${A2_SECRET}" 'req-a2-foreign-token' /tmp/swiftpay-a2-foreign-token.json)"
production_token_status="$(token_request "${API_ONE}" "${PRODUCTION_PUBLIC_KEY}" "${A2_SECRET}" 'req-a2-production-token' /tmp/swiftpay-a2-production-token.json)"
[[ "${owner_token_status}" == '200' ]]
[[ "${foreign_token_status}" == '200' ]]
[[ "${production_token_status}" == '200' ]]
OWNER_TOKEN="$(extract_access_token /tmp/swiftpay-a2-owner-token.json)"
FOREIGN_TOKEN="$(extract_access_token /tmp/swiftpay-a2-foreign-token.json)"
PRODUCTION_TOKEN="$(extract_access_token /tmp/swiftpay-a2-production-token.json)"

readonly CREATE_PAYLOAD='{"method":"pix","amount":12345,"currency":"BRL","description":"A2 real runtime","externalId":"order-a2-real-runtime-001","pixExpirationMinutes":30,"customerName":"A2 Runtime Customer","customerDocument":"12345678901","customerEmail":"a2-runtime@example.invalid","customerPhone":"+5500000000000"}'
readonly CONFLICT_PAYLOAD='{"method":"pix","amount":12346,"currency":"BRL","description":"A2 real runtime","externalId":"order-a2-real-runtime-001","pixExpirationMinutes":30,"customerName":"A2 Runtime Customer","customerDocument":"12345678901","customerEmail":"a2-runtime@example.invalid","customerPhone":"+5500000000000"}'

stage='dual-process-idempotency-race'
pix_create_request "${API_ONE}" "${OWNER_TOKEN}" "${IDEMPOTENCY_KEY}" "${CREATE_PAYLOAD}" 'req-a2-race-one' /tmp/swiftpay-a2-race-one.json >/tmp/swiftpay-a2-race-one.status &
race_one_pid="$!"
pix_create_request "${API_TWO}" "${OWNER_TOKEN}" "${IDEMPOTENCY_KEY}" "${CREATE_PAYLOAD}" 'req-a2-race-two' /tmp/swiftpay-a2-race-two.json >/tmp/swiftpay-a2-race-two.status &
race_two_pid="$!"
wait "${race_one_pid}"
wait "${race_two_pid}"
race_one_status="$(cat /tmp/swiftpay-a2-race-one.status)"
race_two_status="$(cat /tmp/swiftpay-a2-race-two.status)"
echo "A2 create race statuses: ${race_one_status}/${race_two_status}"
assert_race_bodies /tmp/swiftpay-a2-race-one.json "${race_one_status}" /tmp/swiftpay-a2-race-two.json "${race_two_status}"

if [[ "${race_one_status}" == '201' ]]; then
  cp /tmp/swiftpay-a2-race-one.json /tmp/swiftpay-a2-final.json
elif [[ "${race_two_status}" == '201' ]]; then
  cp /tmp/swiftpay-a2-race-two.json /tmp/swiftpay-a2-final.json
else
  echo 'A2 race did not produce a completed 201 Payment' >&2
  exit 1
fi
assert_final_payment /tmp/swiftpay-a2-final.json
PAYMENT_ID="$(node --input-type=module -e "import {readFileSync} from 'node:fs'; process.stdout.write(JSON.parse(readFileSync('/tmp/swiftpay-a2-final.json','utf8')).id)")"

stage='atomic-state-contract'
read -r payment_count attempt_count idem_count < <(
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator=' ' --command \
    "select
       (select count(*) from app.payments where merchant_id = '${OWNER_MERCHANT_ID}'::uuid and environment = 'sandbox'),
       (select count(*) from app.provider_attempts pa join app.payments p on p.id = pa.payment_id where p.merchant_id = '${OWNER_MERCHANT_ID}'::uuid and p.environment = 'sandbox'),
       (select count(*) from app.request_idempotency where merchant_id = '${OWNER_MERCHANT_ID}'::uuid and environment = 'sandbox' and operation = 'create_payment' and idempotency_key = '${IDEMPOTENCY_KEY}');"
)
[[ "${payment_count}" == '1' ]]
[[ "${attempt_count}" == '1' ]]
[[ "${idem_count}" == '1' ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.provider_attempts where payment_id = '${PAYMENT_ID}'::uuid and provider_account_id = '${EMULATOR_ACCOUNT_ID}'::uuid and state = 'succeeded' and provider_payment_id like 'swiftpay-emulator-payment:%' and provider_txid like 'swiftpay-emulator-tx:%' and pix_copy_paste like 'SWIFTPAY_EMULATOR_COPY_%' and pix_qr_reference like 'SWIFTPAY_EMULATOR_QR_%';")" == '1' ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.payments where id = '${PAYMENT_ID}'::uuid and collection_status = 'pending' and pricing_version = 'sandbox-zero-fee-v0' and fee_mode = 'fixed' and fee_fixed_cents = 0 and fee_basis_points = 0 and fee_percentage_component_cents = 0 and merchant_fee_cents = 0 and merchant_net_cents = 12345 and routing_policy_version = 'sandbox-emulator-v0' and customer_snapshot = '{\"name\":\"A2 Runtime Customer\",\"document\":\"12345678901\",\"email\":\"a2-runtime@example.invalid\",\"phone\":\"+5500000000000\"}'::jsonb;")" == '1' ]]

stage='completed-replay'
replay_status="$(pix_create_request "${API_TWO}" "${OWNER_TOKEN}" "${IDEMPOTENCY_KEY}" "${CREATE_PAYLOAD}" 'req-a2-replay' /tmp/swiftpay-a2-replay.json)"
[[ "${replay_status}" == '201' ]]
cmp --silent /tmp/swiftpay-a2-final.json /tmp/swiftpay-a2-replay.json
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.provider_attempts where payment_id = '${PAYMENT_ID}'::uuid;")" == '1' ]]

stage='idempotency-conflict'
conflict_status="$(pix_create_request "${API_ONE}" "${OWNER_TOKEN}" "${IDEMPOTENCY_KEY}" "${CONFLICT_PAYLOAD}" 'req-a2-conflict' /tmp/swiftpay-a2-conflict.json)"
[[ "${conflict_status}" == '409' ]]
node --input-type=module - /tmp/swiftpay-a2-conflict.json <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const body = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(body.error?.code, 'idempotency_key_reused');
NODE
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.payments where merchant_id = '${OWNER_MERCHANT_ID}'::uuid and environment = 'sandbox';")" == '1' ]]

stage='owner-get'
owner_get_status="$(payment_get_request "${API_ONE}" "${OWNER_TOKEN}" "${PAYMENT_ID}" 'req-a2-owner-get' /tmp/swiftpay-a2-owner-get.json)"
[[ "${owner_get_status}" == '200' ]]
cmp --silent /tmp/swiftpay-a2-final.json /tmp/swiftpay-a2-owner-get.json

stage='foreign-get-isolation'
foreign_get_status="$(payment_get_request "${API_TWO}" "${FOREIGN_TOKEN}" "${PAYMENT_ID}" 'req-a2-foreign-get' /tmp/swiftpay-a2-foreign-get.json)"
[[ "${foreign_get_status}" == '404' ]]
node --input-type=module - /tmp/swiftpay-a2-foreign-get.json <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const body = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(body.error?.code, 'resource_not_found');
NODE
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.payments where merchant_id = '${FOREIGN_MERCHANT_ID}'::uuid;")" == '0' ]]

stage='production-create-fail-closed'
production_status="$(pix_create_request "${API_ONE}" "${PRODUCTION_TOKEN}" 'idem-a2-production-forbidden' "${CREATE_PAYLOAD}" 'req-a2-production' /tmp/swiftpay-a2-production.json)"
[[ "${production_status}" == '403' ]]
node --input-type=module - /tmp/swiftpay-a2-production.json <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const body = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(body.error?.code, 'operation_forbidden');
NODE
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.request_idempotency where merchant_id = '${OWNER_MERCHANT_ID}'::uuid and environment = 'production';")" == '0' ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.payments where merchant_id = '${OWNER_MERCHANT_ID}'::uuid and environment = 'production';")" == '0' ]]

stage='nonfinancial-invariance'
read -r ledger_transactions jobs webhook_events provider_events < <(
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator=' ' --command \
    "select
       (select count(*) from app.ledger_transactions),
       (select count(*) from app.jobs),
       (select count(*) from app.webhook_events),
       (select count(*) from app.provider_events);"
)
[[ "${ledger_transactions}" == '0' ]]
[[ "${jobs}" == '0' ]]
[[ "${webhook_events}" == '0' ]]
[[ "${provider_events}" == '0' ]]

stage='secret-log-redaction'
for log_file in /tmp/swiftpay-a2-api-one.log /tmp/swiftpay-a2-api-two.log; do
  ! grep -Fq "${A2_SECRET}" "${log_file}"
  ! grep -Fq "${A2_VERIFIER}" "${log_file}"
  ! grep -Fq "${OWNER_TOKEN}" "${log_file}"
  ! grep -Fq "${FOREIGN_TOKEN}" "${log_file}"
  ! grep -Fq "${PRODUCTION_TOKEN}" "${log_file}"
done

unset A2_SECRET A2_VERIFIER OWNER_TOKEN FOREIGN_TOKEN PRODUCTION_TOKEN
stage='complete'
echo 'SwiftPay A2 real runtime acceptance: OK'
