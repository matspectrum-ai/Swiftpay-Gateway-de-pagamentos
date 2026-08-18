# SwiftPay V2 — V1 Readiness Status

Date: 2026-08-18  
Branch: `agent/foundation-phase-0`  
PR: #1 — draft  
`main`: intentionally untouched

Canonical functional checklist: `docs/product/v1-functional-checklist.md`.

## Executive checkpoint

Conservative risk/effort-weighted readiness after A17 closure remains:

- core architecture/domain/database/platform foundation: **~99%**;
- first end-to-end Pix sandbox MVP: **~97%**;
- production-capable Pix V1: **~60%**;
- weighted V1 engineering completion: **~75%**.

A10-A17 deliberately do not increase these estimates. They materially reduce premature-provider-activation, outbound-network, unsafe-runtime-logging, observability-blindness, public-ingress abuse, key-rotation and legacy webhook-secret authority risk, but they do not prove a current retained-provider contract, perform authenticated provider sandbox traffic, close provider webhook/recovery/live monetary gates, or complete remaining operational/cutover work.

## Proven executable path

K1-K7 and A1-A17 are DONE. A5 remains fixture-only for live-provider authority and A10 default retained-provider runtime authority remains zero.

The branch proves:

1. API credential `client_credentials` -> exact 900-second machine Bearer token;
2. authenticated/idempotent Pix Payment creation;
3. deterministic visibly non-payable sandbox emulator;
4. authenticated machine Payment retrieval;
5. worker trusted paid evidence with replay/concurrency absorption;
6. exactly one `settlement_paid` double-entry posting;
7. authenticated merchant balance;
8. transactional `payment.paid` merchant outbox;
9. signed/fenced/retried merchant webhook delivery;
10. fixture-only retained-provider conformance contracts;
11. online-verified Supabase dashboard sessions + current membership/role authorization;
12. hosted webhook endpoint lifecycle administration;
13. hosted API credential lifecycle administration with AAL2 mutation step-up;
14. hosted dashboard transaction list/detail with authenticated keyset pagination;
15. provider activation registry/authorizer defaulting every retained-provider operation to denied;
16. strict provider HTTPS transport that remains unbound from retained PSP adapters;
17. safe structured API/worker logging with server-owned correlation;
18. bounded in-memory operational metrics + loopback OpenMetrics scrape;
19. hosted distributed ingress admission control with trusted-proxy authority and PostgreSQL quotas;
20. `kid`-aware machine access-token signing-key rotation;
21. `kid`-aware dashboard cursor HMAC rotation;
22. RSA-only persisted merchant webhook signing-secret authority with legacy AES decrypt/config/schema fallback retired.

## A17 hosted checkpoint — legacy webhook AES secret retirement

Evidence: `docs/evidence/application/2026-08-18-a17-legacy-webhook-aes-secret-retirement.md`.

Accepted implementation head: `e7c41e9a416cf454724b8167a5d17c9bf1c19e08`.

- Application workflow `32168309740`: **344/344 application contracts PASS**, including **7/7 A17**.
- Real-database runtime acceptance in the same workflow: K7/A1/A2/A3/A4/A6/A7/A8/A9/A14 all GREEN.
- Database workflow `32168309894`: K5/K6 GREEN and **42 files / 1304 pgTAP assertions PASS**.
- Hosted preflight on canonical `swiftpay v2`: 0 webhook endpoints, 0 secret-version rows, 0 AES rows, 0 Payments, 0 ProviderAttempts.
- Hosted migration history: `20260818175935_legacy_webhook_aes_secret_retirement`.
- `webhook_endpoint_secret_versions.wrapping_key_id`: NOT NULL.
- Persisted secret format/ciphertext: RSA-OAEP-SHA256 only.
- `claim_merchant_webhook_deliveries` remains `SECURITY DEFINER`, `VOLATILE`, `search_path=''` and worker-only executable.
- API/worker direct secret-version table DML authority: zero.
- Hosted API/worker app EXECUTE capability counts remain exactly **24 / 6**.
- Hosted Security Advisor: **0 lints**.
- Hosted Payment/ProviderAttempt counts after deploy: **0 / 0**.
- Retained-provider calls: **0**.
- A10 activation promotions: **0**.

A17 removes `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY`, `webhookEncryptionKey`, executable persisted-secret AES decrypt authority and the database claim fallback that previously interpreted missing version history through endpoint AES mirrors. Delivery now accepts only explicit RSA version history bound to an exact wrapping-key ID. Merchant webhook HMAC request signing, retry/fencing, URL snapshots and secret-version rotation overlap remain unchanged.

## A16 checkpoint — dashboard transaction cursor HMAC rotation

Evidence: `docs/evidence/application/2026-08-18-a16-dashboard-transaction-cursor-hmac-rotation.md`.

- **336/336** application contracts, including 14/14 A16.
- K7/A1-A9/A14 real-database regression acceptance GREEN.
- Database: **41 files / 1298 assertions**, K5/K6 GREEN.
- New cursors: `a9v1.<kid>.<payload>.<signature>`.
- Exact-key verification and explicit verify-only `a9v0` transition slot.
- No migration/provider/financial authority change.

## A15 checkpoint — machine access-token signing-key rotation

