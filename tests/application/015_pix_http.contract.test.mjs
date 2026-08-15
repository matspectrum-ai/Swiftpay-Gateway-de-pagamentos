import assert from 'node:assert/strict';
import test from 'node:test';

const REQUEST_ID = 'req-a2-http-001';
const TOKEN = 'signed-a2-access-token';
const PAYMENT_ID = '70000000-0000-0000-0000-000000000001';

const principal = {
  merchantId: '60000000-0000-0000-0000-000000000001',
  credentialId: '61000000-0000-0000-0000-000000000001',
  environment: 'sandbox',
  secretVersion: 3,
  tokenId: '62000000-0000-0000-0000-000000000001',
};

const requestBody = {
  method: 'pix',
  amount: 10_101,
  currency: 'BRL',
  description: 'Pedido A2 HTTP',
  externalId: 'order-a2-http-001',
  pixExpirationMinutes: 30,
};

const payment = {
  id: PAYMENT_ID,
  externalId: 'order-a2-http-001',
  method: 'pix',
  amount: 10_101,
  fee: 0,
  netAmount: 10_101,
  currency: 'BRL',
  status: 'pending',
  description: 'Pedido A2 HTTP',
  environment: 'sandbox',
  expiresAt: '2026-08-15T12:30:00.000Z',
  createdAt: '2026-08-15T12:00:00.000Z',
  pix: {
    txId: 'swiftpay-emulator-tx:71000000-0000-0000-0000-000000000001',
    qrCode: 'SWIFTPAY_EMULATOR_QR_71000000-0000-0000-0000-000000000001',
    copyAndPaste: 'SWIFTPAY_EMULATOR_COPY_71000000-0000-0000-0000-000000000001',
    expiresAt: '2026-08-15T12:30:00.000Z',
  },
};

async function buildWith(overrides = {}) {
  const api = await import('../../apps/api/dist/app.js');
  return api.buildApp({
    readinessProbe: async () => {},
    authenticateBearer: async (token) => token === TOKEN ? principal : null,
    pixPayments: {
      async create() {
        return { ok: true, httpStatus: 201, payment, replayed: false };
      },
      async get() {
        return payment;
      },
    },
    ...overrides,
  });
}

function authHeaders(extra = {}) {
  return {
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    'x-request-id': REQUEST_ID,
    ...extra,
  };
}

async function createRequest(app, options = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/transactions',
    headers: options.headers ?? authHeaders({ 'idempotency-key': 'idem-a2-http-001' }),
    payload: options.payload ?? requestBody,
  });
}

async function getRequest(app, options = {}) {
  return app.inject({
    method: 'GET',
    url: `/v1/transactions/${options.paymentId ?? PAYMENT_ID}`,
    headers: options.headers ?? {
      authorization: `Bearer ${TOKEN}`,
      'x-request-id': REQUEST_ID,
    },
  });
}

function invalidAccessTokenBody() {
  return {
    error: {
      code: 'invalid_access_token',
      message: 'Invalid access token.',
      requestId: REQUEST_ID,
    },
  };
}

test('A2 protected Pix routes reject missing malformed and invalid Bearer credentials indistinguishably', async () => {
  let authCalls = 0;
  let paymentCalls = 0;
  const app = await buildWith({
    authenticateBearer: async (token) => {
      authCalls += 1;
      return token === TOKEN ? principal : null;
    },
    pixPayments: {
      async create() { paymentCalls += 1; return { ok: true, httpStatus: 201, payment, replayed: false }; },
      async get() { paymentCalls += 1; return payment; },
    },
  });

  try {
    const cases = [
      await createRequest(app, { headers: { 'content-type': 'application/json', 'x-request-id': REQUEST_ID, 'idempotency-key': 'idem' } }),
      await createRequest(app, { headers: { authorization: 'Basic abc', 'content-type': 'application/json', 'x-request-id': REQUEST_ID, 'idempotency-key': 'idem' } }),
      await createRequest(app, { headers: { authorization: 'Bearer wrong-token', 'content-type': 'application/json', 'x-request-id': REQUEST_ID, 'idempotency-key': 'idem' } }),
      await getRequest(app, { headers: { 'x-request-id': REQUEST_ID } }),
    ];

    for (const response of cases) {
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), invalidAccessTokenBody());
      assert.equal(response.headers['x-request-id'], REQUEST_ID);
    }
    assert.equal(authCalls, 1);
    assert.equal(paymentCalls, 0);
  } finally {
    await app.close();
  }
});

