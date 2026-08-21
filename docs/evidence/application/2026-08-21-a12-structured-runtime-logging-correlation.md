# SwiftPay V2 — A12 Structured Runtime Logging & Correlation — Final Evidence

Date: 2026-08-21  
Branch: `agent/foundation-phase-0-a12-implementation`  
Feature: A12 — Structured Runtime Logging & Correlation  
Status: **DONE / GREEN**

## Frozen authority

A12 was implemented only after the repository had frozen the required planning and fail-first artifacts:

- Problem Analysis: `docs/design/a12-structured-runtime-logging-correlation-problem-analysis.md`
- Spec: `docs/specs/structured-runtime-logging-correlation-v0.yaml`
- Contract: `docs/contracts/structured-runtime-logging-correlation-v0.md`
- Fail-first contracts: `tests/application/052_a12_structured_runtime_logging_correlation.contract.test.mjs`
- RED evidence: `docs/evidence/application/2026-08-17-a12-structured-runtime-logging-correlation-red.md`

The clean RED baseline was commit `934c2c38ab8ee98a9d70662f27c9f449e9450d4c`, Application workflow `32015860637`:

- dependency install: GREEN;
- typecheck: GREEN;
- build: GREEN;
- total application tests: **276**;
- PASS: **257**;
- FAIL: **19**;
- harness/parser/module failures: **0**;
- all 19 failures were inside the frozen A12 boundary: 8 intentional A1 request-correlation migrations plus 11 new A12 contracts.

Database workflow `32015860620` and the K7/A1-A9 real-database regression path were already GREEN at RED.

## Implemented boundary

A12 adds `@swiftpay/observability` as a high-cohesion, network-free and database-free runtime boundary shared by API and worker.

Accepted behavior:

- closed runtime event schema with only `timestamp`, `level`, `event`, `workload`, `requestId`, `method`, `route`, `statusCode`, `durationMs`, and `errorCode`;
- canonical single-line JSON serialization;
- runtime rejection of unknown fields, raw `Error` objects and malformed event values before sink execution;
- deterministic injectable clock and sink contracts;
- `info`/`warn` routing to stdout and `error` routing to stderr;
- sink failures are non-authoritative: no throw, no retry and no domain-flow mutation;
- server-generated Node `randomUUID()` UUIDv4 is the sole API request-correlation authority;
- caller `x-request-id` is ignored rather than trusted or echoed;
- response `x-request-id` and public error `requestId` share the server-owned identifier;
- Fastify automatic request logging is disabled;
- exactly one `http_request_completed` safe event is emitted per completed request;
- HTTP logs contain route templates or `<unmatched>`, never concrete request URLs, query strings, request/response bodies or request headers;
- request duration uses a monotonic source and is bounded before serialization;
- worker lifecycle/error events use the same safe logger and do not forward caught exception text, stacks, database URLs or provider/customer material;
- no exporter, collector, OpenTelemetry transport, network call, database write or Supabase migration is introduced.

## Legacy correlation contract alignment

The first implementation CI run correctly exposed **11 stale pre-A12 assertions** in A1/A2/A3 tests. The A12 contracts themselves were already **11/11 GREEN**.

The stale tests expected caller-supplied `x-request-id` values to be echoed. That expectation directly contradicted the frozen A12 requirement that correlation IDs are server-owned UUIDv4 values. The implementation was not weakened or reverted.

The affected tests were updated to assert the new frozen contract instead:

- server-generated UUIDv4 response ID;
- response ID differs from caller-provided ID;
- public error `requestId` equals the response header;
- independent requests receive independent IDs;
- A1 indistinguishable invalid-credential semantics compare stable error code/message rather than caller-controlled correlation values.

Changed regression files:

- `tests/application/009_api_auth_runtime_wiring.contract.test.mjs`
- `tests/application/015_pix_http.contract.test.mjs`
- `tests/application/019_a3_balance_http.contract.test.mjs`
- `tests/application/011_a1_real_runtime_acceptance.sh`

