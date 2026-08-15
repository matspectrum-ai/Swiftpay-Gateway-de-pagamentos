import assert from 'node:assert/strict';
import test from 'node:test';

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
      'x-request-id': 'req-a1-http-001',
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
    assert.equal(receivedContext.requestId, 'req-a1-http-001');
    assert.equal(typeof receivedContext.clientIp, 'string');
    assert.notEqual(receivedContext.clientIp.length, 0);
    assert.equal(response.headers['x-request-id'], 'req-a1-http-001');
  } finally {
    await app.close();
  }
});

test('A1 validation failure maps to deterministic 400 public error', async () => {
  const app = await buildWith(async () => errorResult('validation_error', 'Invalid token request.'));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: {
        code: 'validation_error',
        message: 'Invalid token request.',
        requestId: 'req-a1-http-001',
      },
    });
    assert.equal(response.headers['x-request-id'], 'req-a1-http-001');
  } finally {
    await app.close();
  }
});

test('A1 invalid credential failure maps to indistinguishable 401', async () => {
  const app = await buildWith(async () => errorResult('invalid_credentials', 'Invalid credentials.'));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: {
        code: 'invalid_credentials',
        message: 'Invalid credentials.',
        requestId: 'req-a1-http-001',
      },
    });
  } finally {
    await app.close();
  }
});

test('A1 IP policy failure maps to 403', async () => {
  const app = await buildWith(async () => errorResult('ip_not_allowed', 'IP address is not allowed.'));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'ip_not_allowed');
    assert.equal(response.json().error.requestId, 'req-a1-http-001');
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
    assert.deepEqual(response.json(), {
      error: {
        code: 'auth_rate_limit_exceeded',
        message: 'Token issuance rate limit exceeded.',
        requestId: 'req-a1-http-001',
      },
    });
  } finally {
    await app.close();
  }
});

test('A1 classified internal failure maps to sanitized 500', async () => {
  const app = await buildWith(async () => errorResult('internal_error', 'Authentication is unavailable.'));
  try {
    const response = await injectToken(app);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: {
        code: 'internal_error',
        message: 'Authentication is unavailable.',
        requestId: 'req-a1-http-001',
      },
    });
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
    assert.deepEqual(response.json(), {
      error: {
        code: 'internal_error',
        message: 'Authentication is unavailable.',
        requestId: 'req-a1-http-001',
      },
    });
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
    assert.deepEqual(response.json(), {
      error: {
        code: 'internal_error',
        message: 'Authentication is unavailable.',
        requestId: 'req-a1-http-001',
      },
    });
  } finally {
    await app.close();
  }
});
