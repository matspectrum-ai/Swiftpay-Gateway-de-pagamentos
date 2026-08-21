# A13 — Operational Metrics & Health Signals — Problem Analysis

Status: **FROZEN PROBLEM ANALYSIS**  
Date: 2026-08-17  
Implementation authority: **NONE**

## 1. Problem

A12 established safe structured runtime logging and server-owned request correlation, but SwiftPay still lacks machine-consumable operational measurements that can answer production questions such as:

- is the API serving requests successfully and within acceptable latency?
- is the worker loop healthy or repeatedly failing batches?
- are authentication/Pix/webhook/database failures increasing?
- are retryable asynchronous operations accumulating or becoming terminal?
- can an operator distinguish a healthy process from a process that is alive but operationally degraded?

Existing `/health/live` and `/health/ready` endpoints are intentionally narrow process/database boundary probes. They are not a metrics system and must not become a hidden dump of financial, tenant or provider state.

Without a bounded metrics contract, adding ad-hoc counters risks cardinality explosions, leaking merchant/payment/provider identifiers, coupling domain outcomes to observability availability, and creating an unauthenticated operational side channel.

## 2. Current repository facts

The current executable baseline already has:

- Fastify API liveness/readiness;
- separate worker readiness/runtime boundary verification;
- A12 closed-schema API/worker runtime events;
- durable payment, ledger, jobs and merchant webhook state in PostgreSQL;
- A10/A11 provider activation/transport safety with zero checked-in live retained-provider authority;
- no metrics exporter, Prometheus/OpenMetrics endpoint, OpenTelemetry SDK, external observability vendor or persistent metrics database introduced by A12.

A13 must build on these boundaries rather than bypass them.

## 3. Goal

Define a minimal, vendor-neutral in-process metrics and health-signal foundation that is safe to expose to trusted infrastructure and sufficient to support later dashboards/alerts/SLOs, without changing payment/provider/database authority.

A13 should make operational health measurable while keeping all metric dimensions bounded and non-sensitive.

## 4. Non-goals

A13 does **not** authorize:

- provider adapter bridging or live PSP calls;
- provider contract activation changes;
- Payment, ledger, payout, refund or reconciliation mutation;
- merchant-visible analytics/product reporting;
- distributed tracing;
- log export;
- alerting vendor integration;
- dashboards/SLO policy;
- historical metrics persistence in PostgreSQL/Supabase;
- arbitrary labels derived from merchant IDs, payment IDs, external IDs, request IDs, URLs, customer data or exception messages.

## 5. Primary risks

### 5.1 High-cardinality labels

Request IDs, merchant/payment/credential IDs, concrete route values, external IDs, provider transaction IDs and error messages are forbidden metric dimensions. Metrics must use closed low-cardinality enums and matched route templates only when route dimensioning is justified.

### 5.2 Sensitive-data disclosure

A metrics surface must not expose credentials, PII, financial object identifiers, exact customer amounts, raw URLs/query strings, SQL, provider request/response content or internal secret material.

### 5.3 Observability changing business behavior

Counter/histogram recording or exporter failure must never fail an HTTP request, worker batch, payment transition, ledger post, webhook resolution or provider operation.

### 5.4 Untrusted public exposure

A metrics endpoint, if selected, cannot silently become a merchant/public API. Exposure and network/auth boundary must be explicit in the spec and deployment topology.

### 5.5 False health semantics

Liveness, readiness and operational degradation are distinct concepts. A13 must not make readiness depend on optional telemetry backends, nor mark a process unhealthy merely because an exporter is unavailable.

### 5.6 Provider cardinality/authority confusion

Provider name may eventually be a bounded dimension only if sourced from the retained provider enum. A metric must never imply provider activation or successful live execution.

## 6. Candidate metric families to freeze in specification

The specification should select the smallest useful bounded set from these categories:

### API

- completed HTTP requests by method, matched route template and status class/status code bucket;
- request duration histogram with fixed buckets;
- machine-auth outcomes by stable classification;
- dashboard-auth outcomes by stable classification;
- Pix create/get application outcomes by stable classification.

### Worker / asynchronous runtime

- worker loop batch attempts/outcomes;
- merchant webhook delivery resolutions by stable outcome class;
- durable work claim/resolve failures where already observable without privileged ad-hoc DB queries.

### Runtime dependencies

- readiness probe outcomes;
- trusted database boundary failures as bounded counters.

A13 V0 should avoid business KPI metrics such as GMV, revenue, merchant-level conversion, exact monetary amount histograms or per-provider success rate until their product/security semantics are separately specified.

## 7. Health model to freeze

A13 should preserve:

- `/health/live`: process liveness only;
- `/health/ready`: current required dependency/runtime boundary readiness only.

Potential new operational health information must be explicitly infrastructure-scoped and must not include tenant/business state. If no new endpoint is necessary, metrics alone may be sufficient for V0.

## 8. Metric naming and label policy

The forthcoming spec must define:

- one SwiftPay metric namespace/prefix;
- exact metric names and types;
- exact label keys and enum domains;
- fixed histogram buckets where applicable;
- no caller-defined/custom labels;
- no arbitrary metadata bags;
- deterministic normalization for matched routes/status classifications;
- cardinality ceiling tests.

No metric may contain a dynamic identifier except as the metric value itself when explicitly bounded and non-sensitive; identifiers are not labels.

## 9. Failure semantics

Metrics recording is best-effort and side-effect-free with respect to domain behavior.

Required invariants for the future spec:

1. metric validation/recording failure never changes an already-selected API/domain outcome;
2. metrics backend/scrape failure never changes process readiness;
3. no retry is introduced into payment/provider/webhook behavior for telemetry purposes;
4. telemetry code performs no direct protected-table queries unless a separately frozen DB contract explicitly requires them;
5. A13 V0 should prefer event-point instrumentation over polling financial tables.

## 10. Security boundary questions to resolve in spec

Before tests/implementation, freeze:

- whether V0 exposes an HTTP scrape endpoint or only an injectable registry/snapshot boundary;
- if HTTP is exposed, exact path, listener/network trust model and whether it shares the public API listener;
- maximum response size and cache semantics;
- whether metric names/labels are all compile-time closed;
- fixed histogram buckets and acceptable process-memory ceiling;
- whether worker and API registries are separate per process/workload;
- exact behavior on duplicate metric registration or invalid label sets.

## 11. Acceptance strategy

A13 must follow strict TDD. Fail-first tests should prove at minimum:

- exact metric family/type/name/label contract;
- unknown/dynamic labels are rejected before mutation;
- request/payment/merchant/customer/request-id/query/secret canaries never appear in metric output;
- bounded cardinality under many distinct request/payment/merchant IDs;
- HTTP duration records matched route template, not concrete URL;
- status/error classification uses stable bounded values;
- worker/API instrumentation records expected outcomes exactly once;
- telemetry recording failure cannot alter domain/HTTP outcome;
- no provider activation/network authority change;
- no database migration or direct protected-table authority;
- all A1-A12 application contracts, K5/K6/pgTAP and K7/A1-A9 real-database acceptance remain GREEN.

## 12. Decision

Proceed to a frozen YAML specification only after choosing the V0 exposure model and exact bounded metric inventory.

Until that specification and contracts exist:

- no metrics package/endpoint/SDK may be implemented;
- no health endpoint semantics may be changed;
- no alert/dashboard integration may be added;
- no provider or financial authority changes are permitted.

Provider evidence acquisition remains a parallel external track and does not block A13 planning.