## Final GREEN proof

Behavioral GREEN head before this evidence commit: `aefcfb2470175db888a97883c300d2184a58d3ef`.

### Application workflow

Workflow: `32520385475` — **GREEN**.

`application-contracts`:

- Node.js 24: GREEN;
- pinned pnpm 11.17.0: GREEN;
- frozen dependency install: GREEN;
- TypeScript typecheck: GREEN;
- TypeScript build: GREEN;
- application contracts: **276/276 PASS**;
- A12 contracts: **11/11 PASS**.

`runtime-database-acceptance`:

- K7 executable runtime acceptance: GREEN;
- A1 real token authentication acceptance: GREEN;
- A2 real Pix runtime acceptance: GREEN;
- A3 real paid-ledger/balance acceptance: GREEN;
- A4 merchant webhook runtime acceptance: GREEN;
- A6 dashboard authorization acceptance: GREEN;
- A7 webhook endpoint management acceptance: GREEN;
- A8 API credential management acceptance: GREEN;
- A9 merchant transaction operations acceptance: GREEN.

### Database workflow

Workflow: `32520385432` — **GREEN**.

- pgTAP: **40 files / 1292 assertions PASS**;
- K5 deterministic sandbox fixtures: GREEN, including idempotent reload;
- K6 trusted runtime topology: GREEN;
- API and worker runtime role-boundary verification: GREEN.

## Supabase, provider and financial invariance

- hosted Supabase migrations in A12: **none**;
- hosted Supabase schema/data changes in A12: **none**;
- live retained-provider calls in A12: **0**;
- A10 provider activation authority change: **none**;
- A5-to-A11 adapter bridge: **not introduced**;
- Payment/ProviderAttempt/ledger behavior changes: **none**;
- new financial side effects: **none**.

A12 therefore closes an observability/correlation safety gap without expanding financial or provider authority.

## Refactor review

The implementation is intentionally split by responsibility:

- `packages/observability` owns event contracts, validation, serialization and sink isolation;
- API owns request lifecycle/correlation capture and emits only the approved completion projection;
- worker owns execution flow and emits only approved stable lifecycle/error classifications;
- regression tests centralize server-owned request-ID assertions rather than reproducing caller-echo assumptions.

No post-GREEN behavior expansion was performed.

## Open non-blocking risk

Fastify 5.11 still accepts the configured top-level `disableRequestLogging: true`, and all A12 contracts prove automatic request logging is disabled. However Fastify reports deprecation warning `FSTDEP023` for that option and recommends the newer `LogController` configuration path.

This does not invalidate A12 on the pinned Fastify version and is not a security fallback: the automatic request logs are demonstrably disabled. It should nevertheless be removed in a dedicated compatibility/refactor change, with the A12 no-unsafe-access-log contracts rerun before any Fastify major-version upgrade.

## Integration topology risk

`main` remains intentionally almost empty while the reconstructed V2 lineage lives on feature branches. Draft PR #2 therefore represents much more than the isolated A12 delta when compared with `main`.

PR #2 must remain draft and must not be treated as merge-ready until the repository integration strategy for the existing V2 foundation is deliberately resolved. This is a branch-topology/integration concern, not an A12 behavioral failure.

## Readiness impact

A12 completes the structured runtime logging and request-correlation foundation. It does **not** complete metrics, tracing exporters, alerts, dashboards, SLOs, launch/cutover, broader merchant UI, or current live-PSP evidence gates.

The conservative readiness estimates therefore remain unchanged:

- core architecture/domain/database/platform: ~99%;
- first end-to-end Pix sandbox MVP: ~97%;
- production-capable Pix V1: ~60%;
- weighted V1 engineering: ~75%.

The external critical blocker remains current provider-owned contract/lineage/idempotency/recovery/webhook-auth evidence plus authenticated current sandbox proof for the selected retained PSP lineage.
