# SwiftPay V2 — V1 Readiness Status

Date: 2026-08-18  
Branch: `agent/foundation-phase-0`  
PR: #1 — draft  
`main`: intentionally untouched

## Executive checkpoint

Conservative risk/effort-weighted readiness after A13 closure remains:

- core architecture/domain/database/platform foundation: **~99%**;
- first end-to-end Pix sandbox MVP: **~97%**;
- production-capable Pix V1: **~60%**;
- weighted V1 engineering completion: **~75%**.

A10-A13 deliberately do not increase these estimates. They materially reduce premature-provider-activation, outbound-network, unsafe-runtime-logging and observability-blindness risk, but they do not prove a current retained-provider contract, perform authenticated provider sandbox traffic, close provider webhook/recovery/live monetary gates, or complete the remaining product/security/cutover work.

## Proven executable path

K1-K7 and A1-A13 are DONE. A5 remains fixture-only for live-provider authority; A10 makes the default-deny authorization state executable, A11 provides a strict outbound HTTPS primitive that remains unbound from retained PSP adapters, A12 provides safe server-owned runtime correlation plus closed-schema structured logging, and A13 adds bounded low-cardinality operational metrics plus loopback-only OpenMetrics scrape surfaces.

The branch proves:

1. API credential `client_credentials` -> 900-second machine Bearer token;
2. authenticated/idempotent Pix Payment creation;
3. deterministic visibly non-payable sandbox emulator;
4. authenticated machine Payment retrieval;
5. worker trusted paid evidence with replay/concurrency absorption;
6. exactly one `settlement_paid` double-entry posting;
7. authenticated merchant balance;
8. transactional `payment.paid` outbox;
9. signed/fenced/retried merchant webhook delivery;
10. fixture-only retained-provider conformance contracts;
11. online-verified Supabase dashboard sessions + K4 current membership/role authorization;
12. hosted webhook endpoint lifecycle administration;
13. hosted API credential lifecycle administration with AAL2 mutation step-up and immediate A1 token invalidation on rotation/revocation;
14. hosted dashboard transaction list/detail with exact filters, authenticated keyset cursor, tenant/environment isolation and merchant-safe projection;
15. provider activation registry/authorizer that denies every checked-in retained-provider operation and binds any future grant to exact provider/operation/environment/contract lineage plus reviewed evidence metadata;
16. strict provider HTTPS transport with grant-derived destination, DNS public-address validation/pinning, SNI/Host preservation, bounded request/response sizes, TLS verification, no redirect, no retry and conservative ambiguous-transmission classification;
17. safe API/worker JSONL runtime logging with server-owned UUIDv4 request correlation, route-template-only access events, closed event schemas and no arbitrary request/error/secret payload logging;
18. bounded in-memory API/worker operational metrics with closed label sets, deterministic OpenMetrics rendering and optional `127.0.0.1`-only scrape listeners.

## A13 checkpoint — operational metrics & health signals

Evidence: `docs/evidence/application/2026-08-17-a13-operational-metrics-health-signals.md`.

Final behavioral GREEN head: `9393fda1cee8a0ceaf3b215d3efc8063ee5cd390`.

- Behavioral Application workflow `32094346060`: **288/288 PASS**, including **12/12 A13** contracts and K7/A1-A9 real-database regression acceptance.
- Behavioral Database workflow `32094346105`: **40 files / 1292 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- Evidence-head Application workflow `32094504874`: **GREEN**.
- Evidence-head Database workflow `32094504849`: **GREEN**.
- A13 Supabase migrations: **none**.
- A13 retained-provider network calls: **0**.
- Provider/financial authority changes: **none**.

A13 introduces the dependency-free `@swiftpay/metrics` package with closed methods for HTTP request totals, HTTP duration histograms, readiness outcomes and worker webhook-batch outcomes. It intentionally exposes no generic metric-name/arbitrary-label API. Metric labels exclude dynamic merchant/payment/request/provider identifiers, money, PII, secrets, URLs, SQL, error content and provider payloads.