Evidence: `docs/evidence/application/2026-08-18-a15-machine-access-token-signing-key-rotation.md`.

- **322/322** application contracts.
- K7/A1-A9/A14 runtime regression GREEN.
- Database: **41 files / 1298 assertions**, K5/K6 GREEN.
- New Bearers carry active HS256 `kid`; exact selected-key verification only.
- Explicit legacy no-`kid` verify-only slot bounded by the 900-second token lifetime.
- No migration/provider/financial authority change.

## A14 hosted checkpoint — trusted ingress and abuse controls

Evidence: `docs/evidence/application/2026-08-18-a14-ingress-abuse-rate-limit-hardening.md`.

- **306/306** application contracts at A14 closure.
- Database: **41 files / 1298 assertions**, K5/K6 GREEN.
- Hosted migration applied.
- Exact trusted proxy, HMAC-obscured network subjects and distributed fixed-window PostgreSQL quotas.
- API app EXECUTE allowlist became exactly 24; worker remained 6.
- Hosted Security Advisor: 0 lints.

## A12-A13 observability foundation

Evidence:

- `docs/evidence/application/2026-08-17-a12-structured-runtime-logging-correlation.md`;
- `docs/evidence/application/2026-08-17-a13-operational-metrics-health-signals.md`.

Proven:

- closed-schema redacted JSONL logging;
- server-owned UUID request correlation;
- route-template-only HTTP completion logging;
- dependency-free bounded metrics;
- HTTP request/duration, readiness and worker-batch signals;
- loopback-only optional OpenMetrics scrape surfaces.

Remaining: external metrics collection, dashboards, alerts/SLO policy and distributed tracing.

Known compatibility debt remains: Fastify 5.11 emits `FSTDEP023` for top-level `disableRequestLogging`; migrate to `logController` before Fastify 6.

## A10-A11 provider safety boundary

Evidence:

- `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety.md`;
- `docs/evidence/application/2026-08-17-a11-strict-provider-http-transport.md`.

A10 requires exact provider/operation/environment/contract-lineage evidence before authorization. `current_contract_proven` alone cannot authorize traffic; sandbox requires `sandbox_proven` or stronger and production requires `production_enabled`.

A11 supplies a strict grant-derived HTTPS transport with public-address DNS validation/pinning, SNI/Host preservation, TLS verification, no redirects, no automatic retry, bounded I/O and conservative `transmission_unknown` semantics. A5 adapters remain unbound from it.

Default authorized retained-provider operations: **0**.

## Current provider evidence boundary

Acquisition criteria: `docs/evidence/providers/2026-08-18-provider-contract-evidence-acquisition-pack.md`.

Public evidence currently proves useful fragments, but not enough to authorize provider traffic:

- AkadPay: current Pix-IN/Pix-OUT material and Pix-OUT idempotency/replay identifiers are captured;
- AkkadPag legacy -> AkadPay current lineage/equivalence remains unproven;
- AkadPay complete query/recovery and cryptographic webhook verification remain incomplete;
- FlevoPay current public material shows Basic `PUBLIC_KEY:SECRET_KEY`, proving drift from the retained historical `X-API-Key` adapter;
- FlevoPay complete executable create/query/recovery/idempotency/webhook contract remains incomplete;
- authenticated current sandbox proof is absent for both retained paths.

Therefore A5 remains **FIXTURE-ONLY**, A11 remains unbound and A10 remains zero-authority.

## What remains for V1

The remaining weighted V1 engineering work is approximately **25%**, while roughly **40% of production launch capability/risk closure remains**. The remaining work is disproportionately risk-heavy.

### Critical PSP path

- provider-owned current AkkadPag/AkadPay lineage/equivalence;
- complete current selected provider auth/create/query/recovery/idempotency contract;
- cryptographically specified provider webhook ingress/authentication/replay contract;
- authenticated current PSP sandbox acceptance;
- deliberate A10 promotion to `sandbox_proven`;
- separately specified/tested A5 -> A11 bridge;
- provider webhook ingress and replay protection;
- ambiguous-execution recovery;
- authoritative provider reconciliation;
- controlled production activation and A10 `production_enabled` promotion;
- monetary canary and rollback proof.

### Production operations

- external telemetry collection, dashboards, alerts and SLOs;
- load/capacity testing and A14 limit tuning;
- final dependency/security/least-privilege review;
- secret/key rotation runbooks and drills;
- backup/restore and disaster-recovery drills;
- deploy/rollback/incident runbooks;
- production network/WAF hardening;
- cutover readiness.

### Product surface beyond the Pix core

- production-ready KYC merchant/admin workflow;
- payout/refund operational APIs and UX;
- hosted Pix checkout / Payment Links;
- broader reporting/analytics and settlement/payout UX.

## Safety invariants

- `main` remains intentionally untouched while PR #1 is draft.
- No retained PSP call is authorized by repository defaults.
- A5 fixture evidence never becomes runtime authority implicitly.
- A10 activation is explicit and exact-subject only.
- A11 transport existence alone grants no provider authority.
- `execution_unknown` is preserved rather than fabricated into definitive monetary failure.
- No live retained-provider call is permitted until current-contract, authenticated-sandbox and activation gates are satisfied.
