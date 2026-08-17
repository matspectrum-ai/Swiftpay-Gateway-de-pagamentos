import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { buildApp } from '../../apps/api/dist/app.js';
import * as db from '../../packages/db/dist/index.js';
import * as payments from '../../packages/payments/dist/index.js';

const DATABASE_URL = process.env.SWIFTPAY_API_DATABASE_URL;
const CURSOR_KEY = process.env.SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY;
const ADMIN_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const MERCHANT_A = '29000000-0000-0000-0000-000000000901';
const MERCHANT_B = '29000000-0000-0000-0000-000000000902';
const USERS = {
  member: '19000000-0000-0000-0000-000000000901',
  disabled: '19000000-0000-0000-0000-000000000902',
  deleted: '19000000-0000-0000-0000-000000000903',
  outsider: '19000000-0000-0000-0000-000000000904',
};
const PAYMENT = {
  paid: '39000000-0000-0000-0000-000000000901',
  pending: '39000000-0000-0000-0000-000000000902',
  creating: '39000000-0000-0000-0000-000000000903',
  failed: '39000000-0000-0000-0000-000000000904',
  cancelled: '39000000-0000-0000-0000-000000000905',
  hugeExternal: '39000000-0000-0000-0000-000000000906',
  pendingOlder: '39000000-0000-0000-0000-000000000907',
  production: '39000000-0000-0000-0000-000000000908',
  foreign: '39000000-0000-0000-0000-000000000909',
  newerDuringPagination: '39000000-0000-0000-0000-000000000910',
};

function fail(message) {
  process.stderr.write(`A9_ACCEPTANCE_FAIL ${message}\n`);
  process.exit(1);
}
function check(condition, message) {
  if (!condition) fail(message);
}
if (!DATABASE_URL) fail('SWIFTPAY_API_DATABASE_URL is required');
if (!CURSOR_KEY) fail('SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY is required');

const pool = db.createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'api' });
const contextStore = db.createDashboardMerchantContextStore(pool);
const store = db.createDashboardTransactionStore(pool);
const cursorCodec = payments.createDashboardTransactionCursorCodec({ key: CURSOR_KEY });

const sessionVerifier = async (authorization) => {
  const token = typeof authorization === 'string' ? authorization.replace(/^Bearer /, '') : '';
  const userId = USERS[token];
  return userId
    ? { kind: 'authenticated', principal: { userId } }
    : { kind: 'invalid_session' };
};

const service = payments.createDashboardTransactionReadService({
  sessionVerifier,
  contextStore,
  store,
  cursorCodec,
});

const dashboardTransactions = {
  list: async (input) => ({ ...(await service.list(input)) }),
  get: async (input) => ({ ...(await service.get(input)) }),
};
const app = buildApp({
  readinessProbe: async () => undefined,
  dashboardTransactions,
});

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length === 0 ? '' : `?${encoded}`;
}

async function list({
  authorization = 'Bearer member', merchantId = MERCHANT_A, environment = 'sandbox', query = {},
} = {}) {
  return app.inject({
    method: 'GET',
    url: `/dashboard/v1/merchants/${merchantId}/environments/${environment}/transactions${queryString(query)}`,
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  });
}

async function get(transactionId, {
  authorization = 'Bearer member', merchantId = MERCHANT_A, environment = 'sandbox',
} = {}) {
  return app.inject({
    method: 'GET',
    url: `/dashboard/v1/merchants/${merchantId}/environments/${environment}/transactions/${transactionId}`,
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  });
}

