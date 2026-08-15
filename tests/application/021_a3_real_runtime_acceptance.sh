#!/usr/bin/env bash
set -Eeuo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"
: "${SWIFTPAY_WORKER_DATABASE_URL:?SWIFTPAY_WORKER_DATABASE_URL is required}"
: "${SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY:?SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY is required}"

readonly ADMIN_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
readonly API_PORT='32311'
readonly FIXTURE_PATH='tests/application/fixtures/a3_paid_runtime.sql'
readonly WORKER_HELPER='tests/application/helpers/a3_apply_paid_evidence.mjs'
readonly OWNER_PUBLIC_KEY='pk_a3_runtime_owner'
readonly FOREIGN_PUBLIC_KEY='pk_a3_runtime_foreign'
readonly PRODUCTION_PUBLIC_KEY='pk_a3_runtime_production'
readonly OWNER_MERCHANT_ID='73000000-0000-0000-0000-000000000001'
readonly FOREIGN_MERCHANT_ID='73000000-0000-0000-0000-000000000002'
readonly WEBHOOK_ENDPOINT_ID='77000000-0000-0000-0000-000000000001'
readonly SOURCE_ONE='78000000-0000-0000-0000-000000000001'
readonly SOURCE_TWO='78000000-0000-0000-0000-000000000002'
readonly AMOUNT='15432'
readonly OCCURRED_AT='2030-03-17T18:00:00.000Z'
readonly IDEMPOTENCY_KEY='idem-a3-real-runtime-001'

stage='bootstrap'
api_pid=''
cleanup() {
  if [[ -n "${api_pid}" ]] && kill -0 "${api_pid}" >/dev/null 2>&1; then
    kill "${api_pid}" >/dev/null 2>&1 || true
    wait "${api_pid}" >/dev/null 2>&1 || true
  fi
}
on_error() {
  local rc="$?"
  trap - ERR
  echo "SwiftPay A3 acceptance failed at stage: ${stage}" >&2
  exit "${rc}"
}
trap cleanup EXIT
trap on_error ERR

wait_for_live() {
  for _ in $(seq 1 80); do
    if curl --silent --fail "http://127.0.0.1:${API_PORT}/health/live" >/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  echo 'A3 API did not become live' >&2
  return 1
}

