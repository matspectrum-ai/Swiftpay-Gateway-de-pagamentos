import assert from 'node:assert/strict';
import test from 'node:test';

const [payments, db, api] = await Promise.all([
  import('../../packages/payments/dist/index.js'),
  import('../../packages/db/dist/index.js'),
  import('../../apps/api/dist/app.js'),
]);

const USER_ID = '10000000-0000-0000-0000-0000000000a9';
const MERCHANT_ID = '20000000-0000-0000-0000-0000000000a9';
const FOREIGN_MERCHANT_ID = '20000000-0000-0000-0000-0000000000ff';
const PAYMENT_1 = '30000000-0000-0000-0000-0000000000a1';
const PAYMENT_2 = '30000000-0000-0000-0000-0000000000a2';
const PAYMENT_3 = '30000000-0000-0000-0000-0000000000a3';
const CREATED_1 = '2026-08-17T06:00:00.000Z';
const CREATED_2 = '2026-08-17T05:00:00.000Z';
const CREATED_3 = '2026-08-17T04:00:00.000Z';

const LIST_ITEM_1 = {
  id: PAYMENT_1,
  externalId: 'Order A9-001',
  method: 'pix',
  source: 'api',
  amount: 1500,
  fee: 0,
  netAmount: 1500,
  refundedAmount: 0,
  currency: 'BRL',
  status: 'paid',
  description: 'A9 paid fixture',
  environment: 'sandbox',
  expiresAt: '2026-08-17T07:00:00.000Z',
  paidAt: '2026-08-17T06:10:00.000Z',
  createdAt: CREATED_1,
  updatedAt: '2026-08-17T06:10:00.000Z',
};

const LIST_ITEM_2 = {
  ...LIST_ITEM_1,
  id: PAYMENT_2,
  externalId: ' Exact Ref ',
  status: 'creating',
  refundedAmount: 0,
  paidAt: null,
  createdAt: CREATED_2,
  updatedAt: CREATED_2,
};

const LIST_ITEM_3 = {
  ...LIST_ITEM_1,
  id: PAYMENT_3,
  externalId: null,
  status: 'pending',
  paidAt: null,
  createdAt: CREATED_3,
  updatedAt: CREATED_3,
};

const DETAIL = {
  ...LIST_ITEM_1,
  refundedAmount: 500,
  pix: {
    txId: 'swiftpay-a9-tx',
    qrCode: 'SWIFTPAY_A9_QR',
    copyAndPaste: 'SWIFTPAY_A9_COPY',
    expiresAt: '2026-08-17T07:00:00.000Z',
  },
};

const EMPTY_FILTERS = {
  status: null,
  externalId: null,
  createdFrom: null,
  createdTo: null,
};

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

function buildStore(pool) {
  if (typeof db.createDashboardTransactionStore === 'function') {
    return db.createDashboardTransactionStore(pool);
  }
  const missing = async () => ({ kind: 'behavior_not_implemented' });
  return { list: missing, get: missing };
}

function buildReadService(overrides = {}) {
  const calls = { auth: [], context: [], list: [], get: [], encode: [], decode: [] };
  const options = {
    sessionVerifier: async (authorization) => {
      calls.auth.push(authorization);
      return { kind: 'authenticated', principal: { userId: USER_ID } };
    },
    contextStore: {
      requireContext: async (input) => {
        calls.context.push(input);
        return {
          kind: 'authorized',
          context: {
            merchantId: input.merchantId,
            environment: input.environment,
            membershipRole: 'member',
          },
        };
      },
    },
    store: {
      list: async (input) => {
        calls.list.push(input);
        return [LIST_ITEM_1, LIST_ITEM_2, LIST_ITEM_3];
      },
      get: async (input) => {
        calls.get.push(input);
        return input.transactionId === PAYMENT_1 ? DETAIL : null;
      },
    },
    cursorCodec: {
      encode: (input) => {
        calls.encode.push(input);
        return 'a9v1.synthetic.next.signature';
      },
      decode: (input) => {
        calls.decode.push(input);
        return { ok: true, cursor: { createdAt: CREATED_2, paymentId: PAYMENT_2 } };
      },
    },
    ...overrides,
  };

  if (typeof payments.createDashboardTransactionReadService !== 'function') {
    const missing = async () => ({ kind: 'behavior_not_implemented' });
    return { service: { list: missing, get: missing }, calls };
  }
  return { service: payments.createDashboardTransactionReadService(options), calls };
}

test('A9 packages export the frozen query, cursor, read-service and store boundaries', () => {
  assert.equal(typeof payments.validateDashboardTransactionListQuery, 'function');
  assert.equal(typeof payments.createDashboardTransactionCursorCodec, 'function');
  assert.equal(typeof payments.createDashboardTransactionReadService, 'function');
  assert.equal(typeof db.createDashboardTransactionStore, 'function');
});

