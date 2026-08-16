# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-15

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. Percentages here are planning estimates weighted by engineering effort, integration risk and unresolved operational surface; they are not raw file/TODO counts.

## Executive status

SwiftPay V2 now has an executable trusted API/worker runtime and a complete deterministic sandbox money-state path through authenticated Pix creation, canonical paid transition, exactly-once ledger posting and merchant balance read.

A merchant machine client can:

1. exchange API credentials for a 900-second Bearer token;
2. create a sandbox Pix Payment through `POST /v1/transactions`;
3. rely on database-backed idempotency across independent API processes;
4. receive deterministic emulator Pix data;
5. query the Payment through `GET /v1/transactions/:id`;
6. have trusted worker-side paid evidence transition the Payment to `paid` exactly once;
7. rely on an exactly-once balanced `settlement_paid` ledger posting;
8. query merchant funds through authenticated `GET /v1/balance`.

A3 also writes the durable canonical `payment.paid` merchant-webhook outbox event transactionally with the money-state transition. What is still missing from the sandbox lifecycle is the HTTP delivery runtime that signs, retries and terminally records merchant webhook delivery.

Current estimate:

- **Core architecture/domain/database/platform foundation:** ~98% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~82% complete.
- **Production-capable Pix V1:** ~45% complete.
- **Weighted V1 engineering completion:** ~59% complete.
- **Broader SwiftPay product vision** including hosted checkout, payment links, richer merchant/admin surfaces, broader payout automation and integrations: ~29–34% complete.

The critical risk has moved from canonical financial correctness to **asynchronous merchant delivery, live-provider conformance/recovery, operational product surfaces and production hardening**.

## Materially complete

### Product / architecture / reconstruction contracts

The repository remains the canonical implementation source and carries PRD, architecture, ADRs, domain/public/provider/ledger/webhook contracts, specs, migrations, tests and evidence.

Target architecture remains:

- Pix-first TypeScript modular monolith;
- Fastify trusted API;
- separate trusted worker;
- Supabase/PostgreSQL canonical state;
- provider-agnostic Payment Core;
- append-oriented financial/audit semantics;
- durable jobs and merchant webhook outbox/delivery persistence;
- AkkadPag and FlevoPay retained as initial live PSP targets behind conformance gates.

### Database / financial foundation

Strongly tested foundations exist for merchant/KYC/provider identity, machine API credentials, idempotency/provider evidence, Payment/ProviderAttempt, double-entry ledger, durable jobs, merchant webhook persistence, payout/refund foundations, financial reservations, reconciliation, private KYC storage, append-only audit events, dashboard authorization and trusted runtime roles.

Final A3 database acceptance workflow `31885388900` is GREEN:

- **35 files / 1209 pgTAP tests / PASS**;
- K5 deterministic sandbox fixture lane: PASS;
- K6 runtime-topology / least-privilege lane: PASS.

### K5 / K6 / K7 — trusted executable platform

K5, K6 and K7 are DONE.

The canonical seed remains non-financial. API and worker use separate capability identities. Node.js 24/Fastify API and worker runtimes execute against real production-like database roles in acceptance.

Evidence:

- `docs/evidence/supabase/2026-08-15-k5-local-sandbox-seed-fixtures.md`
- `docs/evidence/supabase/2026-08-15-k6-trusted-runtime-deployment-topology.md`
- `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`

### A1 — API credential token authentication — DONE

Accepted boundary includes `POST /v1/auth/token`, canonical `scrypt-v1` verification, 900-second HS256 tokens, exact-IP allowlists, PostgreSQL-atomic issuance quota, current DB Bearer revalidation and immediate invalidation after credential revoke/version rotation.

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

### A2 — authenticated Pix create/get + deterministic emulator — DONE

Accepted behavior includes authenticated create/get, strict ownership and request validation, required idempotency, durable Payment/ProviderAttempt before execution, atomic attempt claim, deterministic visibly non-payable emulator output and safe replay/conflict/unknown/rejection semantics.

Canonical hosted A2 migrations:

- `20260815101512_pix_create_get_emulator_foundation.sql`
- `20260815101609_pix_create_get_emulator_behavior.sql`
- `20260815101641_pix_create_get_emulator_prepare_key_count_fix.sql`
- `20260815101729_pix_create_get_emulator_resolve_coalesce_fix.sql`

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

### A3 — paid transition + ledger + merchant balance — DONE

Spec: `docs/specs/paid-transition-ledger-balance-v0.yaml`.

A3 closes the first canonical money-state path:

