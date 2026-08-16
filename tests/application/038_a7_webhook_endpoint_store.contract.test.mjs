import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const db = await import('../../packages/db/dist/index.js');

const USER_ID = '10000000-0000-0000-0000-0000000000a7';
const MERCHANT_ID = '20000000-0000-0000-0000-0000000000a7';
const ENDPOINT_ID = '30000000-0000-0000-0000-0000000000a7';

function buildStore(pool) {
  if (typeof db.createDashboardWebhookEndpointStore !== 'function') {
    const missing = async () => ({ kind: 'not_implemented' });
    return { list: missing, get: missing, create: missing, update: missing, disable: missing, enable: missing, rotateSecret: missing };
  }
  return db.createDashboardWebhookEndpointStore(pool);
}

function recordingPool(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows };
    },
  };
}

test('A7 db package exports createDashboardWebhookEndpointStore', () => {
  assert.equal(typeof db.createDashboardWebhookEndpointStore, 'function');
});

test('A7 endpoint store read methods use only exact merchant-scoped trusted routines', async () => {
  const pool = recordingPool();
  const store = buildStore(pool);

  await store.list({ userId: USER_ID, merchantId: MERCHANT_ID, environment: 'sandbox' });
  await store.get({ userId: USER_ID, merchantId: MERCHANT_ID, environment: 'sandbox', endpointId: ENDPOINT_ID });

  assert.equal(pool.calls.length, 2);
  assert.match(pool.calls[0].sql, /app\.list_dashboard_webhook_endpoints/);
  assert.deepEqual(pool.calls[0].params, [USER_ID, MERCHANT_ID, 'sandbox']);
  assert.match(pool.calls[1].sql, /app\.get_dashboard_webhook_endpoint/);
  assert.deepEqual(pool.calls[1].params, [USER_ID, MERCHANT_ID, 'sandbox', ENDPOINT_ID]);
});

test('A7 endpoint store write methods call only the five frozen mutation routines', async () => {
  const pool = recordingPool([{ result: { kind: 'ok' } }]);
  const store = buildStore(pool);
  const common = {
    userId: USER_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    endpointId: ENDPOINT_ID,
    idempotencyKey: 'idem-a7-001',
    requestHash: 'a'.repeat(64),
    command: { expectedRevision: 1 },
  };

  await store.create({ ...common, endpointId: undefined });
  await store.update(common);
  await store.disable(common);
  await store.enable(common);
  await store.rotateSecret(common);

  const expected = [
    'create_dashboard_webhook_endpoint',
    'update_dashboard_webhook_endpoint',
    'disable_dashboard_webhook_endpoint',
    'enable_dashboard_webhook_endpoint',
    'rotate_dashboard_webhook_endpoint_secret',
  ];
  assert.equal(pool.calls.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.match(pool.calls[index].sql, new RegExp(`app\\.${expected[index]}`));
  }
});

test('A7 db implementation has no direct endpoint secret idempotency or audit table DML', async () => {
  const source = await readFile('packages/db/src/index.ts', 'utf8');
  const directDml = /\b(insert\s+into|update|delete\s+from)\s+app\.(webhook_endpoints|webhook_endpoint_secret_versions|request_idempotency|audit_events)\b/i;
  assert.equal(directDml.test(source), false);
});

test('A7 public store projection never exposes ciphertext or wrapping-key fields', async () => {
  const source = await readFile('packages/db/src/index.ts', 'utf8');
  if (typeof db.createDashboardWebhookEndpointStore !== 'function') {
    assert.fail('A7 behavior_not_implemented:createDashboardWebhookEndpointStore');
  }
  assert.doesNotMatch(source, /public.*(secret_ciphertext|wrapping_key_id)/i);
});