API and worker may expose separate metrics listeners only when `SWIFTPAY_API_METRICS_PORT` or `SWIFTPAY_WORKER_METRICS_PORT` is configured. The listener has no configurable host and binds only to `127.0.0.1`; telemetry failure cannot alter readiness, HTTP/domain results or worker retry behavior.

External exporters, alerting, dashboards, SLO policy and distributed tracing remain outside A13.

## A12 checkpoint — structured runtime logging & correlation

Evidence: `docs/evidence/application/2026-08-17-a12-structured-runtime-logging-correlation.md`.

Final behavioral GREEN head: `bce20e1bbfdc41c53d913043dff55d1cb14ca797`.

- Application workflow `32019551464`: **276/276 PASS**, including **11/11 A12** contracts and K7/A1-A9 real-database regression acceptance.
- Database workflow `32019551475`: **40 files / 1292 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- A12 Supabase migrations: **none**.
- A12 retained-provider network calls: **0**.
- Provider/financial authority changes: **none**.

A12 adds the dependency-free `@swiftpay/observability` package, moves API request identity to SwiftPay-owned UUIDv4 generation, ignores caller `x-request-id` as authority, correlates response headers/public errors with the generated ID, disables Fastify generic request logging, emits one safe route-template completion event and moves the worker to the same closed-schema serializer.

Known compatibility debt is explicit: Fastify 5.11 emits `FSTDEP023` for the top-level `disableRequestLogging` option. The behavior remains GREEN; migrate to `logController` before a Fastify 6 upgrade in a dedicated compatibility slice.

## A11 checkpoint — strict provider HTTP transport

Evidence: `docs/evidence/application/2026-08-17-a11-strict-provider-http-transport.md`.

Behavioral GREEN head: `7f3b373fe0bdfe32ae9f1924e9e461071abeea6d`.

- Application workflow `32014646148`: **265/265 PASS**, including 15/15 A11 contracts and K7/A1-A9 real-database regression acceptance.
- Database workflow `32014646143`: **40 files / 1292 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- A11 Supabase migrations: **none**.
- A11 retained-provider network calls in tests/CI: **0**.
- Default A10 runtime-authorized provider operations after A11: **0**.

A11 adds the single approved Node network boundary in `packages/providers/src/http-transport.ts`. A5 retained adapters remain network-free and are not wired to A11. Destination authority cannot come from caller-supplied URLs or grant-shaped objects: the transport consumes a runtime-validated A10 registry and authorizes the exact subject internally before DNS/network execution.

The transport uses fresh all-address DNS resolution per send, rejects empty/private/reserved/mixed answers, pins the first validated public address, preserves approved hostname for TLS SNI and Host, requires certificate verification/TLS >=1.2, applies fixed size/time ceilings, performs at most one HTTPS execution, follows no redirect and performs no automatic retry. Post-attempt uncertainty remains explicit `transmission_unknown` rather than fabricated failure/success.

## A10 checkpoint — provider activation & outbound safety

Evidence: `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety.md`.

GREEN implementation head: `0308844c4aedb1d359068becfd29d1f4a234b064`.

- Application workflow `32011311478`: **250/250 PASS**, including 10/10 A10 contracts and K7/A1-A9 real-database regression acceptance.
- Database workflow `32011311485`: **40 files / 1292 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- A10 Supabase migrations: **none**.
- A10 provider network calls: **none**.
- Default A10 runtime-authorized provider operations: **0**.

A10 V0 introduces a strict versioned registry and immutable in-memory authorization grant boundary in `packages/providers`. `unsupported`, `fixture_only` and `current_contract_proven` do not authorize runtime provider traffic. Sandbox requires an exact `sandbox_proven`/`production_enabled` Sandbox record; Production requires an exact `production_enabled` Production record. Evidence is contract-lineage specific: similarly named AkadPay material cannot silently authorize the retained AkkadPag legacy lineage.

