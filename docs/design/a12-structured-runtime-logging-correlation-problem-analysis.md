# A12 — Structured Runtime Logging & Correlation — Problem Analysis

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
Status: **FROZEN PROBLEM ANALYSIS — SPECIFICATION AUTHORIZED NEXT**

## 1. Problem statement

SwiftPay V2 now has an executable Pix sandbox path, hosted dashboard administration/read surfaces, explicit provider activation authority and a strict provider HTTPS primitive. The remaining production-hardening ledger still lists observability as pending.

The current runtime already emits logs, but the behavior is not yet a trustworthy financial-system observability contract:

- Fastify logging is enabled in the API and uses a denylist-style `redact` configuration;
- the API configures `requestIdHeader: 'x-request-id'`, so caller-supplied request IDs may become the canonical `request.id` and are echoed back in `x-request-id` and public errors;
- Fastify automatic request logging remains enabled, so concrete request URLs/query strings are eligible for logging even where only route templates should be operational telemetry;
- feature handlers intentionally log stable event names on failures, but there is no shared safe event-envelope contract;
- the worker uses a separate hand-written JSON logger containing only `level`, `event` and `workload`, with no shared serializer/correlation semantics;
- API and worker therefore do not share one testable rule for what may or may not enter runtime logs.

In a payment gateway, logging must be useful enough to correlate incidents while being hostile to accidental disclosure of credentials, authorization material, customer data, request bodies, query values, provider bodies, database details and arbitrary exception messages.

A12 addresses this foundation before adding metrics, traces, exporters or provider-live instrumentation.

## 2. Observed current behavior

### API

`apps/api/src/app.ts` currently:

- creates Fastify with logging enabled;
- configures redaction paths for authorization/cookie/secret-like fields;
- configures `requestIdHeader: 'x-request-id'`;
- echoes `request.id` through an `x-request-id` response header;
- includes `request.id` in stable public error payloads;
- emits stable feature event names such as `database_readiness_failed`, `token_exchange_failed`, `payment_authentication_failed` and related events;
- does not disable Fastify automatic request logging.

Consequences:

1. a caller can influence the canonical request ID;
2. request IDs are not guaranteed globally unique across instances;
3. concrete URLs/query values can become transport logs;
4. denylist redaction remains defense-in-depth rather than a positive safe logging contract.

### Worker

`apps/worker/src/index.ts` currently:

- writes JSON directly to stdout/stderr;
- emits only `level`, `event`, `workload`;
- catches runtime/webhook batch failures without logging the underlying exception, which is safe;
- has no shared API/worker correlation/event serializer.

This is privacy-safe in several important paths but operationally inconsistent.

## 3. Objective

Freeze one deterministic, vendor-neutral structured logging and correlation boundary for the API and worker that:

- generates SwiftPay-owned globally unique request IDs;
- never accepts caller correlation identity as authority;
- preserves the existing public `x-request-id`/error correlation surface using the SwiftPay-generated ID;
- prevents automatic request/body/header/query logging;
- emits only explicit safe structured fields;
- keeps arbitrary Error objects/messages/stacks and upstream bodies out of production log payloads;
- gives API and worker a common JSON event-envelope model;
- remains exporter/network/database independent.

## 4. Scope — A12 V0

### In scope

1. A small shared runtime-observability package or equivalent shared module with a strict structured-event serializer.
2. Canonical safe event envelope for `api` and `worker` workloads.
3. API request-ID generation owned by SwiftPay.
4. Ignoring caller-supplied `x-request-id` as canonical identity.
5. Returning the generated request ID through `x-request-id` and preserving existing public error `requestId` consistency.
6. Disabling Fastify automatic request start/completion logging that serializes concrete request objects/URLs.
7. Explicit API access-completion event using only normalized low-disclosure fields.
8. Shared worker structured logger using the same safe event serialization rules.
9. Deterministic unit/contract tests proving redaction/non-disclosure and correlation behavior.
10. Existing feature failure events may continue, but they must pass through the safe logging boundary or remain limited to already-safe static event metadata.

### Explicitly out of scope

- Prometheus/OpenMetrics endpoint;
- OpenTelemetry SDK/exporters;
- distributed trace propagation (`traceparent`, `baggage`);
- accepting an external request/correlation ID as trusted identity;
- log shipping/vendor SDKs;
- persistent log database/table;
- alerting/SLO dashboards;
- provider-specific live telemetry;
- merchant/customer identifiers in generic access logs;
- request/response body logging;
- headers/cookies/query-value logging;
- SQL text/connection details;
- raw exception message/stack logging;
- changing financial/domain behavior;
- any Supabase migration or privilege change.

Metrics/tracing/exporter work remains a later observability slice after this safe foundation exists.

## 5. Frozen correlation direction

### API request ID

The canonical API request ID MUST be generated by SwiftPay for every request using a cryptographically strong UUID generator (`crypto.randomUUID()` or an equivalent 128-bit UUIDv4 implementation).

A caller-supplied `x-request-id` MUST NOT become `request.id`, MUST NOT be echoed as authoritative correlation identity and MUST NOT influence generated identity.

The generated ID remains:

- `request.id` inside Fastify handlers;
- response header `x-request-id`;
- `requestId` in existing public error envelopes.

Two distinct requests in the same process must receive distinct IDs.

No user identity, merchant ID, Payment ID, credential ID or provider ID may be encoded into the request ID.

### Worker correlation

