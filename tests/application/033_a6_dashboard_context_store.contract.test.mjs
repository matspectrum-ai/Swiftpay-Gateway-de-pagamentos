import assert from 'node:assert/strict';
import test from 'node:test';

const db = await import('../../packages/db/dist/index.js');

const USER_ID = '10000000-0000-0000-0000-0000000000a6';
const MERCHANT_ID = '20000000-0000-0000-0000-0000000000a6';

const factory = db.createDashboardMerchantContextStore;

function buildStore(pool) {
  if (typeof factory !== 'function') {
    return {
      requireContext: async () => ({ kind: 'not_implemented' }),
    };
  }
  return factory(pool);
}

function pgError(code) {
  return Object.assign(new Error('database detail must not cross boundary'), { code });
}

test('A6 db package exports createDashboardMerchantContextStore', () => {
  assert.equal(typeof factory, 'function');
});

test('A6 dashboard context store calls only the frozen K4 routine with exact argument order', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          merchant_id: MERCHANT_ID,
          environment: 'sandbox',
          membership_role: 'admin',
        }],
      };
    },
  };
  const store = buildStore(pool);

  const result = await store.requireContext({
    userId: USER_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    requiredRole: 'admin',
  });

  assert.deepEqual(result, {
    kind: 'authorized',
    context: {
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
      membershipRole: 'admin',
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [USER_ID, MERCHANT_ID, 'sandbox', 'admin']);
  assert.match(calls[0].sql, /app\.require_dashboard_merchant_context\s*\(/i);
  assert.doesNotMatch(calls[0].sql, /auth\.users|merchant_members/i);
  assert.doesNotMatch(calls[0].sql, /\b(insert|update|delete|truncate)\b/i);
});

test('A6 dashboard context store maps K4 42501 to forbidden without disclosure', async () => {
  const store = buildStore({ query: async () => { throw pgError('42501'); } });
  const result = await store.requireContext({
    userId: USER_ID,
    merchantId: MERCHANT_ID,
    environment: 'production',
    requiredRole: 'member',
  });
  assert.deepEqual(result, { kind: 'forbidden' });
  assert.equal(JSON.stringify(result).includes('membership'), false);
});

test('A6 dashboard context store maps K4 23514 to validation_error', async () => {
  const store = buildStore({ query: async () => { throw pgError('23514'); } });
  assert.deepEqual(await store.requireContext({
    userId: USER_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    requiredRole: 'member',
  }), { kind: 'validation_error' });
});

test('A6 dashboard context store maps every other database failure to internal_error', async () => {
  for (const code of ['08006', 'XX000', undefined]) {
    const store = buildStore({ query: async () => { throw pgError(code); } });
    assert.deepEqual(await store.requireContext({
      userId: USER_ID,
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
      requiredRole: 'owner',
    }), { kind: 'internal_error' });
  }
});

test('A6 dashboard context store fails closed on malformed K4 result rows', async () => {
  for (const rows of [[], [{}], [{ merchant_id: MERCHANT_ID, environment: 'sandbox', membership_role: 'superadmin' }]]) {
    const store = buildStore({ query: async () => ({ rows }) });
    assert.deepEqual(await store.requireContext({
      userId: USER_ID,
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
      requiredRole: 'member',
    }), { kind: 'internal_error' });
  }
});

test('A6 dashboard context store never performs direct table access or DML', async () => {
  const statements = [];
  const store = buildStore({
    query: async (sql) => {
      statements.push(sql);
      return {
        rows: [{ merchant_id: MERCHANT_ID, environment: 'sandbox', membership_role: 'owner' }],
      };
    },
  });
  await store.requireContext({
    userId: USER_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    requiredRole: 'owner',
  });
  assert.equal(statements.length, 1);
  const sql = statements.join('\n');
  assert.match(sql, /require_dashboard_merchant_context/i);
  assert.doesNotMatch(sql, /auth\.users|app\.merchant_members/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate)\b/i);
});