test('A2 POST authenticates first and forwards principal Idempotency-Key and exact body to Pix application service', async () => {
  let receivedToken;
  let receivedInput;
  const app = await buildWith({
    authenticateBearer: async (token) => {
      receivedToken = token;
      return principal;
    },
    pixPayments: {
      async create(input) {
        receivedInput = input;
        return { ok: true, httpStatus: 201, payment, replayed: false };
      },
      async get() { throw new Error('not used'); },
    },
  });

  try {
    const response = await createRequest(app);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), payment);
    assert.equal(receivedToken, TOKEN);
    assert.deepEqual(receivedInput, {
      principal,
      idempotencyKey: 'idem-a2-http-001',
      request: requestBody,
    });
    assert.equal(response.headers['x-request-id'], REQUEST_ID);
  } finally {
    await app.close();
  }
});

test('A2 POST preserves 202 replay/in-flight semantics without wrapping the Payment resource', async () => {
  const creating = { ...payment, status: 'creating', pix: null };
  const app = await buildWith({
    pixPayments: {
      async create() { return { ok: true, httpStatus: 202, payment: creating, replayed: true }; },
      async get() { return creating; },
    },
  });

  try {
    const response = await createRequest(app);
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.json(), creating);
  } finally {
    await app.close();
  }
});

test('A2 POST maps domain validation forbidden conflict and classified internal failures with requestId', async () => {
  const cases = [
    [400, 'validation_error', 'Pix create request is invalid.'],
    [403, 'operation_forbidden', 'Pix creation is not enabled for this environment.'],
    [409, 'idempotency_key_reused', 'Idempotency-Key was already used with a different request.'],
    [500, 'internal_error', 'Payment operation failed.'],
  ];

  for (const [status, code, message] of cases) {
    const app = await buildWith({
      pixPayments: {
        async create() { return { ok: false, httpStatus: status, error: { code, message } }; },
        async get() { return payment; },
      },
    });
    try {
      const response = await createRequest(app);
      assert.equal(response.statusCode, status);
      assert.deepEqual(response.json(), { error: { code, message, requestId: REQUEST_ID } });
    } finally {
      await app.close();
    }
  }
});

test('A2 GET authenticates first and scopes Payment lookup from the machine principal', async () => {
  let receivedInput;
  const app = await buildWith({
    pixPayments: {
      async create() { throw new Error('not used'); },
      async get(input) { receivedInput = input; return payment; },
    },
  });

  try {
    const response = await getRequest(app);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), payment);
    assert.deepEqual(receivedInput, { principal, paymentId: PAYMENT_ID });
  } finally {
    await app.close();
  }
});

test('A2 GET maps foreign missing or wrong-environment Payment to the same 404 resource_not_found', async () => {
  const app = await buildWith({
    pixPayments: {
      async create() { throw new Error('not used'); },
      async get() { return null; },
    },
  });

  try {
    const response = await getRequest(app);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: {
        code: 'resource_not_found',
        message: 'Payment was not found.',
        requestId: REQUEST_ID,
      },
    });
  } finally {
    await app.close();
  }
});

test('A2 protected Pix routes sanitize authentication and payment-service exceptions', async () => {
  const authFailure = await buildWith({
    authenticateBearer: async () => { throw new Error('postgresql://secret-auth-db'); },
  });
  try {
    const response = await createRequest(authFailure);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: { code: 'internal_error', message: 'Payment operation failed.', requestId: REQUEST_ID },
    });
    assert.doesNotMatch(response.body, /secret-auth-db|postgresql/i);
  } finally {
    await authFailure.close();
  }

  const paymentFailure = await buildWith({
    pixPayments: {
      async create() { throw new Error('provider secret SWIFTPAY_EMULATOR_COPY_private'); },
      async get() { throw new Error('provider secret'); },
    },
  });
  try {
    const createResponse = await createRequest(paymentFailure);
    const getResponse = await getRequest(paymentFailure);
    for (const response of [createResponse, getResponse]) {
      assert.equal(response.statusCode, 500);
      assert.deepEqual(response.json(), {
        error: { code: 'internal_error', message: 'Payment operation failed.', requestId: REQUEST_ID },
      });
      assert.doesNotMatch(response.body, /provider secret|SWIFTPAY_EMULATOR_COPY_private/i);
    }
  } finally {
    await paymentFailure.close();
  }
});

test('A2 protected Pix routes fail closed when Bearer or payment application services are not wired', async () => {
  const api = await import('../../apps/api/dist/app.js');

  const withoutAuth = api.buildApp({
    readinessProbe: async () => {},
    pixPayments: { async create() { return { ok: true, httpStatus: 201, payment, replayed: false }; }, async get() { return payment; } },
  });
  try {
    const response = await createRequest(withoutAuth);
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, 'internal_error');
    assert.equal(response.json().error.requestId, REQUEST_ID);
  } finally {
    await withoutAuth.close();
  }

  const withoutPayments = api.buildApp({
    readinessProbe: async () => {},
    authenticateBearer: async () => principal,
  });
  try {
    const response = await getRequest(withoutPayments);
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, 'internal_error');
    assert.equal(response.json().error.requestId, REQUEST_ID);
  } finally {
    await withoutPayments.close();
  }
});
