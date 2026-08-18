#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"
: "${SWIFTPAY_WORKER_DATABASE_URL:?SWIFTPAY_WORKER_DATABASE_URL is required}"
: "${SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY:?SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY is required}"

readonly ADMIN_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
readonly API_PORT_OK='32101'
readonly API_PORT_WRONG='32102'

api_pid=''
cleanup() {
  if [[ -n "${api_pid}" ]] && kill -0 "${api_pid}" >/dev/null 2>&1; then
    kill "${api_pid}" >/dev/null 2>&1 || true
    wait "${api_pid}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_live() {
  local port="$1"
  for _ in $(seq 1 50); do
    if curl --silent --fail "http://127.0.0.1:${port}/health/live" >/tmp/swiftpay-live.json; then
      return 0
    fi
    sleep 0.1
  done
  echo "API did not become live on port ${port}" >&2
  return 1
}

start_api() {
  local database_url="$1"
  local port="$2"
  local log_file="$3"

  SWIFTPAY_ENVIRONMENT=sandbox \
  SWIFTPAY_API_DATABASE_URL="${database_url}" \
  SWIFTPAY_API_HOST=127.0.0.1 \
  SWIFTPAY_API_PORT="${port}" \
    node apps/api/dist/index.js >"${log_file}" 2>&1 &
  api_pid="$!"
  wait_for_live "${port}"
}

stop_api() {
  cleanup
  api_pid=''
}

# Correct API identity: A14 admission and K7 readiness are both healthy.
start_api "${SWIFTPAY_API_DATABASE_URL}" "${API_PORT_OK}" /tmp/swiftpay-api-ok.log
[[ "$(curl --silent --output /tmp/swiftpay-ready-ok.json --write-out '%{http_code}' "http://127.0.0.1:${API_PORT_OK}/health/ready")" == '200' ]]
grep -q '"status":"ready"' /tmp/swiftpay-ready-ok.json
grep -q '"workload":"api"' /tmp/swiftpay-ready-ok.json
stop_api

# Wrong K6 identity: process remains live. A14 fails closed before the K7 DB probe because
# the worker identity has no EXECUTE authority over the API abuse-quota RPC.
start_api "${SWIFTPAY_WORKER_DATABASE_URL}" "${API_PORT_WRONG}" /tmp/swiftpay-api-wrong.log
[[ "$(curl --silent --output /tmp/swiftpay-ready-wrong.json --write-out '%{http_code}' "http://127.0.0.1:${API_PORT_WRONG}/health/ready")" == '503' ]]
grep -q '"code":"request_admission_unavailable"' /tmp/swiftpay-ready-wrong.json
! grep -Eq 'postgres(ql)?://|local_worker_runtime_only|local_api_runtime_only' /tmp/swiftpay-ready-wrong.json
! grep -Eq 'postgres(ql)?://|local_worker_runtime_only|local_api_runtime_only' /tmp/swiftpay-api-wrong.log
stop_api

# Correct worker identity succeeds exactly once in check mode.
SWIFTPAY_ENVIRONMENT=sandbox \
SWIFTPAY_WORKER_DATABASE_URL="${SWIFTPAY_WORKER_DATABASE_URL}" \
  node apps/worker/dist/index.js --check >/tmp/swiftpay-worker-ok.log 2>&1
grep -q 'worker_readiness_ok' /tmp/swiftpay-worker-ok.log

# API identity cannot masquerade as worker.
if SWIFTPAY_ENVIRONMENT=sandbox \
   SWIFTPAY_WORKER_DATABASE_URL="${SWIFTPAY_API_DATABASE_URL}" \
   node apps/worker/dist/index.js --check >/tmp/swiftpay-worker-wrong.log 2>&1; then
  echo 'worker check unexpectedly accepted API runtime identity' >&2
  exit 1
fi
grep -q 'worker_runtime_boundary_failed' /tmp/swiftpay-worker-wrong.log
! grep -Eq 'postgres(ql)?://|local_worker_runtime_only|local_api_runtime_only' /tmp/swiftpay-worker-wrong.log

# K7/A14 health checks create no financial/async state.
read -r payments jobs ledger_transactions webhook_events < <(
  psql "${ADMIN_DB_URL}" --tuples-only --no-align --field-separator=' ' --command \
    "select (select count(*) from app.payments),
            (select count(*) from app.jobs),
            (select count(*) from app.ledger_transactions),
            (select count(*) from app.webhook_events);"
)
[[ "${payments}" == '0' ]]
[[ "${jobs}" == '0' ]]
[[ "${ledger_transactions}" == '0' ]]
[[ "${webhook_events}" == '0' ]]

echo 'SwiftPay K7 real runtime database acceptance: OK'