- only `swiftpay_worker` may submit deterministic sandbox paid evidence;
- Payment row lock serializes concurrent paid observations;
- ProviderEvent identity makes evidence replay durable;
- eligible `pending`/`expired` Pix transitions to `paid`;
- exactly one `settlement_paid` double-entry ledger transaction posts per Payment;
- duplicate/concurrent valid evidence cannot double-credit merchant funds;
- merchant net is credited into `merchant_pending_liability`, not prematurely marked withdrawable;
- authenticated `GET /v1/balance` derives merchant/environment only from A1 Bearer revalidation;
- paid Payment remains merchant-safe and retains normalized Pix data;
- canonical `payment.paid` webhook outbox event is written transactionally for A4.

Final application/runtime workflow `31885388887` is GREEN:

- **104/104 application contracts**;
- K7 real runtime acceptance: GREEN;
- A1 real runtime acceptance: GREEN, quota race `200/429`;
- A2 real runtime acceptance: GREEN, create race `201/202`;
- A3 real runtime acceptance: GREEN, paid-evidence race `applied/absorbed`.

Canonical hosted Supabase A3 migrations:

- `20260816004515_paid_transition_ledger_balance_foundation.sql`
- `20260816004620_paid_transition_ledger_balance_behavior.sql`

Remote post-apply validation confirms exact API/worker EXECUTE segregation, no migration-created financial postings/events, and zero Supabase Security Advisor lints. Git migration filenames are aligned to hosted history without SQL-content drift.

Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

## Weighted V1 workstream estimate

| Workstream | Weight | Estimated completion | Weighted contribution |
|---|---:|---:|---:|
| Product contracts / architecture / reverse engineering | 10% | 96% | 9.6% |
| Database + financial core | 20% | 99% | 19.8% |
| Supabase security/platform foundation | 10% | 98% | 9.8% |
| Trusted backend + public API runtime | 15% | 78% | 11.7% |
| Pix provider integrations + recovery | 15% | 30% | 4.5% |
| Worker + merchant webhook HTTP runtime | 10% | 25% | 2.5% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0.0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment / observability / cutover | 2% | 12% | 0.2% |
| **Total** | **100%** |  | **~59%** |

The emulator and A3 financial path materially increase confidence in the provider-independent core, but they are not live PSP integration. Provider-conformance/live-adapter completion therefore remains intentionally low.

## Critical path

```text
K5 deterministic sandbox fixture                 DONE
  -> K6 trusted runtime topology                 DONE
  -> K7 executable API/worker runtime            DONE
  -> A1 API credential token authentication      DONE
  -> A2 authenticated Pix create/get + emulator  DONE
  -> A3 paid transition + ledger + balance       DONE
  -> A4 merchant webhook delivery runtime        NEXT
  -> PSP conformance fixtures
  -> AkkadPag/FlevoPay live adapters
  -> dashboard operational surfaces
  -> production hardening / observability / cutover
```

## Next slice: A4 merchant webhook delivery runtime

A4 must consume the durable outbox/delivery state without introducing financial authority into the HTTP delivery worker.

Minimum boundary to freeze before implementation:

1. atomic worker claim/lease semantics for delivery work;
2. deterministic merchant webhook HTTP request and signature format;
3. signing-secret access/isolation and log redaction;
4. success/retry/backoff/terminal failure state machine;
5. safe concurrent-worker and replay behavior;
6. deterministic local merchant endpoint acceptance;
7. no Payment/Ledger mutation from delivery processing;
8. operational evidence sufficient to unblock provider-conformance work.

Implementation does not start until A4 Problem Analysis, YAML specification and RED contracts are versioned.

## What still blocks a complete Pix sandbox MVP

The decisive remaining gap is A4:

- claim durable `payment.paid` delivery work;
- sign and send merchant HTTP webhooks;
- retry/backoff correctly;
- represent terminal failure/dead-letter state;
- prove the end-to-end sandbox chain token -> create -> paid -> ledger/balance -> webhook.

The canonical payment and financial lifecycle through paid/balance is now present; merchant asynchronous delivery is the missing lifecycle leg.

## What still blocks production-capable Pix V1

Beyond A4, production readiness requires:

- provider contract/conformance fixtures for AkkadPag and FlevoPay;
- live adapters behind the provider abstraction;
- live provider webhook verification/replay handling;
- timeout/retry/unknown/recovery policy proven against real PSP behavior;
- provider credential/secret management and rotation operations;
- merchant/admin operational UI;
- observability, alerting, SLOs and runbooks;
- deployment/cutover/rollback evidence;
- final security/operational acceptance of the complete money-moving path.

## Current truth in one sentence

**SwiftPay V2 now has an authenticated, idempotent sandbox Pix flow through exactly-once paid transition, double-entry ledger posting and merchant balance; weighted V1 engineering is ~59%, and A4 merchant webhook HTTP delivery is the next critical slice.**
