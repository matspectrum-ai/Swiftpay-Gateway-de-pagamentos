import assert from 'node:assert/strict';
import test from 'node:test';

const secretUrl = 'postgresql://swiftpay_api_runtime:do-not-leak-this@127.0.0.1:54322/postgres';

async function imports() {
  const [config, db, api] = await Promise.all([
    import('../../packages/config/dist/index.js'),
    import('../../packages/db/dist/index.js'),
    import('../../apps/api/dist/app.js'),
  ]);
  return { config, db, api };
}

test('K7 API config rejects malformed/non-PostgreSQL database URLs without leaking values', async () => {
  const { config } = await imports();

  for (const databaseUrl of [
    'not-a-url-do-not-leak',
    'https://user:do-not-leak@example.com/database',
  ]) {
    assert.throws(
      () => config.loadApiConfig({
        SWIFTPAY_ENVIRONMENT: 'sandbox',
        SWIFTPAY_API_DATABASE_URL: databaseUrl,
      }),
      (error) => {
        assert.equal(error?.name, 'ConfigurationError');
        assert.doesNotMatch(String(error?.message), new RegExp(databaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(String(error?.message), /SWIFTPAY_API_DATABASE_URL/);
        return true;
      },
    );
  }
});

test('K7 worker config rejects malformed/non-PostgreSQL database URLs', async () => {
  const { config } = await imports();

  assert.throws(
    () => config.loadWorkerConfig({
      SWIFTPAY_ENVIRONMENT: 'sandbox',
      SWIFTPAY_WORKER_DATABASE_URL: 'file:///tmp/not-postgres',
    }),
    (error) => {
      assert.equal(error?.name, 'ConfigurationError');
      assert.match(String(error?.message), /SWIFTPAY_WORKER_DATABASE_URL/);
      assert.doesNotMatch(String(error?.message), /file:\/\/\/tmp\/not-postgres/);
      return true;
    },
  );
});

test('K7 workload config never falls back to the other workload database URL', async () => {
  const { config } = await imports();

  assert.throws(() => config.loadApiConfig({
    SWIFTPAY_ENVIRONMENT: 'sandbox',
    SWIFTPAY_WORKER_DATABASE_URL: secretUrl,
  }), /SWIFTPAY_API_DATABASE_URL/);

  assert.throws(() => config.loadWorkerConfig({
    SWIFTPAY_ENVIRONMENT: 'sandbox',
    SWIFTPAY_API_DATABASE_URL: secretUrl,
  }), /SWIFTPAY_WORKER_DATABASE_URL/);
});

test('K7 API liveness never executes database readiness', async () => {
  const { api } = await imports();
  let probes = 0;
  const app = api.buildApp({
    readinessProbe: async () => {
      probes += 1;
      throw new Error('database should not be touched by liveness');
    },
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'live' });
    assert.equal(probes, 0);
  } finally {
    await app.close();
  }
});

test('K7 API readiness succeeds only when its probe succeeds', async () => {
  const { api } = await imports();
  let probes = 0;
  const app = api.buildApp({ readinessProbe: async () => { probes += 1; } });

  try {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ready', workload: 'api' });
    assert.equal(probes, 1);
  } finally {
    await app.close();
  }
});

test('K7 API readiness returns sanitized 503 on database failure', async () => {
  const { api } = await imports();
  const app = api.buildApp({
    readinessProbe: async () => {
      throw new Error(`connection failed: ${secretUrl}`);
    },
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 503);
    const body = response.body;
    assert.deepEqual(response.json(), { status: 'unavailable', workload: 'api' });
    assert.doesNotMatch(body, /do-not-leak-this/);
    assert.doesNotMatch(body, /postgresql:\/\//);
  } finally {
    await app.close();
  }
});

test('K7 database boundary wraps database errors without propagating connection details', async () => {
  const { db } = await imports();
  const fakePool = {
    async query() {
      throw new Error(`provider error with ${secretUrl}`);
    },
  };

  await assert.rejects(
    () => db.verifyRuntimeBoundary(fakePool, 'api'),
    (error) => {
      assert.equal(error?.name, 'RuntimeBoundaryError');
      assert.equal(error?.message, 'Runtime database readiness check failed');
      assert.doesNotMatch(String(error), /do-not-leak-this/);
      return true;
    },
  );
});

test('K7 database boundary rejects an otherwise reachable wrong runtime identity', async () => {
  const { db } = await imports();
  const fakePool = {
    async query() {
      return {
        rows: [{
          current_user: 'postgres',
          expected_member: true,
          forbidden_member: false,
          schema_usage: true,
          schema_create: false,
          payment_select: false,
          payment_insert: false,
          payment_update: false,
          payment_delete: false,
        }],
      };
    },
  };

  await assert.rejects(() => db.verifyRuntimeBoundary(fakePool, 'api'), {
    name: 'RuntimeBoundaryError',
    message: 'Runtime database readiness check failed',
  });
});
