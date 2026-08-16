#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"
: "${SWIFTPAY_WORKER_DATABASE_URL:?SWIFTPAY_WORKER_DATABASE_URL is required}"

api_user="$(psql "${SWIFTPAY_API_DATABASE_URL}" --tuples-only --no-align --command 'select current_user')"
worker_user="$(psql "${SWIFTPAY_WORKER_DATABASE_URL}" --tuples-only --no-align --command 'select current_user')"
[[ "${api_user}" == 'swiftpay_api_runtime' ]]
[[ "${worker_user}" == 'swiftpay_worker_runtime' ]]

node --input-type=module <<'NODE'
import assert from 'node:assert/strict';

const [db, webhooks] = await Promise.all([
  import('./packages/db/dist/index.js'),
  import('./packages/webhooks/dist/index.js'),
]);

assert.equal(
  typeof db.createDashboardWebhookEndpointStore,
  'function',
  'A7 behavior_not_implemented:createDashboardWebhookEndpointStore',
);
assert.equal(
  typeof webhooks.createDashboardWebhookEndpointManagementService,
  'function',
  'A7 behavior_not_implemented:createDashboardWebhookEndpointManagementService',
);
assert.equal(
  typeof webhooks.wrapWebhookSigningSecret,
  'function',
  'A7 behavior_not_implemented:wrapWebhookSigningSecret',
);
NODE
