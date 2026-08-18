# A13 — Operational Metrics & Health Signals — GREEN Evidence

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`

## Status

**DONE / GREEN / RUNTIME-ONLY**

A13 adds a bounded in-memory operational metrics foundation for API and worker workloads. It does not change financial behavior, database schema, provider activation authority or retained-provider transport wiring.

## Canonical artifacts

- Problem Analysis: `docs/design/a13-operational-metrics-health-signals-problem-analysis.md`
- Spec: `docs/specs/operational-metrics-health-signals-v0.yaml`
- Contract: `docs/contracts/operational-metrics-health-signals-v0.md`
- RED test: `tests/application/053_a13_operational_metrics_health_signals.contract.test.mjs`
- RED evidence: `docs/evidence/application/2026-08-17-a13-operational-metrics-health-signals-red.md`

Clean RED commit: `26ff9d37d932168ffb41bea3e063e5853c207203`.  
Final behavioral GREEN head: `9393fda1cee8a0ceaf3b215d3efc8063ee5cd390`.

## Accepted implementation boundary

A13 introduces the workspace package `@swiftpay/metrics` with no external observability SDK dependency.

The package exposes only closed operational operations:

- HTTP request count by bounded method, frozen route template and status class;
- HTTP duration histogram by bounded method and frozen route template;
- readiness checks by workload and `ok|failed`;
- worker webhook batch attempts by frozen batch name and `success|failure`.

There is no generic metric-name or arbitrary-label API. Runtime validation rejects unknown fields/values before registry mutation.

The frozen metric families are:

- `swiftpay_http_requests_total`;
- `swiftpay_http_request_duration_ms`;
- `swiftpay_readiness_checks_total`;
- `swiftpay_worker_batches_total`.

HTTP duration buckets are `5,10,25,50,100,250,500,1000,2500,5000,+Inf` milliseconds.

## Cardinality and privacy boundary

API instrumentation reuses the A12 matched route template and bounded duration source. Concrete URLs and query strings do not become metric labels.

The metric surface has no merchant/payment/credential/webhook-endpoint/request/provider-transaction identifiers, external IDs, customer data, exact monetary amounts, raw URLs, request/response bodies, authorization/cookies/API keys, database URLs/SQL, error messages/stacks or provider payloads.

Provider is deliberately not a V0 label dimension.

## Scrape boundary

Each workload may expose a separate metrics listener only when its workload-specific port is configured:

- API: `SWIFTPAY_API_METRICS_PORT`;
- worker: `SWIFTPAY_WORKER_METRICS_PORT`.

Ports are optional canonical integers `1..65535`. No metrics-host environment variable exists. The listener binds only to `127.0.0.1`.

Only `GET /metrics` returns the deterministic OpenMetrics text representation with:

- content type `application/openmetrics-text; version=1.0.0; charset=utf-8`;
- `Cache-Control: no-store`;
- deterministic family/series ordering;
- no timestamps or exemplars;
- exact terminal `# EOF` marker;
- maximum response size 262,144 UTF-8 bytes.

Metrics listener/render/recording failure is not a readiness dependency and cannot alter selected HTTP/domain/worker outcomes.

## Application GREEN proof

Application workflow: `32094346060`.

`application-contracts` job `95582634694`:

- frozen install: PASS;
- TypeScript typecheck: PASS;
- TypeScript build: PASS;
- application contracts: **288/288 PASS**;
- A13 contracts: **12/12 PASS**;
- prior K7/A1-A12 application contracts: GREEN.

`runtime-database-acceptance` job `95582634651`:

- K7 real runtime database acceptance: PASS;
- A1 real token authentication acceptance: PASS;
- A2 real Pix acceptance: PASS;
- A3 paid transition / ledger / balance acceptance: PASS;
- A4 merchant webhook delivery acceptance: PASS;
- A6 dashboard authorization acceptance: PASS;
- A7 webhook endpoint management acceptance: PASS;
- A8 API credential management acceptance: PASS;
- A9 merchant transaction read acceptance: PASS.

## Database GREEN proof

Database workflow: `32094346105`.

- K5 deterministic sandbox fixtures: PASS;
- K6 trusted runtime topology: PASS;
- pgTAP: **40 files / 1292 assertions PASS**;
- database migrations added by A13: **none**.

## Authority and hosted-state proof

A13 introduces:

- hosted Supabase migrations: **0**;
- protected-table access for metrics: **0**;
- database telemetry queries: **0**;
- retained PSP calls: **0**;
- A5-to-A11 provider bridge: **none**;
- A10 registry activation changes: **none**;
- financial mutations/capabilities: **none**.

The canonical hosted Supabase project therefore requires no A13 deployment step.

## Known non-A13 compatibility debt

The existing Fastify 5.11 `FSTDEP023` warning for the A12 top-level `disableRequestLogging` configuration remains explicit and unchanged. A13 does not opportunistically mix a Fastify compatibility refactor into this slice.

## Closure

A13 is closed. The observability foundation now includes A12 safe logging/correlation plus A13 bounded metrics/OpenMetrics health signals. External exporters, alerting, dashboards, SLO policy and distributed tracing remain separate future work and require their own specification boundary.

Current provider evidence gates remain unchanged: no live AkkadPag/AkadPay/FlevoPay monetary operation is authorized.