test('A9 list-query validation preserves exact externalId, normalizes dates and bounds limit', () => {
  const validate = payments.validateDashboardTransactionListQuery;
  assert.equal(typeof validate, 'function');
  if (typeof validate !== 'function') return;

  const result = validate({
    status: 'paid',
    externalId: ' Exact Ref ',
    createdFrom: '2026-08-17T01:02:03-03:00',
    createdTo: '2026-08-18T04:02:03Z',
    limit: '50',
  });
  assert.deepEqual(result, {
    ok: true,
    value: {
      status: 'paid',
      externalId: ' Exact Ref ',
      createdFrom: '2026-08-17T04:02:03.000Z',
      createdTo: '2026-08-18T04:02:03.000Z',
      cursor: null,
      limit: 50,
    },
  });

  const defaults = validate({});
  assert.equal(defaults.ok, true);
  assert.equal(defaults.value.limit, 25);
  assert.equal(defaults.value.status, null);

  for (const invalid of [
    { q: 'anything' },
    { externalId: '' },
    { status: 'execution_unknown' },
    { limit: '0' },
    { limit: '101' },
    { createdFrom: '2026-08-17T00:00:00', createdTo: '2026-08-18T00:00:00Z' },
    { createdFrom: '2026-08-18T00:00:00Z', createdTo: '2026-08-17T00:00:00Z' },
  ]) {
    assert.equal(validate(invalid).ok, false, JSON.stringify(invalid));
  }
});

