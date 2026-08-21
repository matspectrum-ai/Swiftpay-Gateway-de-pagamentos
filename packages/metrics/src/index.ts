import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_RENDER_BYTES = 262_144;
const HISTOGRAM_BUCKETS = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const ROUTES = new Set([
  '/health/live',
  '/health/ready',
  '/v1/auth/token',
  '/v1/transactions',
  '/v1/transactions/:id',
  '/v1/balance',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints/:endpointId',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints/:endpointId/disable',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints/:endpointId/enable',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints/:endpointId/rotate-secret',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials/:credentialId',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials/:credentialId/rotate-secret',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials/:credentialId/revoke',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/transactions',
  '/dashboard/v1/merchants/:merchantId/environments/:environment/transactions/:transactionId',
  '<unmatched>',
]);
const READINESS_OUTCOMES = new Set(['ok', 'failed']);
const BATCHES = new Set(['merchant_webhook_delivery']);
const BATCH_OUTCOMES = new Set(['success', 'failure']);

export type MetricsWorkload = 'api' | 'worker';
export type MetricsHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type MetricsStatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
export type ReadinessOutcome = 'ok' | 'failed';
export type WorkerBatch = 'merchant_webhook_delivery';
export type WorkerBatchOutcome = 'success' | 'failure';
export type MetricsRoute =
  | '/health/live'
  | '/health/ready'
  | '/v1/auth/token'
  | '/v1/transactions'
  | '/v1/transactions/:id'
  | '/v1/balance'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints/:endpointId'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints/:endpointId/disable'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints/:endpointId/enable'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints/:endpointId/rotate-secret'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials/:credentialId'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials/:credentialId/rotate-secret'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials/:credentialId/revoke'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/transactions'
  | '/dashboard/v1/merchants/:merchantId/environments/:environment/transactions/:transactionId'
  | '<unmatched>';

export type RuntimeMetricsErrorCode = 'invalid_metric_input' | 'metrics_render_failed';

export class RuntimeMetricsError extends Error {
  readonly code: RuntimeMetricsErrorCode;

  constructor(code: RuntimeMetricsErrorCode = 'invalid_metric_input') {
    super(code === 'invalid_metric_input' ? 'Invalid operational metric input.' : 'Operational metrics render failed.');
    this.name = 'RuntimeMetricsError';
    this.code = code;
  }
}

export interface OperationalMetricsRegistry {
  recordHttp(input: {
    readonly method: MetricsHttpMethod;
    readonly route: MetricsRoute;
    readonly statusCode: number;
    readonly durationMs: number;
  }): boolean;
  recordReadiness(outcome: ReadinessOutcome): boolean;
  recordWorkerBatch(input: {
    readonly batch: WorkerBatch;
    readonly outcome: WorkerBatchOutcome;
  }): boolean;
  renderOpenMetrics(): string;
}

interface HttpCounterSeries {
  readonly method: MetricsHttpMethod;
  readonly route: MetricsRoute;
  readonly statusClass: MetricsStatusClass;
  count: number;
}

interface HttpHistogramSeries {
  readonly method: MetricsHttpMethod;
  readonly route: MetricsRoute;
  count: number;
  sum: number;
  readonly bucketCounts: number[];
}

function invalidInput(): never {
  throw new RuntimeMetricsError('invalid_metric_input');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactFields(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value)) invalidInput();
  const allowed = new Set(fields);
  const keys = Object.keys(value);
  if (keys.length !== fields.length) invalidInput();
  for (const key of keys) if (!allowed.has(key)) invalidInput();
  for (const field of fields) if (!(field in value)) invalidInput();
}

function statusClass(statusCode: number): MetricsStatusClass {
  if (!Number.isSafeInteger(statusCode) || statusCode < 100 || statusCode > 599) invalidInput();
  if (statusCode < 200) return '1xx';
  if (statusCode < 300) return '2xx';
  if (statusCode < 400) return '3xx';
  if (statusCode < 500) return '4xx';
  return '5xx';
}

