import assert from 'node:assert/strict';
import test from 'node:test';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CALLER_REQUEST_ID = 'req-a1-http-001';

async function buildWith(handler) {
  const api = await import('../../apps/api/dist/app.js');
  return api.buildApp({
    readinessProbe: async () => {},
    tokenExchange: handler,
  });
}

const requestBody = {
  grantType: 'client_credentials',
  publicKey: 'pk_test',
  secretKey: 'plaintext-secret-must-never-leak',
};

async function injectToken(app, options = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/token',
    headers: {
      'content-type': 'application/json',
      'x-request-id': CALLER_REQUEST_ID,
      ...(options.headers ?? {}),
    },
    payload: options.payload ?? requestBody,
  });
}

function errorResult(code, message = 'request failed', retryAfterSeconds) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  };
}

function assertServerRequestId(response) {
  const requestId = response.headers['x-request-id'];
  assert.equal(typeof requestId, 'string');
  assert.match(requestId, UUID_V4);
  assert.notEqual(requestId, CALLER_REQUEST_ID);
  return requestId;
}

function assertErrorCorrelation(response, expectedCode, expectedMessage) {
  const requestId = assertServerRequestId(response);
  assert.deepEqual(response.json(), {
    error: {
      code: expectedCode,
      message: expectedMessage,
      requestId,
    },
  });
  return requestId;
}

test('A1 token endpoint maps successful token exchange to direct 200 response', async () => {
  let receivedRequest;
  let receivedContext;
  const app = await buildWith(async (request, context) => {
    receivedRequest = request;
    receivedContext = context;
    return {
      ok: true,
      value: {
        accessToken: 'signed-access-token',
        tokenType: 'Bearer',
        expiresIn: 900,
        environment: 'sandbox',
      },
    };
  });

  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      accessToken: 'signed-access-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      environment: 'sandbox',
    });
    assert.deepEqual(receivedRequest, requestBody);
    const requestId = assertServerRequestId(response);
    assert.equal(receivedContext.requestId, requestId);
    assert.equal(typeof receivedContext.clientIp, 'string');
    assert.notEqual(receivedContext.clientIp.length, 0);
  } finally {
    await app.close();
  }
});

test('A1 validation failure maps to deterministic 400 public error', async () => {
  const app = await buildWith(async () => errorResult('validation_error', 'Invalid token request.'));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 400);
    assertErrorCorrelation(response, 'validation_error', 'Invalid token request.');
  } finally {
    await app.close();
  }
});

test('A1 invalid credential failure maps to indistinguishable 401', async () => {
  const app = await buildWith(async () => errorResult('invalid_credentials', 'Invalid credentials.'));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 401);
    assertErrorCorrelation(response, 'invalid_credentials', 'Invalid credentials.');
  } finally {
    await app.close();
  }
});

test('A1 IP policy failure maps to 403', async () => {
  const app = await buildWith(async () => errorResult('ip_not_allowed', 'IP address is not allowed.'));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 403);
    assertErrorCorrelation(response, 'ip_not_allowed', 'IP address is not allowed.');
  } finally {
    await app.close();
  }
});

test('A1 token issuance quota failure maps to 429 and Retry-After', async () => {
  const app = await buildWith(async () => errorResult('auth_rate_limit_exceeded', 'Token issuance rate limit exceeded.', 173));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers['retry-after'], '173');
    assertErrorCorrelation(response, 'auth_rate_limit_exceeded', 'Token issuance rate limit exceeded.');
  } finally {
    await app.close();
  }
});

test('A1 classified internal failure maps to sanitized 500', async () => {
  const app = await buildWith(async () => errorResult('internal_error', 'Authentication is unavailable.'));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 500);
    assertErrorCorrelation(response, 'internal_error', 'Authentication is unavailable.');
  } finally {
    await app.close();
  }
});

test('A1 unexpected handler exception is sanitized and never leaks secret text', async () => {
  const app = await buildWith(async () => {
    throw new Error('unexpected failure with plaintext-secret-must-never-leak');
  });
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 500);
    assertErrorCorrelation(response, 'internal_error', 'Authentication is unavailable.');
    assert.doesNotMatch(response.body, /plaintext-secret-must-never-leak/);
  } finally {
    await app.close();
  }
});

test('A1 endpoint fails closed when no token exchange service is wired', async () => {
  const api = await import('../../apps/api/dist/app.js');
  const app = api.buildApp({ readinessProbe: async () => {} });
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 500);
    assertErrorCorrelation(response, 'internal_error', 'Authentication is unavailable.');
  } finally {
    await app.close();
  }
});