function adminSql(sql) {
  execFileSync('psql', [ADMIN_DB_URL, '--set', 'ON_ERROR_STOP=1', '--command', sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertSafeProjection(value, context) {
  const text = JSON.stringify(value);
  for (const forbidden of [
    'customerSnapshot', 'customer_snapshot', 'metadata', 'providerId', 'provider_id',
    'providerAccountId', 'provider_account_id', 'providerPaymentId', 'provider_payment_id',
    'providerStatusRaw', 'provider_status_raw', 'providerCost', 'provider_cost',
    'executionToken', 'execution_token', 'lastErrorClass', 'last_error_class',
    'lastErrorCode', 'last_error_code', 'SENSITIVE_CUSTOMER_A9', 'SENSITIVE_METADATA_A9',
    'provider-sensitive-status-a9',
  ]) {
    assert.equal(text.includes(forbidden), false, `${context}:${forbidden}`);
  }
}

let insertedNewer = false;
try {
  const initial = await list();
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.headers['cache-control'], 'private, no-store');
  const initialBody = initial.json();
  assert.deepEqual(initialBody.items.map((item) => item.id), [
    PAYMENT.paid,
    PAYMENT.pending,
    PAYMENT.creating,
    PAYMENT.failed,
    PAYMENT.cancelled,
    PAYMENT.hugeExternal,
    PAYMENT.pendingOlder,
  ]);
  assert.equal(initialBody.nextCursor, null);
  assert.equal('total' in initialBody, false);
  assert.equal('page' in initialBody, false);
  assert.equal(initialBody.items.every((item) => !('pix' in item)), true);
  assertSafeProjection(initialBody, 'initial-list');

  const production = await list({ environment: 'production' });
  assert.equal(production.statusCode, 200);
  assert.deepEqual(production.json().items.map((item) => item.id), [PAYMENT.production]);
  const productionDetail = await get(PAYMENT.production, { environment: 'production' });
  assert.equal(productionDetail.statusCode, 200);
  assert.equal(productionDetail.json().environment, 'production');

  for (const authorization of ['Bearer disabled', 'Bearer deleted', 'Bearer outsider']) {
    const response = await list({ authorization });
    assert.equal(response.statusCode, 403, authorization);
    assert.equal(response.json().error.code, 'operation_forbidden', authorization);
  }
  for (const authorization of [undefined, 'Bearer machine']) {
    const response = await list({ authorization });
    assert.equal(response.statusCode, 401, String(authorization));
    assert.equal(response.json().error.code, 'invalid_dashboard_session', String(authorization));
  }

  const page1 = await list({ query: { limit: 2 } });
  assert.equal(page1.statusCode, 200);
  const page1Body = page1.json();
  assert.deepEqual(page1Body.items.map((item) => item.id), [PAYMENT.paid, PAYMENT.pending]);
  assert.equal(typeof page1Body.nextCursor, 'string');

  adminSql(`
    insert into app.payments (
      id, merchant_id, environment, external_id, source, collection_status,
      amount_cents, currency, description, pricing_version, rounding_policy_version,
      merchant_fee_cents, merchant_net_cents, refunded_amount_cents, created_at, updated_at
    ) values (
      '${PAYMENT.newerDuringPagination}'::uuid, '${MERCHANT_A}'::uuid, 'sandbox',
      'inserted-after-cursor', 'api', 'pending', 1000, 'BRL', 'A9 concurrent insertion',
      'a9-pricing-v0', 'ceil-bp-v1', 0, 1000, 0,
      '2026-08-17T07:00:00Z'::timestamptz, '2026-08-17T07:00:00Z'::timestamptz
    );
  `);
  insertedNewer = true;

  const page2 = await list({ query: { limit: 2, cursor: page1Body.nextCursor } });
  assert.equal(page2.statusCode, 200);
  assert.deepEqual(page2.json().items.map((item) => item.id), [PAYMENT.creating, PAYMENT.failed]);
  assert.equal(page2.json().items.some((item) => item.id === PAYMENT.newerDuringPagination), false);

  adminSql(`delete from app.payments where id = '${PAYMENT.newerDuringPagination}'::uuid;`);
  insertedNewer = false;

  const seen = new Set();
  let cursor = null;
  do {
    const response = await list({ query: { limit: 2, ...(cursor === null ? {} : { cursor }) } });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    for (const item of body.items) {
      assert.equal(seen.has(item.id), false, `duplicate-page-id:${item.id}`);
      seen.add(item.id);
    }
    cursor = body.nextCursor;
  } while (cursor !== null);
  assert.deepEqual([...seen], [
    PAYMENT.paid, PAYMENT.pending, PAYMENT.creating, PAYMENT.failed,
    PAYMENT.cancelled, PAYMENT.hugeExternal, PAYMENT.pendingOlder,
  ]);

  const statusPaid = await list({ query: { status: 'paid' } });
  assert.equal(statusPaid.statusCode, 200);
  assert.deepEqual(statusPaid.json().items.map((item) => item.id), [PAYMENT.paid]);

  const exactWhitespace = await list({ query: { externalId: ' Exact Ref ' } });
  assert.deepEqual(exactWhitespace.json().items.map((item) => item.id), [PAYMENT.pending]);
  const trimmedWhitespace = await list({ query: { externalId: 'Exact Ref' } });
  assert.deepEqual(trimmedWhitespace.json().items, []);
  const exactCase = await list({ query: { externalId: 'CaseSensitive' } });
  assert.deepEqual(exactCase.json().items.map((item) => item.id), [PAYMENT.creating]);
  const lowerCase = await list({ query: { externalId: 'casesensitive' } });
  assert.deepEqual(lowerCase.json().items.map((item) => item.id), [PAYMENT.failed]);

  const hugeExternal = 'X'.repeat(5000);
  const huge = await list({ query: { externalId: hugeExternal } });
  assert.equal(huge.statusCode, 200);
  assert.deepEqual(huge.json().items.map((item) => item.id), [PAYMENT.hugeExternal]);

  const bounded = await list({
    query: { createdFrom: '2026-08-17T05:00:00Z', createdTo: '2026-08-17T06:00:00Z' },
  });
  assert.equal(bounded.statusCode, 200);
  assert.deepEqual(bounded.json().items.map((item) => item.id), [PAYMENT.creating]);

  const tamperedParts = page1Body.nextCursor.split('.');
  const signature = tamperedParts[2];
  tamperedParts[2] = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
  const tampered = await list({ query: { limit: 2, cursor: tamperedParts.join('.') } });
  assert.equal(tampered.statusCode, 400);
  assert.equal(tampered.json().error.code, 'validation_error');
  const filterMismatch = await list({ query: { limit: 2, status: 'paid', cursor: page1Body.nextCursor } });
  assert.equal(filterMismatch.statusCode, 400);
  const scopeMismatch = await list({ environment: 'production', query: { limit: 2, cursor: page1Body.nextCursor } });
  assert.equal(scopeMismatch.statusCode, 400);
  const unknownQuery = await list({ query: { q: 'forbidden' } });
  assert.equal(unknownQuery.statusCode, 400);

  const paidDetail = await get(PAYMENT.paid);
  assert.equal(paidDetail.statusCode, 200);
  assert.equal(paidDetail.headers['cache-control'], 'private, no-store');
  const paidBody = paidDetail.json();
  assert.equal(paidBody.status, 'paid');
  assert.equal(paidBody.refundedAmount, 500);
  assert.deepEqual(paidBody.pix, {
    txId: 'a9-paid-tx',
    qrCode: 'A9_PAID_QR',
    copyAndPaste: 'A9_PAID_COPY',
    expiresAt: '2026-08-17T07:00:00.000Z',
  });
  assertSafeProjection(paidBody, 'paid-detail');

  const pendingDetail = await get(PAYMENT.pending);
  assert.equal(pendingDetail.statusCode, 200);
  assert.equal(pendingDetail.json().status, 'pending');
  assert.equal(pendingDetail.json().pix.txId, 'a9-pending-tx');

  const creatingDetail = await get(PAYMENT.creating);
  assert.equal(creatingDetail.statusCode, 200);
  assert.equal(creatingDetail.json().status, 'creating');
  assert.equal(creatingDetail.json().pix, null);
  assertSafeProjection(creatingDetail.json(), 'creating-detail');

  const missingResponses = await Promise.all([
    get('39000000-0000-0000-0000-000000000999'),
    get(PAYMENT.foreign),
    get(PAYMENT.paid, { environment: 'production' }),
  ]);
  for (const response of missingResponses) {
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, 'resource_not_found');
    assert.equal(response.json().error.message, 'Transaction was not found.');
  }

  process.stdout.write('A9_ACCEPTANCE_OK dashboard transaction read behavior\n');
} finally {
  if (insertedNewer) {
    try {
      adminSql(`delete from app.payments where id = '${PAYMENT.newerDuringPagination}'::uuid;`);
    } catch {}
  }
  await app.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
}
