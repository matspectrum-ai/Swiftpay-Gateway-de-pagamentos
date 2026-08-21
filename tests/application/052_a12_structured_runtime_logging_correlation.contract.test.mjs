import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CALLER_REQUEST_ID = 'caller-controlled-request-id-must-not-win';

async function observabilityModule() {
  try {
    return await import('../../packages/observability/dist/index.js');
  } catch {
    return {};
  }
}

async function requireA12() {
  const module = await observabilityModule();
  assert.equal(typeof module.RuntimeObservabilityError, 'function');
  assert.equal(typeof module.createSafeRuntimeLogger, 'function');
  assert.equal(typeof module.serializeRuntimeEvent, 'function');
  return module;
}

function captureLogger() {
  const events = [];
  return {
    events,
    logger: {
      log(event) {
        events.push(structuredClone(event));
        return true;
      },
    },
  };
}

async function buildTokenApp(extra = {}) {
  const api = await import('../../apps/api/dist/app.js');
  return api.buildApp({
    readinessProbe: async () => {},
    tokenExchange: async () => ({
      ok: false,
      error: { code: 'validation_error', message: 'Invalid token request.' },
    }),
    ...extra,
  });
}

test('A12 observability package exports the frozen safe logging boundary', async () => {
  await requireA12();
  const rootTsconfig = await readFile(path.join(ROOT, 'tsconfig.json'), 'utf8');
  const apiPackage = await readFile(path.join(ROOT, 'apps/api/package.json'), 'utf8');
  const workerPackage = await readFile(path.join(ROOT, 'apps/worker/package.json'), 'utf8');
  assert.match(rootTsconfig, /packages\/observability/);
  assert.match(apiPackage, /@swiftpay\/observability/);
  assert.match(workerPackage, /@swiftpay\/observability/);
});

test('A12 serializer matches the frozen canonical HTTP completion JSON vector', async () => {
  const { serializeRuntimeEvent } = await requireA12();
  const serialized = serializeRuntimeEvent({
    level: 'info',
    event: 'http_request_completed',
    workload: 'api',
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    method: 'GET',
    route: '/v1/transactions/:id',
    statusCode: 200,
    durationMs: 17,
  }, {
    clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
  });
  assert.equal(
    serialized,
    '{"timestamp":"2026-08-17T12:00:00.000Z","level":"info","event":"http_request_completed","workload":"api","requestId":"123e4567-e89b-42d3-a456-426614174000","method":"GET","route":"/v1/transactions/:id","statusCode":200,"durationMs":17}',
  );
});

test('A12 logger rejects unknown fields and raw Error content before any sink write', async () => {
  const { createSafeRuntimeLogger, RuntimeObservabilityError } = await requireA12();
  const writes = [];
  const logger = createSafeRuntimeLogger({
    sink: {
      stdout: (line) => writes.push(line),
      stderr: (line) => writes.push(line),
    },
    clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
  });
  for (const event of [
    { level: 'info', event: 'safe_event', workload: 'api', secretKey: 'sk_secret_canary' },
    { level: 'error', event: 'safe_event', workload: 'worker', err: new Error('stack-secret-canary') },
    { level: 'error', event: 'safe_event', workload: 'worker', message: 'raw-error-secret-canary' },
  ]) {
    assert.throws(
      () => logger.log(event),
      (error) => error instanceof RuntimeObservabilityError && error.code === 'invalid_event',
    );
  }
  assert.deepEqual(writes, []);
});

test('A12 logger routes levels deterministically and absorbs one sink failure without retry', async () => {
  const { createSafeRuntimeLogger } = await requireA12();
  const stdout = [];
  const stderr = [];
  let failures = 0;
  const logger = createSafeRuntimeLogger({
    sink: {
      stdout(line) { stdout.push(line); },
      stderr(line) {
        failures += 1;
        throw new Error(`sink-failure-secret-${line}`);
      },
    },
    clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
  });
  assert.equal(logger.log({ level: 'warn', event: 'safe_warning', workload: 'worker' }), true);
  assert.equal(logger.log({ level: 'error', event: 'safe_failure', workload: 'worker' }), false);
  assert.equal(stdout.length, 1);
  assert.equal(stderr.length, 0);
  assert.equal(failures, 1);
});