test('A9 cursor is authenticated and bound to route scope plus exact normalized filters', () => {
  const factory = payments.createDashboardTransactionCursorCodec;
  assert.equal(typeof factory, 'function');
  if (typeof factory !== 'function') return;

  const key = 'a9-test-cursor-key-32-bytes-minimum!!';
  const codec = factory({ activeKeyId: 'a9-current', keys: [{ id: 'a9-current', secret: key }] });
  const token = codec.encode({
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    filters: EMPTY_FILTERS,
    createdAt: CREATED_2,
    paymentId: PAYMENT_2,
  });
  assert.match(token, /^a9v1\.a9-current\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  assert.deepEqual(codec.decode({
    token,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    filters: EMPTY_FILTERS,
  }), {
    ok: true,
    cursor: { createdAt: CREATED_2, paymentId: PAYMENT_2 },
  });

  const changedLast = token.endsWith('A') ? 'B' : 'A';
  const tampered = `${token.slice(0, -1)}${changedLast}`;
  assert.equal(codec.decode({ token: tampered, merchantId: MERCHANT_ID, environment: 'sandbox', filters: EMPTY_FILTERS }).ok, false);
  assert.equal(codec.decode({ token, merchantId: FOREIGN_MERCHANT_ID, environment: 'sandbox', filters: EMPTY_FILTERS }).ok, false);
  assert.equal(codec.decode({ token, merchantId: MERCHANT_ID, environment: 'sandbox', filters: { ...EMPTY_FILTERS, status: 'paid' } }).ok, false);
});

test('A9 cursor factory rejects missing or undersized integrity authority', () => {
  const factory = payments.createDashboardTransactionCursorCodec;
  assert.equal(typeof factory, 'function');
  if (typeof factory !== 'function') return;
  assert.throws(() => factory({ activeKeyId: 'a9-current', keys: [] }));
  assert.throws(() => factory({ activeKeyId: 'a9-current', keys: [{ id: 'a9-current', secret: 'too-short' }] }));
});

test('A9 db store uses only the two frozen trusted routines and no direct Payment table SQL', async () => {
  assert.equal(typeof db.createDashboardTransactionStore, 'function');
  const pool = recordingPool([{ transactions: [LIST_ITEM_1], transaction: DETAIL }]);
  const store = buildStore(pool);
  const common = { userId: USER_ID, merchantId: MERCHANT_ID, environment: 'sandbox' };

  await store.list({
    ...common,
    status: 'paid',
    externalId: ' Exact Ref ',
    createdFrom: null,
    createdTo: null,
    cursorCreatedAt: null,
    cursorPaymentId: null,
    limit: 25,
  });
  await store.get({ ...common, transactionId: PAYMENT_1 });

  assert.equal(pool.calls.length, 2);
  assert.equal(pool.calls[0].sql.includes('app.list_dashboard_transactions'), true);
  assert.equal(pool.calls[1].sql.includes('app.get_dashboard_transaction'), true);
  const combinedSql = pool.calls.map((call) => call.sql.toLowerCase()).join('\n');
  assert.equal(combinedSql.includes('from app.payments'), false);
  assert.equal(combinedSql.includes('from app.provider_attempts'), false);
});

test('A9 list service uses ordinary member authority, limit+1 rows and emits cursor from last returned item', async () => {
  const { service, calls } = buildReadService();
  const result = await service.list({
    authorization: 'Bearer ordinary-aal1-dashboard',
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    query: { limit: '2' },
  });

  assert.deepEqual(result, {
    kind: 'ok',
    items: [LIST_ITEM_1, LIST_ITEM_2],
    nextCursor: 'a9v1.synthetic.next.signature',
  });
  assert.deepEqual(calls.auth, ['Bearer ordinary-aal1-dashboard']);
  assert.equal(calls.context.length, 1);
  assert.equal(calls.context[0].requiredRole, 'member');
  assert.equal(calls.list.length, 1);
  assert.equal(calls.list[0].limit, 2);
  assert.equal(calls.encode.length, 1);
  assert.equal(calls.encode[0].paymentId, PAYMENT_2);
  assert.equal(service.create, undefined);
  assert.equal(service.update, undefined);
  assert.equal(service.cancel, undefined);
});

test('A9 list rejects a cursor before database access when cursor scope/filter validation fails', async () => {
  const { service, calls } = buildReadService({
    cursorCodec: {
      encode: () => 'unused',
      decode: (input) => {
        calls.decode.push(input);
        return { ok: false, violation: { field: 'cursor', code: 'invalid_cursor', message: 'Invalid cursor.' } };
      },
    },
  });

  const result = await service.list({
    authorization: 'Bearer ordinary-aal1-dashboard',
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    query: { cursor: 'a9v1.forged.payload.signature' },
  });
  assert.equal(result.kind, 'validation_error');
  assert.equal(calls.list.length, 0);
});

test('A9 detail service returns canonical detail and maps absence without cross-tenant disclosure', async () => {
  const { service, calls } = buildReadService();
  const found = await service.get({
    authorization: 'Bearer ordinary-aal1-dashboard',
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    transactionId: PAYMENT_1,
  });
  assert.deepEqual(found, { kind: 'ok', transaction: DETAIL });
  assert.equal(calls.context.at(-1).requiredRole, 'member');

  const absent = await service.get({
    authorization: 'Bearer ordinary-aal1-dashboard',
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    transactionId: '30000000-0000-0000-0000-0000000000ff',
  });
  assert.deepEqual(absent, { kind: 'resource_not_found' });
});

test('A9 Fastify exposes dashboard-only list/detail, no-store caching and stable dashboard error mapping', async () => {
  const service = {
    list: async () => ({ kind: 'ok', items: [LIST_ITEM_1], nextCursor: null }),
    get: async (input) => input.transactionId === PAYMENT_1
      ? { kind: 'ok', transaction: DETAIL }
      : { kind: 'resource_not_found' },
  };
  const app = api.buildApp({
    readinessProbe: async () => {},
    dashboardTransactions: service,
  });

  const base = `/dashboard/v1/merchants/${MERCHANT_ID}/environments/sandbox/transactions`;
  const listed = await app.inject({ method: 'GET', url: base, headers: { authorization: 'Bearer dashboard-token' } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.headers['cache-control'], 'private, no-store');
  assert.deepEqual(listed.json(), { items: [LIST_ITEM_1], nextCursor: null });

  const detail = await app.inject({ method: 'GET', url: `${base}/${PAYMENT_1}`, headers: { authorization: 'Bearer dashboard-token' } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.headers['cache-control'], 'private, no-store');
  assert.deepEqual(detail.json(), DETAIL);

  const missing = await app.inject({ method: 'GET', url: `${base}/30000000-0000-0000-0000-0000000000ff`, headers: { authorization: 'Bearer dashboard-token' } });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'resource_not_found');

  const machineNamespace = await app.inject({ method: 'GET', url: `/v1/merchants/${MERCHANT_ID}/transactions`, headers: { authorization: 'Bearer machine-token' } });
  assert.equal(machineNamespace.statusCode, 404);
  const mutation = await app.inject({ method: 'POST', url: base, headers: { authorization: 'Bearer dashboard-token' }, payload: {} });
  assert.equal(mutation.statusCode, 404);

  await app.close();
});

test('A9 Fastify maps service auth kinds to existing stable dashboard public codes', async () => {
  const cases = [
    ['invalid_session', 401, 'invalid_dashboard_session'],
    ['forbidden', 403, 'operation_forbidden'],
    ['authentication_unavailable', 503, 'dashboard_authentication_unavailable'],
    ['validation_error', 400, 'validation_error'],
    ['internal_error', 500, 'internal_error'],
  ];

  for (const [kind, status, code] of cases) {
    const app = api.buildApp({
      readinessProbe: async () => {},
      dashboardTransactions: { list: async () => ({ kind }) },
    });
    const response = await app.inject({
      method: 'GET',
      url: `/dashboard/v1/merchants/${MERCHANT_ID}/environments/sandbox/transactions`,
      headers: { authorization: 'Bearer dashboard-token' },
    });
    assert.equal(response.statusCode, status, kind);
    assert.equal(response.json().error.code, code, kind);
    assert.equal(typeof response.json().error.requestId, 'string', kind);
    await app.close();
  }
});
