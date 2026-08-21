import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function metricsModule() {
  try {
    return await import('../../packages/metrics/dist/index.js');
  } catch {
    return {};
  }
}

async function requireA13() {
  const module = await metricsModule();
  assert.equal(typeof module.RuntimeMetricsError, 'function');
  assert.equal(typeof module.createOperationalMetricsRegistry, 'function');
  return module;
}

function captureMetrics({ throwHttp = false, throwReadiness = false } = {}) {
  const http = [];
  const readiness = [];
  const batches = [];
  return {
    http,
    readiness,
    batches,
    registry: {
      recordHttp(input) {
        http.push(structuredClone(input));
        if (throwHttp) throw new Error('metrics-http-secret-canary');
        return true;
      },
      recordReadiness(outcome) {
        readiness.push(outcome);
        if (throwReadiness) throw new Error('metrics-readiness-secret-canary');
        return true;
      },
      recordWorkerBatch(input) {
        batches.push(structuredClone(input));
        return true;
      },
      renderOpenMetrics() {
        return '# EOF\n';
      },
    },
  };
}

async function buildApp(extra = {}) {
  const api = await import('../../apps/api/dist/app.js');
  return api.buildApp({
    readinessProbe: async () => {},
    ...extra,
  });
}

test('A13 metrics package exists, is in the workspace graph and is consumed by API/worker', async () => {
  await requireA13();
  const [rootTsconfig, apiPackage, workerPackage, metricsPackage] = await Promise.all([
    readFile(path.join(ROOT, 'tsconfig.json'), 'utf8'),
    readFile(path.join(ROOT, 'apps/api/package.json'), 'utf8'),
    readFile(path.join(ROOT, 'apps/worker/package.json'), 'utf8'),
    readFile(path.join(ROOT, 'packages/metrics/package.json'), 'utf8'),
  ]);
  assert.match(rootTsconfig, /packages\/metrics/);
  assert.match(apiPackage, /@swiftpay\/metrics/);
  assert.match(workerPackage, /@swiftpay\/metrics/);
  assert.match(metricsPackage, /"name"\s*:\s*"@swiftpay\/metrics"/);
});

test('A13 registry accepts only frozen metric inputs and rejects unknown labels before mutation', async () => {
  const { createOperationalMetricsRegistry, RuntimeMetricsError } = await requireA13();
  const registry = createOperationalMetricsRegistry({ workload: 'api' });
  const before = registry.renderOpenMetrics();

  assert.throws(
    () => registry.recordHttp({
      method: 'GET',
      route: '/health/live',
      statusCode: 200,
      durationMs: 4,
      merchantId: 'merchant-secret-canary',
    }),
    (error) => error instanceof RuntimeMetricsError
      && error.code === 'invalid_metric_input'
      && !String(error.message).includes('merchant-secret-canary'),
  );

  assert.throws(
    () => registry.recordHttp({
      method: 'GET',
      route: '/v1/transactions/payment-secret-canary',
      statusCode: 200,
      durationMs: 4,
    }),
    (error) => error instanceof RuntimeMetricsError && error.code === 'invalid_metric_input',
  );

  assert.equal(registry.renderOpenMetrics(), before);
});

