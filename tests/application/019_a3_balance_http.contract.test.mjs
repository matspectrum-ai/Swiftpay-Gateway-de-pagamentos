import assert from 'node:assert/strict';
import test from 'node:test';

const REQUEST_ID = 'req-a3-balance-http-001';
const TOKEN = 'signed-a3-access-token';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sandboxPrincipal = {
  merchantId: 'b0000000-0000-0000-0000-000000000001',
  credentialId: 'b1000000-0000-0000-0000-000000000001',
  environment: 'sandbox',
  secretVersion: 4,
  tokenId: 'b2000000-0000-0000-0000-000000000001',
};

const productionPrincipal = {
  ...sandboxPrincipal,
  credentialId: 'b1000000-0000-0000-0000-000000000002',
  environment: 'production',
  tokenId: 'b2000000-0000-0000-0000-000000000002',
};

const sandboxBalance = {
  currency: 'BRL',
  environment: 'sandbox',
  pendingSettlement: 15_000,
  available: 0,
  reserved: 0,
  blockedPayouts: 0,
  blockedRefunds: 0,
  blocked: 0,
  withdrawable: 0,
  totalMerchantFunds: 15_000,
};

const productionBalance = {
  currency: 'BRL',
  environment: 'production',
  pendingSettlement: 0,
  available: 0,
  reserved: 0,
  blockedPayouts: 0,
  blockedRefunds: 0,
  blocked: 0,
  withdrawable: 0,
  totalMerchantFunds: 0,
};

async function buildWith(overrides = {}) {
  const api = await import('../../apps/api/dist/app.js');
  return api.buildApp({
    readinessProbe: async () => {},
    authenticateBearer: async (token) => token === TOKEN ? sandboxPrincipal : null,
    merchantBalance: {
      async get() { return sandboxBalance; },
    },
    ...overrides,
  });
}

async function balanceRequest(app, authorization = `Bearer ${TOKEN}`) {
  const headers = { 'x-request-id': REQUEST_ID };
  if (authorization !== null) headers.authorization = authorization;
  return app.inject({ method: 'GET', url: '/v1/balance', headers });
}

function assertServerRequestId(response, { expectErrorBody = false } = {}) {
  const requestId = response.headers['x-request-id'];
  assert.equal(typeof requestId, 'string');
  assert.match(requestId, UUID_V4);
  assert.notEqual(requestId, REQUEST_ID);
  if (expectErrorBody) {
    assert.equal(response.json().error?.requestId, requestId);
  }
  return requestId;
}

function invalidAccessTokenBody(requestId) {
  return {
    error: {
      code: 'invalid_access_token',
      message: 'Invalid access token.',
      requestId,
    },
  };
}

test('A3 balance rejects missing malformed and invalid Bearer credentials before balance lookup', async () => {
  let authCalls = 0;
  let balanceCalls = 0;
  const app = await buildWith({
    authenticateBearer: async (token) => {
      authCalls += 1;
      return token === TOKEN ? sandboxPrincipal : null;
    },
    merchantBalance: {
      async get() { balanceCalls += 1; return sandboxBalance; },
    },
  });

  try {
    const responses = [
      await balanceRequest(app, null),
      await balanceRequest(app, 'Basic abc'),
      await balanceRequest(app, 'Bearer wrong-token'),
    ];
    for (const response of responses) {
      assert.equal(response.statusCode, 401);
      const requestId = assertServerRequestId(response, { expectErrorBody: true });
      assert.deepEqual(response.json(), invalidAccessTokenBody(requestId));
    }
    assert.equal(new Set(responses.map((response) => response.headers['x-request-id'])).size, responses.length);
    assert.equal(authCalls, 1);
    assert.equal(balanceCalls, 0);
  } finally {
    await app.close();
  }
});

test('A3 balance derives Sandbox merchant scope only from authenticated principal and returns direct snapshot', async () => {
  let receivedToken;
  let receivedInput;
  const app = await buildWith({
    authenticateBearer: async (token) => {
      receivedToken = token;
      return sandboxPrincipal;
    },
    merchantBalance: {
      async get(input) { receivedInput = input; return sandboxBalance; },
    },
  });

  try {
    const response = await balanceRequest(app);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), sandboxBalance);
    assert.equal(receivedToken, TOKEN);
    assert.deepEqual(receivedInput, { principal: sandboxPrincipal });
    assertServerRequestId(response);
  } finally {
    await app.close();
  }
});

test('A3 balance permits Production principal for read while preserving Production scope', async () => {
  let receivedInput;
  const app = await buildWith({
    authenticateBearer: async () => productionPrincipal,
    merchantBalance: {
      async get(input) { receivedInput = input; return productionBalance; },
    },
  });

  try {
    const response = await balanceRequest(app);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), productionBalance);
    assert.deepEqual(receivedInput, { principal: productionPrincipal });
    assertServerRequestId(response);
  } finally {
    await app.close();
  }
});

test('A3 balance sanitizes authentication and database-service failures as internal_error', async () => {
  for (const overrides of [
    { authenticateBearer: async () => { throw new Error('postgresql://secret-auth-db'); } },
    { merchantBalance: { async get() { throw new Error('password=secret app.accounts'); } } },
  ]) {
    const app = await buildWith(overrides);
    try {
      const response = await balanceRequest(app);
      assert.equal(response.statusCode, 500);
      const body = response.json();
      assert.equal(body?.error?.code, 'internal_error');
      assertServerRequestId(response, { expectErrorBody: true });
      assert.doesNotMatch(JSON.stringify(body), /secret|postgresql|password|app\.accounts/i);
    } finally {
      await app.close();
    }
  }
});

test('A3 balance fails closed when the balance service is not wired', async () => {
  const app = await buildWith({ merchantBalance: undefined });
  try {
    const response = await balanceRequest(app);
    assert.equal(response.statusCode, 500);
    const body = response.json();
    assert.equal(body?.error?.code, 'internal_error');
    assertServerRequestId(response, { expectErrorBody: true });
  } finally {
    await app.close();
  }
});