A12 does not invent distributed tracing. Worker events use SwiftPay-owned opaque runtime/event correlation when needed, but do not accept untrusted external correlation headers.

The worker must share the same safe serializer/envelope rules as the API. Existing process-level events may remain correlation-free when no specific operation identity exists.

## 6. Frozen logging philosophy

A12 changes the primary control from “log broadly and redact known secrets” to “log only explicitly approved metadata”.

Denylist redaction may remain as defense in depth, but it is not the authorization mechanism for log fields.

Generic runtime events MUST NOT serialize:

- request/response objects;
- concrete URL/query strings;
- any header collection;
- cookies;
- authorization values;
- request/response bodies;
- customer snapshot/PII;
- API credential material;
- webhook signing/encryption/wrapping material;
- provider credentials/bodies;
- database URL/SQL/error details;
- arbitrary error objects/messages/stacks.

Caught exceptions are classified by stable internal event/error codes outside the logger. The logger receives only safe classification metadata.

## 7. Safe event envelope

The exact schema will be frozen in the YAML spec, but V0 must remain a small positive schema containing only fields such as:

- timestamp;
- level;
- event;
- workload (`api | worker`);
- requestId when applicable;
- HTTP method when applicable;
- normalized Fastify route template when applicable;
- HTTP status code when applicable;
- bounded integer duration in milliseconds when applicable;
- stable safe outcome/error classification when explicitly frozen.

No arbitrary `Record<string, unknown>` bag is allowed as the public logging API in V0.

Unknown/unsafe fields must not silently pass through.

## 8. API access logging direction

Fastify automatic request logging must be disabled for the SwiftPay API.

A12 will emit an explicit completion event instead. It must use the matched route template (for example `/v1/transactions/:id`), never the concrete URL, query string or resource identifier.

For an unmatched route, use a fixed non-sensitive sentinel rather than the raw URL.

The completion event should be emitted after status is known and include only the frozen safe fields.

No request-start event is required in V0; one completion event per request minimizes noise and disclosure surface.

Health routes remain subject to the same safe access logging behavior.

## 9. Worker logging direction

Replace the worker-only ad hoc JSON formatter with the shared safe serializer/logger boundary while preserving stdout for info/warn and stderr for error semantics.

Existing worker events remain stable unless a later spec deliberately renames them:

- `worker_readiness_ok`;
- `merchant_webhook_delivery_loop_started`;
- `merchant_webhook_delivery_batch_failed`;
- `worker_shutdown_sigterm` / `worker_shutdown_sigint`;
- `worker_runtime_boundary_failed`.

A12 must not log the caught exception behind these failures.

## 10. Failure behavior

Logging must never become financial/domain authority.

If event input is invalid or contains unsupported fields, the safe serializer/logger must fail locally and deterministically; it must not serialize the unsafe object.

The exact runtime policy for logger write failures will be frozen in the spec. A12 must avoid turning a transient stdout/stderr write issue into a financial state transition or provider retry decision.

## 11. Compatibility constraints

A12 must preserve:

- all existing HTTP routes/status/body semantics;
- existing public error `requestId` presence;
- existing `x-request-id` response header presence, but with SwiftPay-owned identity;
- A1-A11 security boundaries;
- dashboard/machine realm separation;
- no provider-live authority;
- no database schema/role change;
- no Supabase hosted migration;
- no new public metrics/admin route.

Tests that previously supplied `x-request-id` and expected that exact value as canonical identity may need to be refined because caller-controlled request identity is the behavior A12 intentionally removes. Such changes must preserve the higher-level invariant that response/error correlation IDs match the server-generated request ID.

## 12. Key risks

### Risk: logs become less useful after removing raw URL/error text

Mitigation: route template, stable event taxonomy, generated request ID, status and duration provide operational correlation without leaking payloads. Feature-specific safe codes may be added only by contract.

### Risk: request ID behavior breaks tests/clients

Mitigation: keep the same header and error field; only authority changes from caller-controlled to server-generated opaque UUID.

### Risk: logger abstraction becomes an untyped arbitrary-object sink

Mitigation: positive event schema and fail-closed unknown-field handling.

### Risk: observability work expands into vendor infrastructure

Mitigation: A12 V0 is explicitly stdout/stderr + correlation only. Metrics/traces/exporters remain separate slices.

## 13. Acceptance direction for the next TDD phase

Fail-first tests should prove at minimum:

1. API ignores a supplied `x-request-id` and generates a valid UUID request ID;
2. response `x-request-id` matches public error `requestId` when an error body is returned;
3. separate requests receive separate IDs;
4. Fastify automatic request logging is disabled;
5. explicit API completion logs use route templates and do not contain concrete URL/query/body/header values;
6. secret-bearing test values never appear in captured logs;
7. safe logger rejects unknown/arbitrary fields rather than serializing them;
8. arbitrary Error message/stack is not accepted into the event envelope;
9. worker events use the same safe JSON serializer and preserve stdout/stderr level routing;
10. worker caught exception text remains absent;
11. application route/domain behavior from K7/A1-A11 remains unchanged;
12. no DB migration/runtime privilege or provider-network authority is introduced.

## 14. Exit criterion

A12 may move from Problem Analysis to Specification only when the implementation boundary remains limited to structured logging/correlation and does not smuggle in metrics/exporters, business identifiers or provider-live behavior.

This Problem Analysis is now frozen. YAML specification is authorized next; implementation is not.
