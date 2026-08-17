# A12 — Structured Runtime Logging & Correlation — Application Contract V0

Status: **FROZEN**  
Date: 2026-08-17  
Spec: `docs/specs/structured-runtime-logging-correlation-v0.yaml`

## 1. Boundary

A12 introduces a shared package `@swiftpay/observability` and integrates it into the Fastify API and worker. It does not add a database boundary, public endpoint, exporter, metric registry, trace SDK or provider-live capability.

Required package exports:

```ts
export class RuntimeObservabilityError extends Error {
  readonly code: 'invalid_event';
}

export function serializeRuntimeEvent(
  input: RuntimeEvent,
  options: { clock: RuntimeClock },
): string;

export function createSafeRuntimeLogger(input: {
  sink: RuntimeLogSink;
  clock?: RuntimeClock;
}): SafeRuntimeLogger;
```

No export may accept an arbitrary metadata bag that is copied to output.

## 2. Runtime clock and sink

```ts
export interface RuntimeClock {
  now(): Date;
}

export interface RuntimeLogSink {
  stdout(line: string): void;
  stderr(line: string): void;
}
```

Production clock uses current UTC time. Tests may inject a deterministic clock.

`info` and `warn` events write to stdout. `error` events write to stderr.

A sink write exception is absorbed and the logger call returns `false`; it must never change a domain/financial outcome. Event validation occurs before sink invocation and throws `RuntimeObservabilityError('invalid_event')` on invalid input.

## 3. Public event types

The V0 public API is a closed union, not `Record<string, unknown>`.

### Runtime event

```ts
interface RuntimeEventBase {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: string;
  readonly workload: 'api' | 'worker';
  readonly requestId?: string;
  readonly errorCode?: string;
}
```

Rules:

- `event` and `errorCode`, when present, match `^[a-z][a-z0-9_]{0,79}$`;
- `requestId`, when present, is lowercase canonical UUIDv4;
- unknown fields are rejected;
- Error instances, stack/message fields and nested objects are rejected because they are not part of the closed schema.

### HTTP completion event

```ts
interface HttpRequestCompletedEvent {
  readonly level: 'info';
  readonly event: 'http_request_completed';
  readonly workload: 'api';
  readonly requestId: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}
```

Rules:

- `route` is the matched Fastify route template only, max 256 UTF-8 bytes;
- unmatched routes use literal `<unmatched>`;
- concrete URL/query values are invalid as A12 route metadata;
- status 100..599;
- duration integer 0..86400000;
- no extra fields.

## 4. Exact JSON serialization

The serializer returns exactly one JSON object string with no trailing newline. The sink adapter adds one newline per event.

Canonical field order:

1. `timestamp`
2. `level`
3. `event`
4. `workload`
5. `requestId`
6. `method`
7. `route`
8. `statusCode`
9. `durationMs`
10. `errorCode`

Absent optional fields are omitted.

Timestamp is `clock.now().toISOString()` and therefore canonical UTC with milliseconds. Invalid Date fails with `invalid_event` before sink write.

Example frozen vector:

```json
{"timestamp":"2026-08-17T12:00:00.000Z","level":"info","event":"http_request_completed","workload":"api","requestId":"123e4567-e89b-42d3-a456-426614174000","method":"GET","route":"/v1/transactions/:id","statusCode":200,"durationMs":17}
```

## 5. Safe logger

```ts
export interface SafeRuntimeLogger {
  log(event: RuntimeEvent): boolean;
}
```

`log()`:

1. validates and serializes the closed event;
2. chooses stdout for `info|warn`, stderr for `error`;
3. writes `${serialized}\n` exactly once;
4. returns `true` on successful sink write;
5. returns `false` if the sink throws;
6. never retries a failed write.

No logger behavior may mutate a request, DB state, provider attempt, job, ledger, webhook or payment.

## 6. API integration contract

`buildApp` must use SwiftPay-owned request IDs.

Fastify factory behavior:

- caller request-id authority disabled (`requestIdHeader` false/absent-equivalent);
- `genReqId` returns `crypto.randomUUID()` UUIDv4;
- Fastify automatic per-request logs disabled using the supported Fastify v5 mechanism;
- generic logging must not serialize `req`, `res`, `err`, raw URL/query, headers or bodies.

API lifecycle:

### onRequest

- record monotonic start time for duration only;
- set response `x-request-id` to generated `request.id`;
- emit no generic request-start log.

### onResponse

Emit exactly one safe event:

```ts
{
  level: 'info',
  event: 'http_request_completed',
  workload: 'api',
  requestId: request.id,
  method: request.method,
  route: request.routeOptions.url ?? '<unmatched>',
  statusCode: reply.statusCode,
  durationMs: <bounded integer>
}
```

The hook must not alter the already-selected HTTP response if logging validation/write fails. A logger failure is observability degradation, not business failure.

Existing feature logs may keep their stable event names, but must not attach caught Error objects, request bodies, headers, query values or secret-bearing dynamic values.

## 7. Request-ID authority contract

An incoming `x-request-id` value is untrusted input and must not become canonical request identity.

For every request:

- generated request ID is canonical lowercase UUIDv4;
- response `x-request-id` equals generated ID;
- existing public error `requestId`, when present, equals generated ID;
- a supplied caller value is not echoed as canonical correlation and must not appear in A12 access logs;
- separate requests receive distinct IDs.

The same response header name remains for compatibility; only authority changes.

## 8. Worker integration contract

Worker uses `createSafeRuntimeLogger` instead of its local `JSON.stringify({level,event,workload})` helper.

The following event names remain stable:

- `worker_readiness_ok`
- `merchant_webhook_delivery_loop_started`
- `merchant_webhook_delivery_batch_failed`
- `worker_shutdown_sigterm`
- `worker_shutdown_sigint`
- `worker_runtime_boundary_failed`

Caught exceptions are not passed to the logger. Existing behavior that suppresses underlying exception text is preserved.

No external correlation header/request ID becomes worker authority in A12.

## 9. Forbidden log material

The A12 generic logging path may not contain any value derived from:

- request/response bodies;
- raw/concrete URL or query values;
- request/response headers;
- cookie/authorization values;
- caller-supplied `x-request-id`;
- customer/PII snapshots;
- API credential plaintext/verifier material;
- webhook secret/ciphertext/wrapping private keys;
- provider credentials/request/response bodies;
- DB URL/connection string/SQL text;
- arbitrary Error message/stack.

This is enforced primarily by the positive closed event schema, not by a secret-key denylist.

## 10. Compatibility / no-side-effect contract

A12 must preserve all K7/A1-A11 functional behavior except the intentional removal of caller request-ID authority.

A12 adds:

- no migration;
- no DB function/grant;
- no Supabase hosted state;
- no public/admin route;
- no provider network authority;
- no financial mutation.

The existing `x-request-id` header and public `requestId` error field remain available.

## 11. Test-first gate

Before implementation, application RED must prove at minimum:

1. package/export absence is the only new capability gap;
2. exact deterministic serialization vector;
3. invalid/unknown/raw-error input fails before sink;
4. sink failure is absorbed without retry;
5. caller `x-request-id` is ignored;
6. generated IDs are UUIDv4/unique;
7. response header/public error correlation equality;
8. automatic Fastify request logging is disabled;
9. completion event uses route template and never concrete URL/query/body/header canaries;
10. worker uses shared logger and never logs caught exception text;
11. all previous application contracts remain GREEN;
12. DB/K5/K6/runtime regression suites remain GREEN.

Only CLEAN RED authorizes A12 implementation.
