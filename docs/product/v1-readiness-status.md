# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-15

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` remains the detailed engineering ledger. This file is intentionally macro-level and must distinguish foundation completion from product usability.

## Executive status

SwiftPay V2 is **not yet a runnable payment gateway application**, but the planned Phase 2 PostgreSQL/Supabase/security foundation is now essentially closed. K5 deterministic sandbox fixtures and K6 trusted runtime deployment topology are GREEN. The next active work is the executable TypeScript API + worker bootstrap defined by `docs/specs/executable-runtime-bootstrap-v0.yaml`.

Estimated readiness using weighted engineering/risk rather than raw checklist counts:

- **Core architecture/domain/database/platform foundation:** ~97% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~43% complete.
- **Production-capable Pix V1:** ~32% complete.
- **Broader SwiftPay product vision** including checkout, payment links, conversion intelligence, payouts, automations and integrations: ~20–25% complete.
- **Weighted V1 engineering completion:** ~44%.

These are planning estimates, not mechanically derived percentages. A production payments system remains gated by provider conformance, executable runtime behavior, failure recovery, observability, deployment and operational acceptance.

## What exists today

### Product/architecture contracts

Defined and versioned:

- Pix-first V1 and modular-monolith direction;
- canonical Payment Core;
- provider-independent financial accounting;
- AkkadPag + FlevoPay for V1 Pix In and AkkadPag-only V1 Pix Out;
- public API, API credentials, KYC, fees, webhooks, sandbox, reconciliation and selling-surface contracts;
- strict SDD/TDD/contract-driven engineering workflow.

### Canonical database/domain foundation

The managed Supabase project contains the V2 domain for:

- merchants, memberships and KYC;
- API credential persistence;
- providers/provider accounts;
- request idempotency;
- Payments, ProviderAttempts and ProviderEvents;
- double-entry ledger and balances;
- durable PostgreSQL jobs/outbox;
- merchant webhook persistence;
- payout/refund resources and financial reservations;
- one-shot payout execution fencing and `execution_unknown` handling;
- payout/refund authoritative evidence and exactly-once terminal effects;
- internal reconciliation and durable discrepancy lifecycle;
- normalized provider reconciliation evidence;
- append-only audit history;
- dashboard membership authorization;
- private KYC Storage fences;
- trusted API/worker least-privilege capability roles.

### Test/security boundary

Current GREEN boundary after K6:

- **29 database pgTAP files / 973 tests / PASS**;
- **1 deterministic sandbox fixture file / 20 tests / PASS**;
- **1 runtime-topology file / 27 tests / PASS**;
- GitHub Actions run #143 (`31865487612`) passed all three lanes;
- **29 canonical schema migrations** remain deployed to managed Supabase;
- last managed Security Advisor after K4: **0 security lints**;
- browser/Data API roles remain outside the private financial schema;
- API and worker have different capability roles rather than table-wide access;
- production-like K6 LOGIN identities successfully authenticated through their own PostgreSQL connections in CI.

K6 does **not** commit a managed password or activate a production runtime credential. Production password creation/rotation is deliberately left to the deployment secret channel.

### Financial safety already implemented

Proven at database-contract level:

- balanced double-entry posting;
- deterministic source idempotency;
- non-negative merchant liability buckets;
- payout/refund reservation;
- one-shot execution claim/fencing;
- unsafe monetary retry prevention through explicit unknown-result semantics;
- exactly-once terminal payout/refund effects;
- durable webhook-event materialization;
- append-only audit/provider evidence;
- reconciliation discrepancy lifecycle.

## What does not exist yet

The following remain the principal reasons SwiftPay cannot yet receive a Pix through the V2 application.

### Executable application layer

Not yet implemented:

- TypeScript workspace runtime;
- Fastify API process;
- production worker process;
- typed runtime configuration;
- PostgreSQL pools wired to K6 identities;
- HTTP liveness/readiness runtime;
- API auth/merchant/KYC middleware;
- public error/OpenAPI runtime.

The first bootstrap contract is now frozen as `docs/specs/executable-runtime-bootstrap-v0.yaml`.

### Public payment API

Not yet executable over HTTP:

- API key issuance/rotation/revocation;
- Pix create/get/list;
- balance endpoint/read model;
- webhook endpoint management;
- payout endpoints.

Persistence/contracts exist, network-facing handlers do not.

### Real PSP execution

Not yet implemented:

- `AkkadPagAdapter`;
- `FlevoPayAdapter`;
- capability-aware two-provider router;
- provider HTTP timeout/recovery semantics;
- authenticated provider webhook receiver;
- provider status normalization;
- provider reconciliation fetchers.

Current AkkadPag/FlevoPay provider-specific identity, recovery/idempotency, webhook authentication, status and rate-limit details remain evidence-gated until exact current documentation/sandbox behavior is captured. Legacy contracts are not silently promoted to current contracts.

### Worker/outbound HTTP

Database persistence and lease primitives exist, but runtime execution remains pending:

- durable job loop;
- provider recovery jobs;
- HMAC merchant webhook signing;
- SSRF-safe delivery;
- retry/backoff/observability.

### Merchant/admin product

Still pending:

- signup/onboarding UI;
- merchant dashboard;
- KYC UI;
- API-key management UI;
- sales/transaction view;
- wallet/balance/statement view;
- admin provider/operations surfaces.

### Differentiated selling/revenue layer

Still pending:

- hosted checkout;
- payment links;
- Quick Pix;
- conversion events/funnel;
- UTM attribution;
- revenue insights;
- automation engine;
- merchant integrations.

## Weighted V1 engineering view

| Workstream | Weight | Estimated completion | Contribution |
| --- | ---: | ---: | ---: |
| Product contracts / architecture / reverse engineering | 10% | 96% | 9.6% |
| Database + financial core | 20% | 97% | 19.4% |
| Supabase security/platform foundation | 10% | 98% | 9.8% |
| Trusted backend + public API runtime | 15% | 8% | 1.2% |
| Pix provider integrations + recovery | 15% | 10% | 1.5% |
| Worker + merchant webhook HTTP runtime | 10% | 15% | 1.5% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment/observability/cutover | 2% | 10% | 0.2% |

Weighted result: approximately **44%**.

The practical production-readiness estimate is intentionally lower, approximately **32%**, because real provider conformance and production application operations are hard gates.

## Milestones

### Milestone A — platform foundation

**Status: essentially complete.**

Completed:

- K5 deterministic local fixtures;
- K6 API/worker runtime identity topology;
- secret-free production role bootstrap;
- connection-level least-privilege acceptance tests.

Representative performance/index review remains workload-driven and should be performed when executable queries exist; it is not a reason to keep expanding the foundation before the vertical slice.

### Milestone B — first executable application runtime

Current active milestone:

```text
pnpm TypeScript workspace
-> Fastify API
-> separate worker
-> typed secret-safe configuration
-> K6 API database pool
-> K6 worker database pool
-> liveness/readiness acceptance tests
```

This milestone does not yet process money. Its purpose is to prove that the application can run without bypassing the database security model.

### Milestone C — first executable Pix slice

Then build:

```text
API credential
-> POST Pix payment
-> provider router/emulator
-> QR Code / copy-paste response
-> provider evidence/status
-> canonical paid transition
-> ledger posting
-> balance
-> merchant webhook delivery
```

At the emulator stage SwiftPay can prove the entire internal payment spine deterministically. Replacing the emulator with retained-provider adapters requires exact provider conformance evidence.

### Milestone D — merchant MVP

Add signup/login, merchant creation, KYC flow, API-key management, sales dashboard, balance/wallet view and minimal admin operations.

### Milestone E — production Pix V1

Hard gates include:

- exact AkkadPag/FlevoPay conformance;
- provider sandbox acceptance;
- real deployment secrets and runtime credentials;
- provider/merchant webhook recovery and security;
- observability/alerting;
- load/performance evidence;
- runbooks, rollback and production acceptance.

### Milestone F — differentiated SwiftPay

After the payment spine is stable: hosted checkout, links, Quick Pix, conversion intelligence, UTM attribution, recovery automations and integrations.

## Current critical path

```text
K7 executable runtime bootstrap  <- current
-> API credential HTTP slice
-> Pix create/get with deterministic provider emulator
-> paid transition + ledger + balance
-> merchant webhook HTTP delivery
-> retained provider conformance
-> AkkadPag/FlevoPay adapters
-> minimal merchant dashboard
-> production hardening
```

Rule from this checkpoint forward: do not extend the database foundation merely because more abstractions are possible. Add new database capabilities only when an executable vertical-slice contract demonstrates a concrete missing invariant.