start_api() {
  SWIFTPAY_ENVIRONMENT=sandbox \
  SWIFTPAY_API_DATABASE_URL="${SWIFTPAY_API_DATABASE_URL}" \
  SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY="${SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY}" \
  SWIFTPAY_API_HOST=127.0.0.1 \
  SWIFTPAY_API_PORT="${API_PORT}" \
    node apps/api/dist/index.js >/tmp/swiftpay-a3-api.log 2>&1 &
  api_pid="$!"
  wait_for_live
  [[ "$(curl --silent --output /tmp/swiftpay-a3-ready.json --write-out '%{http_code}' "http://127.0.0.1:${API_PORT}/health/ready")" == '200' ]]
}

token_request() {
  local public_key="$1"
  local secret_key="$2"
  local request_id="$3"
  local body_file="$4"
  local payload
  payload="$(printf '{"grantType":"client_credentials","publicKey":"%s","secretKey":"%s"}' "${public_key}" "${secret_key}")"
  curl --silent --show-error \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    --header 'content-type: application/json' \
    --header "x-request-id: ${request_id}" \
    --data "${payload}" \
    "http://127.0.0.1:${API_PORT}/v1/auth/token"
}

extract_access_token() {
  node --input-type=module - "$1" <<'NODE'
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

api_get() {
  local path="$1"
  local token="$2"
  local request_id="$3"
  local body_file="$4"
  curl --silent --show-error \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    --header "authorization: Bearer ${token}" \
    --header "x-request-id: ${request_id}" \
    "http://127.0.0.1:${API_PORT}${path}"
}

stage='fixture-generation'
A3_SECRET="$(node --input-type=module -e "import { randomBytes } from 'node:crypto'; process.stdout.write(randomBytes(32).toString('base64url')); ")"
A3_VERIFIER="$(A3_SECRET="${A3_SECRET}" node --input-type=module <<'NODE'
import { scryptSync } from 'node:crypto';
const salt = Buffer.from('2031425364758697a8b9cadbecfd0e1f', 'hex');
const key = scryptSync(process.env.A3_SECRET, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
process.stdout.write(`scrypt-v1$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`);
NODE
)"

stage='fixture-load'
psql "${ADMIN_DB_URL}" \
  --set ON_ERROR_STOP=1 \
  --set "a3_secret_verifier=${A3_VERIFIER}" \
  --file "${FIXTURE_PATH}" >/tmp/swiftpay-a3-fixture.log

stage='fixture-contract'
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.api_credentials where id between '74000000-0000-0000-0000-000000000001'::uuid and '74000000-0000-0000-0000-000000000003'::uuid;")" == '3' ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.webhook_endpoints where id='${WEBHOOK_ENDPOINT_ID}'::uuid and status='active' and subscribed_events ? 'payment.paid';")" == '1' ]]
! grep -Fq "${A3_SECRET}" "${FIXTURE_PATH}"
! grep -Fq "${A3_SECRET}" /tmp/swiftpay-a3-fixture.log

stage='api-startup'
start_api

stage='token-exchange'
[[ "$(token_request "${OWNER_PUBLIC_KEY}" "${A3_SECRET}" 'req-a3-owner-token' /tmp/swiftpay-a3-owner-token.json)" == '200' ]]
[[ "$(token_request "${FOREIGN_PUBLIC_KEY}" "${A3_SECRET}" 'req-a3-foreign-token' /tmp/swiftpay-a3-foreign-token.json)" == '200' ]]
[[ "$(token_request "${PRODUCTION_PUBLIC_KEY}" "${A3_SECRET}" 'req-a3-production-token' /tmp/swiftpay-a3-production-token.json)" == '200' ]]
OWNER_TOKEN="$(extract_access_token /tmp/swiftpay-a3-owner-token.json)"
FOREIGN_TOKEN="$(extract_access_token /tmp/swiftpay-a3-foreign-token.json)"
PRODUCTION_TOKEN="$(extract_access_token /tmp/swiftpay-a3-production-token.json)"

stage='pix-create'
CREATE_PAYLOAD="$(printf '{"method":"pix","amount":%s,"currency":"BRL","description":"A3 real runtime","externalId":"order-a3-real-runtime-001","pixExpirationMinutes":30}' "${AMOUNT}")"
create_status="$(curl --silent --show-error \
  --output /tmp/swiftpay-a3-created.json \
  --write-out '%{http_code}' \
  --header "authorization: Bearer ${OWNER_TOKEN}" \
  --header 'content-type: application/json' \
  --header "idempotency-key: ${IDEMPOTENCY_KEY}" \
  --header 'x-request-id: req-a3-create' \
  --data "${CREATE_PAYLOAD}" \
  "http://127.0.0.1:${API_PORT}/v1/transactions")"
[[ "${create_status}" == '201' ]]
PAYMENT_ID="$(node --input-type=module - /tmp/swiftpay-a3-created.json <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const p = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(p.status, 'pending');
assert.equal(p.amount, 15432);
assert.equal(p.fee, 0);
assert.equal(p.netAmount, 15432);
assert.match(p.pix?.copyAndPaste ?? '', /^SWIFTPAY_EMULATOR_COPY_/);
assert.match(p.pix?.qrCode ?? '', /^SWIFTPAY_EMULATOR_QR_/);
assert.match(p.pix?.txId ?? '', /^swiftpay-emulator-tx:/);
process.stdout.write(p.id);
NODE
)"

