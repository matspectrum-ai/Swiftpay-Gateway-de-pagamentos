# A12 — Structured Runtime Logging & Correlation — GREEN Evidence

Date: 2026-08-17  
Status: **DONE / GREEN / RUNTIME-ONLY**

## Canonical artifacts

- Problem Analysis: `docs/design/a12-structured-runtime-logging-correlation-problem-analysis.md`
- Specification: `docs/specs/structured-runtime-logging-correlation-v0.yaml`
- Application contract: `docs/contracts/structured-runtime-logging-correlation-v0.md`
- Fail-first contract: `tests/application/052_a12_structured_runtime_logging_correlation.contract.test.mjs`
- RED evidence: `docs/evidence/application/2026-08-17-a12-structured-runtime-logging-correlation-red.md`

## RED proof

A12 implementation was authorized only after a clean fail-first boundary.

Application workflow `32015860637` proved:

- dependency install GREEN;
- TypeScript typecheck GREEN;
- build GREEN;
- 276 total application tests: **257 PASS / 19 expected FAIL**;
- the 19 failures were exactly the eight deliberately migrated A1 request-correlation expectations plus the eleven new A12 contracts;
- A2-A11 behavior remained GREEN.

Database workflow `32015860620` and the same runtime gate proved K5/K6/pgTAP plus K7/A1-A9 real-database behavior remained GREEN before implementation.

## GREEN implementation

Final behavioral head: `bce20e1bbfdc41c53d913043dff55d1cb14ca797`.

A12 introduced a dependency-free `@swiftpay/observability` package and integrated it into API and worker runtime logging.

Accepted behavior:

1. runtime events use a positive closed schema rather than arbitrary metadata bags;
2. serialization is deterministic JSON Lines with canonical field order;
3. invalid/unknown fields, raw Error content and malformed correlation metadata fail before sink write;
4. sink write failure is absorbed without retry and cannot change domain behavior;
5. API request identity is server-owned lowercase UUIDv4 generated with Node `crypto.randomUUID()`;
6. incoming `x-request-id` is untrusted input and never controls canonical request identity;
7. response `x-request-id`, application request context and public error `requestId` share the generated server ID;
8. Fastify generic per-request logging is disabled and SwiftPay emits one `http_request_completed` event per completed request;
9. access logging uses only the matched Fastify route template or `<unmatched>`, never the concrete URL/query;
10. request/response bodies, headers, cookies, credentials, PII, provider payloads, database URLs/SQL and arbitrary exception text are outside the event schema;
11. worker events use the same safe serializer/logger and caught exceptions are never forwarded into logs;
12. A12 adds no database state, public route, exporter, metrics backend, provider authority or financial side effect.

Legacy A1/A2/A3 tests and A1 real-runtime acceptance were deliberately migrated from caller-controlled request IDs to the A12 server-owned correlation contract while preserving all authentication, Pix, quota, ledger, balance and invariance assertions.

## Final application proof

Application workflow `32019551464` — **GREEN**.

- frozen pnpm install: PASS;
- typecheck: PASS;
- build: PASS;
- application contracts: **276/276 PASS**;
- A12 contracts: **11/11 PASS**;
- K7 real runtime database acceptance: PASS;
- A1 real token authentication acceptance: PASS;
- A2 real Pix runtime acceptance: PASS;
- A3 real paid/ledger/balance acceptance: PASS;
- A4 merchant webhook runtime acceptance: PASS;
- A6 dashboard authorization acceptance: PASS;
- A7 webhook endpoint management acceptance: PASS;
- A8 API credential management acceptance: PASS;
- A9 merchant transaction operations acceptance: PASS.

## Final database regression proof

Database workflow `32019551475` — **GREEN**.

- pgTAP: **40 files / 1292 assertions PASS**;
- K5 deterministic sandbox fixtures: PASS;
- K6 trusted runtime topology: PASS.

A12 migrations: **none**.  
Hosted Supabase changes: **none**.  
Retained-provider network calls introduced by A12: **0**.  
Provider activation-authority change: **none**.  
Financial mutation-authority change: **none**.

## Known non-blocking compatibility debt

Fastify 5.11 emits `FSTDEP023` because A12 currently uses the supported-but-deprecated top-level `disableRequestLogging` option. Current behavior is fully GREEN and automatic request logging is disabled as contracted. Before a Fastify 6 upgrade, migrate this configuration to Fastify's `logController` form in a dedicated compatibility/refactor slice and rerun the full application/runtime gate.

This warning does not authorize any behavior change and is not hidden from the handoff.

## Readiness consequence

A12 closes the first observability foundation slice: safe structured runtime logs and correlation are now executable. Metrics, distributed tracing, exporters, alerts, dashboards and SLOs remain separate production-hardening work.

The conservative readiness percentages are therefore intentionally not reweighted by A12 alone. The critical production blocker remains verified current PSP contract lineage/semantics plus authenticated current sandbox proof and subsequent evidence-gated provider activation.
