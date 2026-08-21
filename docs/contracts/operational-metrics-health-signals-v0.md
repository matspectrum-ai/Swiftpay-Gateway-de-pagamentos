# A13 — Operational Metrics & Health Signals V0 Contract

Status: **FROZEN**  
Spec: `docs/specs/operational-metrics-health-signals-v0.yaml`

## 1. Package boundary

A13 introduces a new dependency-light workspace package `@swiftpay/metrics` under `packages/metrics`.

A13 MUST NOT add network/exporter behavior to `@swiftpay/observability`. The A12 logger remains a separate closed-schema JSONL boundary.

`@swiftpay/metrics` may use Node standard-library HTTP primitives only for the loopback scrape listener. It may not import database clients, provider adapters, authentication services, payment/domain stores or external observability SDKs.

## 2. Public types

```ts
export type MetricsWorkload = 'api' | 'worker';
export type MetricsHttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
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
```

No string extension point exists for labels.

## 3. Registry API

The package exports:

```ts
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

export function createOperationalMetricsRegistry(input: {
  readonly workload: MetricsWorkload;
}): OperationalMetricsRegistry;
```

### Validation

- Input objects are exact: unknown keys are rejected before mutation.
- `recordHttp` is valid only for the `api` workload.
- `recordWorkerBatch` is valid only for the `worker` workload.
- `statusCode` is an integer from 100 through 599 and maps internally to the frozen status class.
- `durationMs` is an integer from 0 through 86,400,000.
- Unknown route/method/outcome/batch values are rejected before mutation even when JavaScript callers bypass TypeScript.
- Invalid input throws one sanitized `RuntimeMetricsError` with stable code `invalid_metric_input`; the message contains no caller input.
- Valid recording returns `true`.

The registry exposes no generic `counter(name, labels)`, `observe(name, labels, value)`, custom label, custom metric, metadata or exemplar API.

## 4. Frozen metric families

### `swiftpay_http_requests_total`

- type: counter
- labels in exact order: `method`, `route`, `status_class`
- API only
- increment exactly once for each completed Fastify response

### `swiftpay_http_request_duration_ms`

- type: histogram
- labels in exact order: `method`, `route`
- API only
- buckets: `5,10,25,50,100,250,500,1000,2500,5000,+Inf`
- one observation exactly once for each completed Fastify response
- emitted `_bucket`, `_sum`, `_count` series use OpenMetrics conventions

### `swiftpay_readiness_checks_total`

- type: counter
- labels in exact order: `workload`, `outcome`
- API: exactly one increment per `/health/ready` attempt
- worker: exactly one increment per startup/check readiness attempt

### `swiftpay_worker_batches_total`

- type: counter
- labels in exact order: `batch`, `outcome`
- worker only
- one increment per `webhookDeliveries.runBatch` attempt
- resolved batch, including no-work, is `success`; thrown batch is `failure`

## 5. Deterministic render contract

`renderOpenMetrics()` returns UTF-8-compatible text that:

1. emits metric families in lexical metric-name order;
2. emits `# HELP` then `# TYPE` for every family;
3. emits series in lexical label-tuple order;
4. escapes label values according to OpenMetrics text rules;
5. emits histogram finite buckets ascending and `+Inf` last;
6. emits no timestamps and no exemplars;
7. terminates with exactly `# EOF\n`;
8. never exceeds 262,144 UTF-8 bytes for the frozen V0 schema; if internal corruption would exceed it, rendering fails with sanitized `metrics_render_failed` and returns no partial output.

Zero-valued unseen label combinations are not materialized. Only validated observed series appear.

## 6. Fastify instrumentation contract

`BuildAppOptions` gains an optional `metrics?: OperationalMetricsRegistry` dependency.

The existing A12 `onResponse` boundary records metrics after the HTTP result is selected:

```ts
metrics.recordHttp({
  method: request.method,
  route: request.routeOptions?.url ?? '<unmatched>',
  statusCode: reply.statusCode,
  durationMs,
});
```

The call is wrapped so a metrics exception cannot change the response, log event, status or body.

`/health/ready` records exactly one `ok` or `failed` readiness outcome. Liveness does not perform dependency checks and does not record readiness.

Concrete URL, query, request ID, merchant/payment/credential/endpoint identifiers and error messages never enter the metrics call.

## 7. Worker instrumentation contract

The worker receives one process-local worker registry.

- startup/check `services.readinessProbe()` success -> `recordReadiness('ok')` exactly once;
- readiness throw -> `recordReadiness('failed')` exactly once before existing failure behavior continues;
- every `webhookDeliveries.runBatch()` resolve -> one `merchant_webhook_delivery/success`;
- every throw -> one `merchant_webhook_delivery/failure` before existing safe log behavior;
- metrics recording exceptions are absorbed and introduce no retry or loop-control change.

## 8. Scrape listener contract

`@swiftpay/metrics` exports a loopback-only listener boundary. Production bootstrap may start one listener per workload only when the corresponding port is configured.

Configuration:

- `SWIFTPAY_API_METRICS_PORT`: optional integer 1..65535;
- `SWIFTPAY_WORKER_METRICS_PORT`: optional integer 1..65535;
- absent means no metrics listener for that workload;
- host is fixed to `127.0.0.1` in V0 and is not configurable.

HTTP behavior:

- only `GET /metrics` returns metrics;
- any other method or path returns sanitized 404;
- success status 200;
- success `Content-Type`: `application/openmetrics-text; version=1.0.0; charset=utf-8`;
- success `Cache-Control`: `no-store`;
- response size <= 262,144 bytes;
- render failure returns sanitized 500 with no partial metrics;
- forwarded headers do not influence authority or response;
- listener failure/absence never changes `/health/ready` or payment/domain behavior.

The listener has no merchant, dashboard or provider authentication semantics because it is loopback-only. Any future non-loopback exposure requires a new contract.

## 9. Security and authority invariants

Metrics labels/output MUST NOT include merchant/payment/credential/webhook endpoint/request/provider transaction IDs, external IDs, customer data, exact amounts, raw URLs/queries, headers, cookies, authorization values, API keys/secrets, DB URLs/SQL, exception messages/stacks or provider payloads.

A13 introduces:

- no database migration;
- no database query for telemetry;
- no provider adapter change;
- no A10 registry state change;
- no A5-to-A11 bridge;
- no live PSP call;
- no financial mutation;
- no readiness dependency on telemetry.

## 10. TDD acceptance

Tests must fail on the pre-A13 implementation because the new package/exports/instrumentation do not exist. RED must not be manufactured by changing an already-valid prior behavior assertion.

GREEN requires all A13 tests plus the full prior A1-A12 application suite, K5/K6, pgTAP and K7/A1-A9 real-database acceptance to pass.