stage='prepaid-balance'
[[ "$(api_get '/v1/balance' "${OWNER_TOKEN}" 'req-a3-balance-before' /tmp/swiftpay-a3-balance-before.json)" == '200' ]]
node --input-type=module - /tmp/swiftpay-a3-balance-before.json <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const b = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.deepEqual(b, {
  currency: 'BRL', environment: 'sandbox', pendingSettlement: 0, available: 0,
  reserved: 0, blockedPayouts: 0, blockedRefunds: 0, blocked: 0,
  withdrawable: 0, totalMerchantFunds: 0,
});
NODE

stage='worker-paid-race'
PAID_ONE="$(printf '{"paymentId":"%s","simulationSourceId":"%s","amountCents":%s,"providerCostCents":0,"payloadHash":"%s","occurredAt":"%s"}' "${PAYMENT_ID}" "${SOURCE_ONE}" "${AMOUNT}" "$(printf 'a%.0s' {1..64})" "${OCCURRED_AT}")"
PAID_TWO="$(printf '{"paymentId":"%s","simulationSourceId":"%s","amountCents":%s,"providerCostCents":0,"payloadHash":"%s","occurredAt":"%s"}' "${PAYMENT_ID}" "${SOURCE_TWO}" "${AMOUNT}" "$(printf 'b%.0s' {1..64})" "${OCCURRED_AT}")"
SWIFTPAY_WORKER_DATABASE_URL="${SWIFTPAY_WORKER_DATABASE_URL}" node "${WORKER_HELPER}" "${PAID_ONE}" >/tmp/swiftpay-a3-paid-one.json &
paid_one_pid="$!"
SWIFTPAY_WORKER_DATABASE_URL="${SWIFTPAY_WORKER_DATABASE_URL}" node "${WORKER_HELPER}" "${PAID_TWO}" >/tmp/swiftpay-a3-paid-two.json &
paid_two_pid="$!"
wait "${paid_one_pid}"
wait "${paid_two_pid}"
node --input-type=module - /tmp/swiftpay-a3-paid-one.json /tmp/swiftpay-a3-paid-two.json "${PAYMENT_ID}" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [one, two] = await Promise.all([
  readFile(process.argv[2], 'utf8').then(JSON.parse),
  readFile(process.argv[3], 'utf8').then(JSON.parse),
]);
const paymentId = process.argv[4];
assert.deepEqual([one.kind, two.kind].sort(), ['absorbed', 'applied']);
for (const result of [one, two]) {
  assert.equal(result.payment?.id, paymentId);
  assert.equal(result.payment?.status, 'paid');
  assert.equal(result.payment?.amount, 15432);
  assert.match(result.payment?.pix?.copyAndPaste ?? '', /^SWIFTPAY_EMULATOR_COPY_/);
}
const applied = one.kind === 'applied' ? one : two;
assert.match(applied.providerEventId, /^[0-9a-f-]{36}$/i);
assert.match(applied.ledgerTransactionId, /^[0-9a-f-]{36}$/i);
assert.match(applied.webhookEventId, /^[0-9a-f-]{36}$/i);
NODE

echo 'A3 paid evidence race: applied/absorbed'

stage='same-source-replay'
SWIFTPAY_WORKER_DATABASE_URL="${SWIFTPAY_WORKER_DATABASE_URL}" node "${WORKER_HELPER}" "${PAID_ONE}" >/tmp/swiftpay-a3-paid-replay.json
node --input-type=module - /tmp/swiftpay-a3-paid-replay.json "${PAYMENT_ID}" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const result = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(result.kind, 'absorbed');
assert.equal(result.payment?.id, process.argv[3]);
assert.equal(result.payment?.status, 'paid');
NODE

