# A19 — Fastify LogController Compatibility — Contract V0

Status: **FROZEN FOR TDD**  
Date: 2026-08-19

The authoritative specification is `docs/specs/fastify-log-controller-compatibility-v0.yaml`.

## 1. Scope

A19 is a compatibility-only refinement of A12 API construction. It removes Fastify `FSTDEP023` without changing SwiftPay observability, metrics, HTTP, database, provider or financial behavior.

Fastify remains pinned to `5.11.0` for this slice.

## 2. Fastify construction contract

`apps/api/src/app.ts` MUST import the stock `LogController` export from `fastify` and construct the API with semantic options equivalent to:

```ts
Fastify({
  logger: false,
  logController: new LogController({
    disableRequestLogging: true,
  }),
  requestIdHeader: false,
  genReqId: () => randomUUID(),
});
```

The exact formatting is not contractual. The authority is.

Forbidden:

- top-level `disableRequestLogging` in the Fastify options object;
- enabling Fastify/Pino logging;
- passing a custom logger instance;
- subclassing `LogController`;
- overriding `LogController` lifecycle methods;
- suppressing deprecations or filtering `FSTDEP023`.

## 3. A12 preservation contract

A19 MUST preserve A12 exactly:

- caller `x-request-id` is not trusted;
- request IDs remain server-owned UUIDv4 values;
- response `x-request-id` uses that same request ID;
- one and only one SwiftPay `http_request_completed` event is emitted for a completed request;
- matched route template, not concrete URL/query, is logged;
- unmatched routes use `<unmatched>`;
- closed event schemas and secret/PII redaction remain unchanged;
- logger sink failure cannot change the selected HTTP/domain response.

Fastify internal logging MUST remain disabled. A19 does not delegate A12 to Fastify.

## 4. A13 preservation contract

A19 MUST preserve existing A13 HTTP metrics and readiness metrics with no label/schema/cardinality change.

## 5. Warning contract

The runtime MUST solve the deprecated API usage rather than suppress the warning.

An isolated child Node process MUST be able to import `apps/api/dist/app.js`, call `buildApp({ readinessProbe: async () => {} })`, and close the resulting Fastify instance successfully, with stderr containing neither `FSTDEP023` nor a deprecated `disableRequestLogging` warning.

The observed A19 RED establishes that Fastify's `FSTDEP023` warning is not converted into a thrown process error by Node `--throw-deprecation`; therefore process exit status alone is not an authoritative warning gate. Stderr is the explicit acceptance surface for this warning.

No A19 source/config/test may rely on:

- `NODE_NO_WARNINGS`;
- `--no-warnings`;
- `--no-deprecation`;
- a warning listener that swallows `FSTDEP023`;
- any equivalent warning filter.

## 6. Authority contract

A19 introduces:

- no database migration;
- no new PostgreSQL privilege;
- no Supabase hosted change;
- no worker change;
- no provider network call;
- no A10 activation state change;
- no payment, ProviderAttempt, ledger, job or webhook state transition.

## 7. TDD gate

Implementation authority remains **NONE** until a fail-first A19 test proves the current A18 head violates the frozen A19 contract.

RED MUST prove at least:

1. current source still supplies top-level `disableRequestLogging`;
2. current source lacks the required `logController`/`LogController` construction;
3. the existing build emits `FSTDEP023` in an isolated child process.

Only after that RED may `apps/api/src/app.ts` be minimally changed.
