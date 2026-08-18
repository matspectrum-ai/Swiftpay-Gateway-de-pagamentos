#!/usr/bin/env bash
set -Eeuo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"
: "${SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID:?SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID is required}"
: "${SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS:?SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS is required}"

readonly ADMIN_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
readonly API_ONE_PORT='32111'
readonly API_TWO_PORT='32112'
readonly FIXTURE_PATH='tests/application/fixtures/a1_token_exchange.sql'
readonly TOKEN_RESPONSE_PATH='/tmp/swiftpay-a1-token.json'

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
  echo "SwiftPay A1 acceptance failed at stage: ${stage}" >&2
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
  echo "A1 API did not become live on port ${port}" >&2
  return 1
}

start_api() {
  local port="$1"
  local log_file="$2"

  SWIFTPAY_ENVIRONMENT=sandbox \
  SWIFTPAY_API_DATABASE_URL="${SWIFTPAY_API_DATABASE_URL}" \
  SWIFTPAY_API_HOST=127.0.0.1 \
  SWIFTPAY_API_PORT="${port}" \
    node apps/api/dist/index.js >"${log_file}" 2>&1 &
  api_pids+=("$!")
  wait_for_live "${port}"
  [[ "$(curl --silent --output /tmp/swiftpay-a1-ready.json --write-out '%{http_code}' "http://127.0.0.1:${port}/health/ready")" == '200' ]]
}

token_request() {
  local base_url="$1"
  local public_key="$2"
  local secret_key="$3"
  local request_id="$4"
  local body_file="$5"
  local headers_file="$6"
  local payload

  payload="$(printf '{"grantType":"client_credentials","publicKey":"%s","secretKey":"%s"}' "${public_key}" "${secret_key}")"
  curl --silent --show-error \
    --dump-header "${headers_file}" \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    --header 'content-type: application/json' \
    --header "x-request-id: ${request_id}" \
    --data "${payload}" \
    "${base_url}/v1/auth/token"
}

assert_success_response() {
  local body_file="$1"
  node --input-type=module - "${body_file}" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const body = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(typeof body.accessToken, 'string');
assert.ok(body.accessToken.length > 20);
assert.equal(body.tokenType, 'Bearer');
assert.equal(body.expiresIn, 900);
assert.equal(body.environment, 'sandbox');
NODE
}

assert_error_response() {
  local body_file="$1"
  local headers_file="$2"
  local caller_request_id="$3"
  local expected_code="$4"
  local expected_message="$5"
  node --input-type=module - "${body_file}" "${headers_file}" "${caller_request_id}" "${expected_code}" "${expected_message}" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [bodyPath, headersPath, callerRequestId, expectedCode, expectedMessage] = process.argv.slice(2);
const body = JSON.parse(await readFile(bodyPath, 'utf8'));
const headers = await readFile(headersPath, 'utf8');
const requestId = headers
  .split(/\r?\n/)
  .map((line) => line.match(/^x-request-id:\s*(.+)$/i)?.[1]?.trim())
  .find(Boolean);
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
assert.equal(body.error?.code, expectedCode);
assert.equal(body.error?.message, expectedMessage);
assert.equal(typeof requestId, 'string');
assert.match(requestId, uuidV4);
assert.notEqual(requestId, callerRequestId);
assert.equal(body.error?.requestId, requestId);
NODE
}

assert_rate_limited_response() {
  local body_file="$1"
  local headers_file="$2"
  local retry_after
  node --input-type=module - "${body_file}" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const body = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(body.error?.code, 'auth_rate_limit_exceeded');
assert.equal(body.error?.message, 'Token issuance rate limit exceeded.');
NODE
  retry_after="$(
    tr -d '\r' < "${headers_file}" \
      | awk -F': *' 'tolower($1)=="retry-after" {print $2; exit}'
  )"
  [[ "${retry_after}" =~ ^[1-9][0-9]*$ ]]
}

stage='fixture-generation'
A1_SECRET="$(node --input-type=module -e "import { randomBytes } from 'node:crypto'; process.stdout.write(randomBytes(32).toString('base64url')); ")"
A1_VERIFIER="$(A1_SECRET="${A1_SECRET}" node --input-type=module <<'NODE'
import { scryptSync } from 'node:crypto';
const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const key = scryptSync(process.env.A1_SECRET, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
process.stdout.write(`scrypt-v1$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`);
NODE
)"

stage='fixture-load'
psql "${ADMIN_DB_URL}" \
  --set ON_ERROR_STOP=1 \
  --set "a1_secret_verifier=${A1_VERIFIER}" \
  --file "${FIXTURE_PATH}" >/tmp/swiftpay-a1-fixture.log

stage='fixture-contract'
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.api_credentials where id between '61000000-0000-0000-0000-000000000001'::uuid and '61000000-0000-0000-0000-000000000004'::uuid;")" == '4' ]]
! grep -Fq "${A1_SECRET}" "${FIXTURE_PATH}"
! grep -Fq "${A1_SECRET}" /tmp/swiftpay-a1-fixture.log