stage='owner-payment-get'
[[ "$(api_get "/v1/transactions/${PAYMENT_ID}" "${OWNER_TOKEN}" 'req-a3-owner-get' /tmp/swiftpay-a3-owner-get.json)" == '200' ]]
node --input-type=module - /tmp/swiftpay-a3-owner-get.json <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const p = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(p.status, 'paid');
assert.equal(p.amount, 15432);
assert.equal(p.fee, 0);
assert.equal(p.netAmount, 15432);
assert.match(p.pix?.copyAndPaste ?? '', /^SWIFTPAY_EMULATOR_COPY_/);
assert.ok(!Object.hasOwn(p, 'providerCostCents'));
assert.ok(!Object.hasOwn(p, 'providerAccountId'));
assert.ok(!Object.hasOwn(p, 'settlementPolicyVersion'));
NODE

stage='foreign-payment-isolation'
[[ "$(api_get "/v1/transactions/${PAYMENT_ID}" "${FOREIGN_TOKEN}" 'req-a3-foreign-get' /tmp/swiftpay-a3-foreign-get.json)" == '404' ]]

stage='balance-observation'
[[ "$(api_get '/v1/balance' "${OWNER_TOKEN}" 'req-a3-owner-balance' /tmp/swiftpay-a3-owner-balance.json)" == '200' ]]
[[ "$(api_get '/v1/balance' "${FOREIGN_TOKEN}" 'req-a3-foreign-balance' /tmp/swiftpay-a3-foreign-balance.json)" == '200' ]]
[[ "$(api_get '/v1/balance' "${PRODUCTION_TOKEN}" 'req-a3-production-balance' /tmp/swiftpay-a3-production-balance.json)" == '200' ]]
node --input-type=module - /tmp/swiftpay-a3-owner-balance.json /tmp/swiftpay-a3-foreign-balance.json /tmp/swiftpay-a3-production-balance.json <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [owner, foreign, production] = await Promise.all(process.argv.slice(2).map((p) => readFile(p, 'utf8').then(JSON.parse)));
assert.deepEqual(owner, {
  currency: 'BRL', environment: 'sandbox', pendingSettlement: 15432, available: 0,
  reserved: 0, blockedPayouts: 0, blockedRefunds: 0, blocked: 0,
  withdrawable: 0, totalMerchantFunds: 15432,
});
assert.deepEqual(foreign, {
  currency: 'BRL', environment: 'sandbox', pendingSettlement: 0, available: 0,
  reserved: 0, blockedPayouts: 0, blockedRefunds: 0, blocked: 0,
  withdrawable: 0, totalMerchantFunds: 0,
});
assert.deepEqual(production, {
  currency: 'BRL', environment: 'production', pendingSettlement: 0, available: 0,
  reserved: 0, blockedPayouts: 0, blockedRefunds: 0, blocked: 0,
  withdrawable: 0, totalMerchantFunds: 0,
});
NODE

stage='database-financial-contract'
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.payments where id='${PAYMENT_ID}'::uuid and merchant_id='${OWNER_MERCHANT_ID}'::uuid and environment='sandbox' and collection_status='paid' and amount_cents=${AMOUNT} and merchant_fee_cents=0 and merchant_net_cents=${AMOUNT} and provider_cost_cents=0 and settlement_policy_version='sandbox-pending-settlement-v0' and paid_at='${OCCURRED_AT}'::timestamptz;")" == '1' ]]
read -r provider_event_count provider_applied_count provider_absorbed_count < <(
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator=' ' --command \
    "select count(*), count(*) filter (where state='applied'), count(*) filter (where state='absorbed') from app.provider_events where provider_event_id in ('swiftpay-sandbox-sim:${SOURCE_ONE}','swiftpay-sandbox-sim:${SOURCE_TWO}');"
)
[[ "${provider_event_count}" == '2' ]]
[[ "${provider_applied_count}" == '1' ]]
[[ "${provider_absorbed_count}" == '1' ]]
LEDGER_ID="$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select id from app.ledger_transactions where environment='sandbox' and source_type='payment' and source_id='${PAYMENT_ID}'::uuid and posting_type='settlement_paid';")"
[[ -n "${LEDGER_ID}" ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.ledger_transactions where environment='sandbox' and source_type='payment' and source_id='${PAYMENT_ID}'::uuid and posting_type='settlement_paid';")" == '1' ]]
read -r entry_count debit_sum credit_sum < <(
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator=' ' --command \
    "select count(*), coalesce(sum(amount_cents) filter (where direction='debit'),0), coalesce(sum(amount_cents) filter (where direction='credit'),0) from app.ledger_entries where ledger_transaction_id='${LEDGER_ID}'::uuid;"
)
[[ "${entry_count}" == '2' ]]
[[ "${debit_sum}" == "${AMOUNT}" ]]
[[ "${credit_sum}" == "${AMOUNT}" ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select coalesce(sum(balance_cents),0) from app.accounts where merchant_id='${OWNER_MERCHANT_ID}'::uuid and environment='sandbox' and currency='BRL' and account_type='merchant_pending_liability';")" == "${AMOUNT}" ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select coalesce(sum(balance_cents),0) from app.accounts where merchant_id='${OWNER_MERCHANT_ID}'::uuid and environment='sandbox' and currency='BRL' and account_type='merchant_available_liability';")" == '0' ]]