## A9 hosted checkpoint

Evidence: `docs/evidence/application/2026-08-17-a9-merchant-transaction-operations.md`.

Behavioral GREEN head: `f846a50f2c8afe8f5561a59aebef8574e22ac6d6`.

- Application workflow `32009421604`: **240/240 PASS**, including K7/A1/A2/A3/A4/A6/A7/A8/A9 real-database acceptance.
- Database workflow `32009421592`: **40 files / 1292 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- Hosted migration: `20260817081745_merchant_transaction_operations.sql`.
- Hosted `swiftpay_api`: exact **23** `app` EXECUTE capabilities.
- Hosted `swiftpay_worker`: exact **6**.
- Security Advisor after A9: **0 lints**.

A9 V0 is dashboard-only and read-only. It adds no Payment status mutation, provider recovery command, reconciliation command or monetary capability.

## What remains for V1

The remaining weighted V1 engineering work is approximately **25%**, but it is risk-heavy rather than a simple quarter of feature count. Separately, the production-capable Pix V1 measure is only about **60% complete**, so roughly **40% of production launch capability remains**.

The largest unresolved block is production PSP authority:

- provider-owned proof of the exact retained AkkadPag/AkadPay contractual lineage/equivalence or a deliberate replacement decision;
- current create/query/idempotency and ambiguous-execution recovery semantics for the selected retained contract;
- current FlevoPay technical create/query/recovery semantics;
- exact provider webhook authentication/replay contracts;
- authenticated current sandbox acceptance before any registry transition to `sandbox_proven`;
- a deliberately specified adapter-to-A11 bridge only after the applicable evidence gate closes;
- provider webhook ingress and recovery/reconciliation runtime against verified current contracts;
- deliberate `production_enabled` transition only after production acceptance gates.

There are also remaining merchant/product surfaces outside the completed A1-A13 path:

- dashboard login/session UX and Supabase Auth product configuration;
- merchant-usable payout/refund operations;
- KYC/compliance operations UX;
- hosted Pix checkout;
- payment links;
- conversion/analytics and broader operational/reporting surfaces.

Production hardening still includes:

- external metrics collection/export, alerting, dashboards, SLO policy and distributed tracing beyond A12/A13 local observability foundations;
- secret/key rotation architecture, dependency/security review, least-privilege audit and abuse/rate-limit review;
- measured performance cleanup;
- deployment/cutover/rollback, backup/recovery, provider credential bootstrap and launch runbook.

These remaining items do not supersede the PSP evidence gate on the live Pix critical path.

## External production blocker

The critical production blocker remains current provider-owned contract evidence for retained PSPs.

The 2026-08-17 evidence refresh is recorded at `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`.

Current AkadPay public technical material documents useful Pix-out idempotency/replay details, but no accepted provider-owned evidence proves that the public AkadPay contract is the authoritative/current lineage of the retained AkkadPag legacy adapter. Exact trusted webhook verification also remains unproven.

Current FlevoPay public material exposes a current API host and high-level Pix capabilities but still does not provide the exact executable create/query/recovery/webhook contract required to activate the retained integration.

Therefore A5 fixture conformance + A10 activation safety + A11 strict transport still authorize **zero live retained-provider runtime operations**.

## Next internal action

A13 is DONE / GREEN / RUNTIME-ONLY. Continue provider-owned current technical evidence/authenticated sandbox acquisition in parallel, but do not bridge retained adapters merely because A11 transport exists.

The next internal production-hardening behavior must restart at Problem Analysis. The highest current unblocked risk-adjusted candidate is abuse/rate-limit hardening across public machine and dashboard boundaries, because it reduces production exposure without requiring provider contract authority. No A14 implementation authority exists until its Problem Analysis, spec, contracts and RED tests are frozen.

No real monetary PSP call is authorized until the exact current-contract evidence, authenticated sandbox proof and applicable activation gates are closed.