stage='dual-api-startup'
start_api "${API_ONE_PORT}" /tmp/swiftpay-a1-api-one.log
start_api "${API_TWO_PORT}" /tmp/swiftpay-a1-api-two.log
readonly API_ONE="http://127.0.0.1:${API_ONE_PORT}"
readonly API_TWO="http://127.0.0.1:${API_TWO_PORT}"

stage='indistinguishable-invalid-credentials'
wrong_status="$(token_request "${API_ONE}" 'pk_a1_runtime_active' "${A1_SECRET}x" 'req-a1-invalid-wrong' /tmp/swiftpay-a1-wrong.json /tmp/swiftpay-a1-wrong.headers)"
unknown_status="$(token_request "${API_ONE}" 'pk_a1_runtime_missing' "${A1_SECRET}" 'req-a1-invalid-unknown' /tmp/swiftpay-a1-unknown.json /tmp/swiftpay-a1-unknown.headers)"
echo "A1 invalid credential statuses: ${wrong_status}/${unknown_status}"
[[ "${wrong_status}" == '401' ]]
[[ "${unknown_status}" == '401' ]]
assert_error_response /tmp/swiftpay-a1-wrong.json /tmp/swiftpay-a1-wrong.headers 'req-a1-invalid-wrong' 'invalid_credentials' 'Invalid credentials.'
assert_error_response /tmp/swiftpay-a1-unknown.json /tmp/swiftpay-a1-unknown.headers 'req-a1-invalid-unknown' 'invalid_credentials' 'Invalid credentials.'
node --input-type=module - /tmp/swiftpay-a1-wrong.json /tmp/swiftpay-a1-unknown.json <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const left = JSON.parse(await readFile(process.argv[2], 'utf8'));
const right = JSON.parse(await readFile(process.argv[3], 'utf8'));
assert.deepEqual(
  { code: left.error?.code, message: left.error?.message },
  { code: right.error?.code, message: right.error?.message },
);
assert.notEqual(left.error?.requestId, right.error?.requestId);
NODE

stage='credential-ip-policy'
revoked_status="$(token_request "${API_ONE}" 'pk_a1_runtime_revoked' "${A1_SECRET}" 'req-a1-revoked' /tmp/swiftpay-a1-revoked.json /tmp/swiftpay-a1-revoked.headers)"
inactive_status="$(token_request "${API_ONE}" 'pk_a1_runtime_inactive_merchant' "${A1_SECRET}" 'req-a1-inactive' /tmp/swiftpay-a1-inactive.json /tmp/swiftpay-a1-inactive.headers)"
ip_status="$(token_request "${API_ONE}" 'pk_a1_runtime_ip_denied' "${A1_SECRET}" 'req-a1-ip-denied' /tmp/swiftpay-a1-ip.json /tmp/swiftpay-a1-ip.headers)"
echo "A1 policy statuses: revoked=${revoked_status} inactive=${inactive_status} ip=${ip_status}"
[[ "${revoked_status}" == '401' ]]
[[ "${inactive_status}" == '401' ]]
[[ "${ip_status}" == '403' ]]
assert_error_response /tmp/swiftpay-a1-ip.json /tmp/swiftpay-a1-ip.headers 'req-a1-ip-denied' 'ip_not_allowed' 'IP address is not allowed.'
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.api_credential_token_windows;")" == '0' ]]