function metricMethod(value: unknown): MetricsHttpMethod {
  if (typeof value !== 'string' || !METHODS.has(value)) invalidInput();
  return value as MetricsHttpMethod;
}

function metricRoute(value: unknown): MetricsRoute {
  if (typeof value !== 'string' || !ROUTES.has(value)) invalidInput();
  return value as MetricsRoute;
}

function duration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 86_400_000) invalidInput();
  return value as number;
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function labels(values: readonly [string, string][]): string {
  return `{${values.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

function seriesKey(values: readonly string[]): string {
  return values.join('\u0000');
}

function safeIncrement(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) invalidInput();
  return value + 1;
}

export function createOperationalMetricsRegistry(input: {
  readonly workload: MetricsWorkload;
}): OperationalMetricsRegistry {
  assertExactFields(input, ['workload']);
  if (input.workload !== 'api' && input.workload !== 'worker') invalidInput();
  const workload = input.workload;

  const httpCounters = new Map<string, HttpCounterSeries>();
  const httpHistograms = new Map<string, HttpHistogramSeries>();
  const readiness = new Map<ReadinessOutcome, number>();
  const batches = new Map<WorkerBatchOutcome, number>();

  const registry: OperationalMetricsRegistry = {
    recordHttp(raw): boolean {
      if (workload !== 'api') invalidInput();
      assertExactFields(raw, ['method', 'route', 'statusCode', 'durationMs']);
      const method = metricMethod(raw.method);
      const route = metricRoute(raw.route);
      const mappedClass = statusClass(raw.statusCode as number);
      const durationMs = duration(raw.durationMs);

      const counterKey = seriesKey([method, route, mappedClass]);
      const existingCounter = httpCounters.get(counterKey);
      if (existingCounter === undefined) {
        httpCounters.set(counterKey, { method, route, statusClass: mappedClass, count: 1 });
      } else {
        existingCounter.count = safeIncrement(existingCounter.count);
      }

      const histogramKey = seriesKey([method, route]);
      let histogram = httpHistograms.get(histogramKey);
      if (histogram === undefined) {
        histogram = {
          method,
          route,
          count: 0,
          sum: 0,
          bucketCounts: HISTOGRAM_BUCKETS.map(() => 0),
        };
        httpHistograms.set(histogramKey, histogram);
      }
      histogram.count = safeIncrement(histogram.count);
      const nextSum = histogram.sum + durationMs;
      if (!Number.isSafeInteger(nextSum) || nextSum < 0) invalidInput();
      histogram.sum = nextSum;
      for (let index = 0; index < HISTOGRAM_BUCKETS.length; index += 1) {
        const boundary = HISTOGRAM_BUCKETS[index];
        if (boundary !== undefined && durationMs <= boundary) {
          const current = histogram.bucketCounts[index];
          if (current === undefined) invalidInput();
          histogram.bucketCounts[index] = safeIncrement(current);
        }
      }
      return true;
    },

    recordReadiness(outcome): boolean {
      if (typeof outcome !== 'string' || !READINESS_OUTCOMES.has(outcome)) invalidInput();
      const bounded = outcome as ReadinessOutcome;
      readiness.set(bounded, safeIncrement(readiness.get(bounded) ?? 0));
      return true;
    },

    recordWorkerBatch(raw): boolean {
      if (workload !== 'worker') invalidInput();
      assertExactFields(raw, ['batch', 'outcome']);
      if (typeof raw.batch !== 'string' || !BATCHES.has(raw.batch)) invalidInput();
      if (typeof raw.outcome !== 'string' || !BATCH_OUTCOMES.has(raw.outcome)) invalidInput();
      const outcome = raw.outcome as WorkerBatchOutcome;
      batches.set(outcome, safeIncrement(batches.get(outcome) ?? 0));
      return true;
    },

    renderOpenMetrics(): string {
      try {
        const lines: string[] = [];

        lines.push('# HELP swiftpay_http_request_duration_ms SwiftPay completed HTTP request duration in milliseconds.');
        lines.push('# TYPE swiftpay_http_request_duration_ms histogram');
        for (const item of [...httpHistograms.values()].sort((a, b) => seriesKey([a.method, a.route]).localeCompare(seriesKey([b.method, b.route])))) {
          for (let index = 0; index < HISTOGRAM_BUCKETS.length; index += 1) {
            const boundary = HISTOGRAM_BUCKETS[index];
            const count = item.bucketCounts[index];
            if (boundary === undefined || count === undefined) throw new RuntimeMetricsError('metrics_render_failed');
            lines.push(`swiftpay_http_request_duration_ms_bucket${labels([['method', item.method], ['route', item.route], ['le', String(boundary)]])} ${count}`);
          }
          lines.push(`swiftpay_http_request_duration_ms_bucket${labels([['method', item.method], ['route', item.route], ['le', '+Inf']])} ${item.count}`);
          lines.push(`swiftpay_http_request_duration_ms_sum${labels([['method', item.method], ['route', item.route]])} ${item.sum}`);
          lines.push(`swiftpay_http_request_duration_ms_count${labels([['method', item.method], ['route', item.route]])} ${item.count}`);
        }

        lines.push('# HELP swiftpay_http_requests_total SwiftPay completed HTTP requests.');
        lines.push('# TYPE swiftpay_http_requests_total counter');
        for (const item of [...httpCounters.values()].sort((a, b) => seriesKey([a.method, a.route, a.statusClass]).localeCompare(seriesKey([b.method, b.route, b.statusClass])))) {
          lines.push(`swiftpay_http_requests_total${labels([['method', item.method], ['route', item.route], ['status_class', item.statusClass]])} ${item.count}`);
        }

        lines.push('# HELP swiftpay_readiness_checks_total SwiftPay readiness checks.');
        lines.push('# TYPE swiftpay_readiness_checks_total counter');
        for (const outcome of [...readiness.keys()].sort()) {
          lines.push(`swiftpay_readiness_checks_total${labels([['workload', workload], ['outcome', outcome]])} ${readiness.get(outcome) ?? 0}`);
        }

        lines.push('# HELP swiftpay_worker_batches_total SwiftPay worker batch attempts.');
        lines.push('# TYPE swiftpay_worker_batches_total counter');
        for (const outcome of [...batches.keys()].sort()) {
          lines.push(`swiftpay_worker_batches_total${labels([['batch', 'merchant_webhook_delivery'], ['outcome', outcome]])} ${batches.get(outcome) ?? 0}`);
        }

        const output = `${lines.join('\n')}\n# EOF\n`;
        if (Buffer.byteLength(output, 'utf8') > MAX_RENDER_BYTES) {
          throw new RuntimeMetricsError('metrics_render_failed');
        }
        return output;
      } catch (error) {
        if (error instanceof RuntimeMetricsError && error.code === 'metrics_render_failed') throw error;
        throw new RuntimeMetricsError('metrics_render_failed');
      }
    },
  };

  return Object.freeze(registry);
}

export function createMetricsRequestHandler(input: {
  readonly registry: OperationalMetricsRegistry;
}): (request: IncomingMessage, response: ServerResponse) => void {
  assertExactFields(input, ['registry']);
  if (input.registry === null || typeof input.registry !== 'object' || typeof input.registry.renderOpenMetrics !== 'function') {
    invalidInput();
  }

  return (request, response) => {
    response.setHeader('cache-control', 'no-store');
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.statusCode = 404;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('not_found\n');
      return;
    }

    try {
      const body = input.registry.renderOpenMetrics();
      if (Buffer.byteLength(body, 'utf8') > MAX_RENDER_BYTES) throw new RuntimeMetricsError('metrics_render_failed');
      response.statusCode = 200;
      response.setHeader('content-type', 'application/openmetrics-text; version=1.0.0; charset=utf-8');
      response.end(body);
    } catch {
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('metrics_unavailable\n');
    }
  };
}
