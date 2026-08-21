#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"
: "${SWIFTPAY_WORKER_DATABASE_URL:?SWIFTPAY_WORKER_DATABASE_URL is required}"
: "${SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID:?SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID is required}"
: "${SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY:?SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY is required}"
: "${SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS:?SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS is required}"

api_user="$(psql "${SWIFTPAY_API_DATABASE_URL}" --tuples-only --no-align --command 'select current_user')"
worker_user="$(psql "${SWIFTPAY_WORKER_DATABASE_URL}" --tuples-only --no-align --command 'select current_user')"
[[ "${api_user}" == 'swiftpay_api_runtime' ]]
[[ "${worker_user}" == 'swiftpay_worker_runtime' ]]

node tests/application/042_a7_webhook_endpoint_management_runtime_driver.mjs