stage='shared-quota-first-nine'
for i in $(seq 1 9); do
  if (( i % 2 == 1 )); then
    base_url="${API_ONE}"
  else
    base_url="${API_TWO}"
  fi
  body_file="/tmp/swiftpay-a1-success-${i}.json"
  headers_file="/tmp/swiftpay-a1-success-${i}.headers"
  status="$(token_request "${base_url}" 'pk_a1_runtime_active' "${A1_SECRET}" "req-a1-success-${i}" "${body_file}" "${headers_file}")"
  echo "A1 issuance ${i} status: ${status}"
  [[ "${status}" == '200' ]]
  assert_success_response "${body_file}"
  if [[ "${i}" == '1' ]]; then
    cp "${body_file}" "${TOKEN_RESPONSE_PATH}"
  fi
done
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select issued_count from app.api_credential_token_windows where credential_id = '61000000-0000-0000-0000-000000000001'::uuid;")" == '9' ]]

stage='shared-quota-race-ten-eleven'
token_request "${API_ONE}" 'pk_a1_runtime_active' "${A1_SECRET}" 'req-a1-race-one' /tmp/swiftpay-a1-race-one.json /tmp/swiftpay-a1-race-one.headers >/tmp/swiftpay-a1-race-one.status &
race_one_pid="$!"
token_request "${API_TWO}" 'pk_a1_runtime_active' "${A1_SECRET}" 'req-a1-race-two' /tmp/swiftpay-a1-race-two.json /tmp/swiftpay-a1-race-two.headers >/tmp/swiftpay-a1-race-two.status &
race_two_pid="$!"
wait "${race_one_pid}"
wait "${race_two_pid}"
race_one_status="$(cat /tmp/swiftpay-a1-race-one.status)"
race_two_status="$(cat /tmp/swiftpay-a1-race-two.status)"
echo "A1 quota race statuses: ${race_one_status}/${race_two_status}"

if [[ "${race_one_status}" == '200' && "${race_two_status}" == '429' ]]; then
  assert_success_response /tmp/swiftpay-a1-race-one.json
  assert_rate_limited_response /tmp/swiftpay-a1-race-two.json /tmp/swiftpay-a1-race-two.headers
elif [[ "${race_one_status}" == '429' && "${race_two_status}" == '200' ]]; then
  assert_rate_limited_response /tmp/swiftpay-a1-race-one.json /tmp/swiftpay-a1-race-one.headers
  assert_success_response /tmp/swiftpay-a1-race-two.json
else
  echo "Expected A1 race statuses 200/429, got ${race_one_status}/${race_two_status}" >&2
  exit 1
fi
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select issued_count from app.api_credential_token_windows where credential_id = '61000000-0000-0000-0000-000000000001'::uuid;")" == '10' ]]

stage='bearer-revalidation-live'
node tests/application/a1_bearer_runtime_check.mjs valid "${TOKEN_RESPONSE_PATH}"

stage='bearer-revalidation-revoked'
psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 --command \
  "update app.api_credentials set status = 'revoked', revoked_at = clock_timestamp() where id = '61000000-0000-0000-0000-000000000001'::uuid;" >/dev/null
node tests/application/a1_bearer_runtime_check.mjs invalid "${TOKEN_RESPONSE_PATH}"

stage='bearer-revalidation-version-rotation'
psql "${ADMIN_DB_URL}" --set ON_ERROR_STOP=1 --command \
  "update app.api_credentials set status = 'active', revoked_at = null, secret_version = 4, rotated_at = clock_timestamp() where id = '61000000-0000-0000-0000-000000000001'::uuid;" >/dev/null
node tests/application/a1_bearer_runtime_check.mjs invalid "${TOKEN_RESPONSE_PATH}"

stage='secret-log-redaction'
! grep -Fq "${A1_SECRET}" /tmp/swiftpay-a1-api-one.log
! grep -Fq "${A1_SECRET}" /tmp/swiftpay-a1-api-two.log
! grep -Fq "${A1_VERIFIER}" /tmp/swiftpay-a1-api-one.log
! grep -Fq "${A1_VERIFIER}" /tmp/swiftpay-a1-api-two.log

stage='financial-invariance'
read -r payments ledger_transactions jobs webhook_events < <(
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator=' ' --command \
    "select (select count(*) from app.payments),
            (select count(*) from app.ledger_transactions),
            (select count(*) from app.jobs),
            (select count(*) from app.webhook_events);"
)
[[ "${payments}" == '0' ]]
[[ "${ledger_transactions}" == '0' ]]
[[ "${jobs}" == '0' ]]
[[ "${webhook_events}" == '0' ]]

unset A1_SECRET A1_VERIFIER
stage='complete'
echo 'SwiftPay A1 real runtime acceptance: OK'