test('A13 API registry renders frozen HTTP counter and histogram families deterministically', async () => {
  const { createOperationalMetricsRegistry } = await requireA13();
  const registry = createOperationalMetricsRegistry({ workload: 'api' });

  assert.equal(registry.recordHttp({
    method: 'GET',
    route: '/health/live',
    statusCode: 200,
    durationMs: 17,
  }), true);
  assert.equal(registry.recordHttp({
    method: 'GET',
    route: '/health/live',
    statusCode: 503,
    durationMs: 250,
  }), true);

  const output = registry.renderOpenMetrics();
  assert.match(output, /# HELP swiftpay_http_request_duration_ms /);
  assert.match(output, /# TYPE swiftpay_http_request_duration_ms histogram/);
  assert.match(output, /swiftpay_http_request_duration_ms_bucket\{method="GET",route="\/health\/live",le="5"\} 0/);
  assert.match(output, /swiftpay_http_request_duration_ms_bucket\{method="GET",route="\/health\/live",le="25"\} 1/);
  assert.match(output, /swiftpay_http_request_duration_ms_bucket\{method="GET",route="\/health\/live",le="250"\} 2/);
  assert.match(output, /swiftpay_http_request_duration_ms_bucket\{method="GET",route="\/health\/live",le="\+Inf"\} 2/);
  assert.match(output, /swiftpay_http_request_duration_ms_sum\{method="GET",route="\/health\/live"\} 267/);
  assert.match(output, /swiftpay_http_request_duration_ms_count\{method="GET",route="\/health\/live"\} 2/);
  assert.match(output, /# TYPE swiftpay_http_requests_total counter/);
  assert.match(output, /swiftpay_http_requests_total\{method="GET",route="\/health\/live",status_class="2xx"\} 1/);
  assert.match(output, /swiftpay_http_requests_total\{method="GET",route="\/health\/live",status_class="5xx"\} 1/);
  assert.ok(output.indexOf('# TYPE swiftpay_http_request_duration_ms histogram') < output.indexOf('# TYPE swiftpay_http_requests_total counter'));
  assert.ok(output.endsWith('# EOF\n'));
  assert.ok(Buffer.byteLength(output, 'utf8') <= 262144);
});

test('A13 API instrumentation records matched route template and never concrete URL/query/request identifiers', async () => {
  const captured = captureMetrics();
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const transactionId = '22222222-2222-4222-8222-222222222222';
  const queryCanary = 'query-secret-canary';
  const app = await buildApp({
    metrics: captured.registry,
    dashboardTransactions: {
      get: async () => ({ kind: 'ok', transaction: { id: transactionId } }),
    },
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/dashboard/v1/merchants/${merchantId}/environments/sandbox/transactions/${transactionId}?unsafe=${queryCanary}`,
      headers: { authorization: 'Bearer dashboard-secret-canary' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(captured.http.length, 1);
    assert.equal(captured.http[0].route, '/dashboard/v1/merchants/:merchantId/environments/:environment/transactions/:transactionId');
    assert.equal(captured.http[0].method, 'GET');
    assert.equal(captured.http[0].statusCode, 200);
    const encoded = JSON.stringify(captured.http);
    for (const forbidden of [merchantId, transactionId, queryCanary, 'dashboard-secret-canary']) {
      assert.doesNotMatch(encoded, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  } finally {
    await app.close();
  }
});

test('A13 HTTP metrics failure is attempted exactly once and cannot change the selected response', async () => {
  const captured = captureMetrics({ throwHttp: true });
  const app = await buildApp({ metrics: captured.registry });
  try {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'live' });
    assert.equal(captured.http.length, 1);
  } finally {
    await app.close();
  }
});

test('A13 API readiness records exactly one bounded outcome without making telemetry a readiness dependency', async () => {
  const success = captureMetrics();
  const successApp = await buildApp({ metrics: success.registry, readinessProbe: async () => {} });
  try {
    const response = await successApp.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(success.readiness, ['ok']);
  } finally {
    await successApp.close();
  }

  const failure = captureMetrics({ throwReadiness: true });
  const failureApp = await buildApp({
    metrics: failure.registry,
    readinessProbe: async () => { throw new Error('database-secret-canary'); },
  });
  try {
    const response = await failureApp.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(failure.readiness, ['failed']);
  } finally {
    await failureApp.close();
  }
});

test('A13 readiness and worker-batch metric families use only frozen low-cardinality labels', async () => {
  const { createOperationalMetricsRegistry, RuntimeMetricsError } = await requireA13();
  const api = createOperationalMetricsRegistry({ workload: 'api' });
  api.recordReadiness('ok');
  api.recordReadiness('failed');
  assert.throws(() => api.recordReadiness('merchant-123'), RuntimeMetricsError);
  const apiOutput = api.renderOpenMetrics();
  assert.match(apiOutput, /swiftpay_readiness_checks_total\{workload="api",outcome="ok"\} 1/);
  assert.match(apiOutput, /swiftpay_readiness_checks_total\{workload="api",outcome="failed"\} 1/);

  const worker = createOperationalMetricsRegistry({ workload: 'worker' });
  worker.recordWorkerBatch({ batch: 'merchant_webhook_delivery', outcome: 'success' });
  worker.recordWorkerBatch({ batch: 'merchant_webhook_delivery', outcome: 'failure' });
  assert.throws(
    () => worker.recordWorkerBatch({ batch: 'merchant_webhook_delivery-merchant-123', outcome: 'success' }),
    RuntimeMetricsError,
  );
  const workerOutput = worker.renderOpenMetrics();
  assert.match(workerOutput, /swiftpay_worker_batches_total\{batch="merchant_webhook_delivery",outcome="failure"\} 1/);
  assert.match(workerOutput, /swiftpay_worker_batches_total\{batch="merchant_webhook_delivery",outcome="success"\} 1/);
});

test('A13 worker source records readiness and each webhook batch outcome while absorbing metric failures', async () => {
  const source = await readFile(path.join(ROOT, 'apps/worker/src/index.ts'), 'utf8');
  assert.match(source, /@swiftpay\/metrics/);
  assert.match(source, /createOperationalMetricsRegistry/);
  assert.match(source, /recordReadiness\(['"]ok['"]\)/);
  assert.match(source, /recordReadiness\(['"]failed['"]\)/);
  assert.match(source, /recordWorkerBatch/);
  assert.match(source, /merchant_webhook_delivery/);
  assert.match(source, /outcome:\s*['"]success['"]/);
  assert.match(source, /outcome:\s*['"]failure['"]/);
});

test('A13 metrics ports are optional workload-specific validated configuration with no public-host option', async () => {
  const source = await readFile(path.join(ROOT, 'packages/config/src/core.ts'), 'utf8');
  assert.match(source, /SWIFTPAY_API_METRICS_PORT/);
  assert.match(source, /SWIFTPAY_WORKER_METRICS_PORT/);
  assert.match(source, /metricsPort\?:\s*number/);
  assert.doesNotMatch(source, /SWIFTPAY_(API_|WORKER_)?METRICS_HOST/);
  assert.match(source, /integer between 1 and 65535/);
});

test('A13 scrape implementation is loopback-only, bounded, OpenMetrics and opt-in per workload', async () => {
  const [metricsSource, apiIndex, workerIndex] = await Promise.all([
    readFile(path.join(ROOT, 'packages/metrics/src/index.ts'), 'utf8'),
    readFile(path.join(ROOT, 'apps/api/src/index.ts'), 'utf8'),
    readFile(path.join(ROOT, 'apps/worker/src/index.ts'), 'utf8'),
  ]);
  assert.match(metricsSource, /\/metrics/);
  assert.match(metricsSource, /application\/openmetrics-text; version=1\.0\.0; charset=utf-8/);
  assert.match(metricsSource, /no-store/);
  assert.match(metricsSource, /262144|262_144/);
  assert.match(apiIndex, /127\.0\.0\.1/);
  assert.match(workerIndex, /127\.0\.0\.1/);
  assert.match(apiIndex, /metricsPort/);
  assert.match(workerIndex, /metricsPort/);
  assert.doesNotMatch(apiIndex, /0\.0\.0\.0[^\n]*metrics/i);
  assert.doesNotMatch(workerIndex, /0\.0\.0\.0[^\n]*metrics/i);
});

test('A13 metric output cannot contain dynamic identifier, amount, secret, URL, SQL, error or provider canaries', async () => {
  const { createOperationalMetricsRegistry } = await requireA13();
  const registry = createOperationalMetricsRegistry({ workload: 'api' });
  const canaries = [
    'merchant-secret-canary',
    'payment-secret-canary',
    'request-secret-canary',
    '123456789-cent-canary',
    'https://secret.example/?token=secret-canary',
    'select-secret-canary-from-payments',
    'stack-secret-canary',
    'provider-payload-secret-canary',
  ];
  for (const canary of canaries) {
    assert.throws(() => registry.recordHttp({
      method: 'GET',
      route: `/v1/transactions/${canary}`,
      statusCode: 500,
      durationMs: 1,
    }));
  }
  registry.recordHttp({ method: 'GET', route: '/v1/transactions/:id', statusCode: 500, durationMs: 1 });
  const output = registry.renderOpenMetrics();
  for (const canary of canaries) assert.doesNotMatch(output, new RegExp(canary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('A13 preserves A12 logger purity and introduces no database/provider/financial authority in metrics package', async () => {
  const [observabilitySource, metricsSource] = await Promise.all([
    readFile(path.join(ROOT, 'packages/observability/src/index.ts'), 'utf8'),
    readFile(path.join(ROOT, 'packages/metrics/src/index.ts'), 'utf8'),
  ]);
  assert.doesNotMatch(observabilitySource, /from ['"]node:http['"]|createServer\s*\(/);
  assert.doesNotMatch(metricsSource, /@swiftpay\/(db|providers|payments|ledger|auth)/);
  assert.doesNotMatch(metricsSource, /postgres|supabase|payment_attempt|provider_attempt|ledger/i);
});
