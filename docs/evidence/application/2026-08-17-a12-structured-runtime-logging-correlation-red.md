# SwiftPay V2 — A12 Structured Runtime Logging & Correlation — TDD RED Evidence

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
Feature: A12 — Structured Runtime Logging & Correlation  
Status: **CLEAN RED — IMPLEMENTATION AUTHORIZED NEXT**

## Frozen inputs

- Problem Analysis: `docs/design/a12-structured-runtime-logging-correlation-problem-analysis.md`
- Spec: `docs/specs/structured-runtime-logging-correlation-v0.yaml`
- Contract: `docs/contracts/structured-runtime-logging-correlation-v0.md`
- Fail-first contracts: `tests/application/052_a12_structured_runtime_logging_correlation.contract.test.mjs`
- Intentional A1 correlation-contract migration: `tests/application/005_token_exchange_http.contract.test.mjs`

## Application RED

Commit under test: `934c2c38ab8ee98a9d70662f27c9f449e9450d4c`.

Application workflow: `32015860637`.

- dependency install: GREEN;
- typecheck: GREEN;
- build: GREEN;
- application contracts: intentionally RED;
- total tests: **276**;
- PASS: **257**;
- FAIL: **19**;
- parser/module/typecheck/build/harness failures: **0**.

The 19 failures are exactly within the frozen A12 behavior boundary:

1. **8** A1 HTTP tests intentionally migrated before implementation from caller-controlled `x-request-id` authority to server-generated UUIDv4 correlation;
2. **11** new A12 contracts proving the absent observability package/API/worker behavior.

All A2-A11 application contracts remain GREEN, including A11 **15/15**.

The RED log also directly demonstrates the pre-A12 behavior being removed: caller-supplied request IDs are accepted as `reqId`, and Fastify automatic request logging emits concrete URLs/query strings.

## Database/runtime regression gate

Database workflow `32015860620`: GREEN.

- pgTAP: existing **40 files / 1292 assertions PASS**;
- K5 deterministic sandbox fixtures: GREEN;
- K6 runtime topology: GREEN.

Application workflow runtime-database-acceptance job `95345057940`: GREEN.

- K7: GREEN;
- A1: GREEN;
- A2: GREEN;
- A3: GREEN;
- A4: GREEN;
- A6: GREEN;
- A7: GREEN;
- A8: GREEN;
- A9: GREEN.

The real-database acceptance path is unaffected because A12 changes runtime correlation/logging authority, not domain/database semantics.

## Safety state at RED

- `@swiftpay/observability` implementation: absent;
- API server-owned request ID behavior: absent;
- Fastify automatic request logging disablement: absent;
- shared API/worker safe logger: absent;
- metrics/exporters/OpenTelemetry: absent and out of scope;
- database/Supabase changes: none;
- provider-live authority change: none;
- retained-provider calls: none;
- financial side effects: none.

## Authorized next step

Implement only the frozen A12 shared structured logging/correlation boundary, make the 19 behavior gaps GREEN without weakening the tests, preserve all A2-A11 and database/runtime regressions, and keep the feature exporter/network/database independent.