stage='database-outbox-contract'
WEBHOOK_EVENT_ID="$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select id from app.webhook_events where merchant_id='${OWNER_MERCHANT_ID}'::uuid and environment='sandbox' and type='payment.paid' and source_type='payment' and source_id='${PAYMENT_ID}'::uuid;")"
[[ -n "${WEBHOOK_EVENT_ID}" ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.webhook_events where merchant_id='${OWNER_MERCHANT_ID}'::uuid and environment='sandbox' and type='payment.paid' and source_type='payment' and source_id='${PAYMENT_ID}'::uuid and payload_snapshot->>'status'='paid' and payload_snapshot ? 'pix' and not (payload_snapshot ? 'providerCostCents') and not (payload_snapshot ? 'providerAccountId');")" == '1' ]]
DELIVERY_ID="$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select id from app.webhook_deliveries where webhook_event_id='${WEBHOOK_EVENT_ID}'::uuid and webhook_endpoint_id='${WEBHOOK_ENDPOINT_ID}'::uuid;")"
[[ -n "${DELIVERY_ID}" ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.webhook_deliveries where id='${DELIVERY_ID}'::uuid and state='pending' and attempt_count=0;")" == '1' ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.jobs where kind='merchant_webhook_delivery' and resource_type='webhook_delivery' and resource_id='${DELIVERY_ID}'::uuid and state='pending' and attempt_count=0;")" == '1' ]]

stage='no-duplicate-side-effects'
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.ledger_transactions where source_type='payment' and source_id='${PAYMENT_ID}'::uuid and posting_type='settlement_paid';")" == '1' ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.webhook_events where source_type='payment' and source_id='${PAYMENT_ID}'::uuid and type='payment.paid';")" == '1' ]]
[[ "$(psql "${ADMIN_DB_URL}" --tuples-only --no-align --command "select count(*) from app.webhook_deliveries where webhook_event_id='${WEBHOOK_EVENT_ID}'::uuid;")" == '1' ]]

stage='secret-log-contract'
! grep -Fq "${A3_SECRET}" /tmp/swiftpay-a3-api.log
! grep -Fq "${A3_SECRET}" /tmp/swiftpay-a3-fixture.log
! grep -Fq "${A3_SECRET}" /tmp/swiftpay-a3-paid-one.json
! grep -Fq "${A3_SECRET}" /tmp/swiftpay-a3-paid-two.json
! grep -Fq "${OWNER_TOKEN}" /tmp/swiftpay-a3-api.log
! grep -Fq "${FOREIGN_TOKEN}" /tmp/swiftpay-a3-api.log
! grep -Fq "${PRODUCTION_TOKEN}" /tmp/swiftpay-a3-api.log

echo 'SwiftPay A3 real runtime acceptance: OK'