test('A12 API ignores caller x-request-id and correlates response header with public error body', async () => {
  const app = await buildTokenApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: {
        'content-type': 'application/json',
        'x-request-id': CALLER_REQUEST_ID,
      },
      payload: { grantType: 'bad' },
    });
    const requestId = response.headers['x-request-id'];
    assert.equal(typeof requestId, 'string');
    assert.match(requestId, UUID_V4);
    assert.notEqual(requestId, CALLER_REQUEST_ID);
    assert.equal(response.json().error.requestId, requestId);
  } finally {
    await app.close();
  }
});

test('A12 API generates distinct UUIDv4 request IDs for distinct requests', async () => {
  const app = await buildTokenApp();
  try {
    const first = await app.inject({ method: 'GET', url: '/health/live', headers: { 'x-request-id': CALLER_REQUEST_ID } });
    const second = await app.inject({ method: 'GET', url: '/health/live', headers: { 'x-request-id': CALLER_REQUEST_ID } });
    const firstId = first.headers['x-request-id'];
    const secondId = second.headers['x-request-id'];
    assert.match(firstId, UUID_V4);
    assert.match(secondId, UUID_V4);
    assert.notEqual(firstId, secondId);
    assert.notEqual(firstId, CALLER_REQUEST_ID);
    assert.notEqual(secondId, CALLER_REQUEST_ID);
  } finally {
    await app.close();
  }
});

test('A12 Fastify source disables caller request-id authority and automatic request logging', async () => {
  const source = await readFile(path.join(ROOT, 'apps/api/src/app-base.ts'), 'utf8');
  assert.doesNotMatch(source, /requestIdHeader:\s*['"]x-request-id['"]/);
  assert.match(source, /genReqId/);
  assert.match(source, /randomUUID/);
  assert.match(source, /disableRequestLogging|logController/);
  assert.match(source, /http_request_completed/);
});

test('A12 API emits exactly one safe completion event using the matched route template only', async () => {
  const captured = captureLogger();
  let now = 100;
  const app = await buildTokenApp({
    runtimeLogger: captured.logger,
    monotonicNow: () => {
      const current = now;
      now = 117;
      return current;
    },
  });
  const secretQuery = 'query-secret-canary';
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/auth/token?unsafe=${secretQuery}`,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer authorization-secret-canary',
        'x-request-id': CALLER_REQUEST_ID,
      },
      payload: {
        grantType: 'bad',
        secretKey: 'body-secret-canary',
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(captured.events.length, 1);
    assert.deepEqual(captured.events[0], {
      level: 'info',
      event: 'http_request_completed',
      workload: 'api',
      requestId: response.headers['x-request-id'],
      method: 'POST',
      route: '/v1/auth/token',
      statusCode: 400,
      durationMs: 17,
    });
    const encoded = JSON.stringify(captured.events);
    assert.doesNotMatch(encoded, new RegExp(secretQuery));
    assert.doesNotMatch(encoded, /authorization-secret-canary|body-secret-canary|caller-controlled-request-id/);
  } finally {
    await app.close();
  }
});

test('A12 unmatched API route logs the fixed sentinel and never the concrete URL', async () => {
  const captured = captureLogger();
  const app = await buildTokenApp({
    runtimeLogger: captured.logger,
    monotonicNow: () => 200,
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/missing/private-value?token=secret-query-value' });
    assert.equal(response.statusCode, 404);
    assert.equal(captured.events.length, 1);
    assert.equal(captured.events[0].route, '<unmatched>');
    const encoded = JSON.stringify(captured.events[0]);
    assert.doesNotMatch(encoded, /private-value|secret-query-value/);
  } finally {
    await app.close();
  }
});

test('A12 worker uses the shared safe logger and never forwards caught exception content', async () => {
  const source = await readFile(path.join(ROOT, 'apps/worker/src/index.ts'), 'utf8');
  assert.match(source, /@swiftpay\/observability/);
  assert.match(source, /createSafeRuntimeLogger/);
  assert.doesNotMatch(source, /function\s+log\s*\(/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{\s*level,\s*event,\s*workload/);
  assert.doesNotMatch(source, /catch\s*\(\s*(?:error|err|cause)\s*\)[\s\S]{0,200}(?:logger|\.log)\s*\([^)]*(?:error|err|cause)/);
});

test('A12 observability package is network/database free and cannot become a hidden exporter', async () => {
  await requireA12();
  const source = await readFile(path.join(ROOT, 'packages/observability/src/index.ts'), 'utf8');
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dns)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /@swiftpay\/db|postgres|supabase/i);
});
