# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-15

This document is the executive checkpoint for answering one question: **how close is SwiftPay V2 to being usable and production-ready?**

It complements `TODOS.md`. The work ledger remains the detailed canonical backlog; this file intentionally presents the macro view.

## Executive status

The project is **not yet a runnable payment gateway application**. It currently has a mature, tested and deployed PostgreSQL/Supabase domain foundation, but the HTTP application layer, live provider adapters, worker process and merchant/admin UI have not yet been implemented.

Estimated readiness, using weighted engineering scope rather than raw checklist counts:

- **Core architecture/domain/database foundation:** ~90% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~40% complete.
- **Production-capable Pix V1:** ~30% complete.
- **Broader SwiftPay product vision** including checkout, payment links, conversion intelligence, payouts, automations and integrations: ~20–25% complete.

These percentages are planning estimates, not mechanically derived completion metrics. They are intentionally conservative because production payments require provider conformance, runtime failure handling, deployment, observability and operational acceptance in addition to database correctness.

## What exists today

### 1. Product and architecture — substantially complete

Defined and versioned:

- Pix-first V1 product direction;
- modular-monolith architecture;
- canonical Payment Core;
- provider-independent financial accounting;
- retained provider scope: AkkadPag + FlevoPay for Pix In, AkkadPag only for Pix Out;
- provider capability and failure semantics;
- public API, KYC, credentials, fees, webhooks, sandbox, reconciliation and selling-surface contracts;
- explicit engineering governance and test-first workflow.

### 2. Canonical database/domain foundation — implemented

The managed Supabase project contains the real V2 schema and migrations for:

- merchants and merchant members;
- KYC cases/documents;
- API credentials persistence;
- providers and provider accounts;
- request idempotency;
- payments;
- provider attempts/events;
- double-entry ledger and account balances;
- durable PostgreSQL jobs/outbox;
- merchant webhook endpoint/event/delivery persistence;
- payout accounts, payouts and payout attempts;
- refunds and refund attempts;
- payout/refund reservations;
- execution-unknown-safe payout claims;
- payout/refund evidence and terminal financial effects;
- internal reconciliation detection;
- durable reconciliation runs/discrepancies;
- normalized provider reconciliation evidence;
- append-only operational audit;
- dashboard membership authorization;
- private KYC Storage fences;
- least-privilege trusted API/worker PostgreSQL capability roles.

### 3. Database correctness/security — strongly proven

Current boundary after K4:

- **29 pgTAP files**;
- **973 database-contract tests**;
- latest GREEN: GitHub Actions run #121;
- **29 canonical migrations** deployed to managed Supabase;
- Supabase Security Advisor: **0 security lints** after K4;
- private `app` schema remains inaccessible to browser/Data API roles;
- `service_role` is not being used as a generic shortcut into the financial schema;
- trusted API/worker capability roles have explicit routine allowlists rather than table-wide access.

### 4. Financial safety primitives — implemented before runtime integration

Already proven at the database contract level:

- double-entry posting;
- deterministic source idempotency;
- non-negative merchant liability buckets;
- payout/refund amount reservation;
- one-shot payout execution claim/fencing;
- `execution_unknown` behavior instead of unsafe retry/release;
- exactly-once terminal payout/refund ledger effects;
- durable webhook-event materialization;
- reconciliation discrepancy lifecycle;
- append-only provider evidence and audit history.

This is important because these are expensive and dangerous primitives to retrofit after an API is already processing money.

## What does NOT exist yet

The following are the principal reasons the product is not currently usable as a gateway.

### Application/runtime layer

Not yet implemented:

- TypeScript/Fastify production API application;
- runtime configuration/bootstrap;
- trusted database LOGIN identities/deployment wiring;
- API authentication middleware;
- merchant/KYC capability middleware;
- HTTP error envelope/OpenAPI runtime;
- production worker process.

### Public API

Not yet implemented as HTTP endpoints:

- API credential issuance/rotation/revocation;
- `POST` Pix charge creation;
- Pix get/list;
- balance/read-model endpoints;
- webhook endpoint management;
- payout endpoints.

The contracts and persistence exist; the network-facing application does not.

### Real PSP execution

Not yet implemented:

- `AkkadPagAdapter`;
- `FlevoPayAdapter`;
- two-provider router;
- HTTP timeout/retry/recovery layer;
- authenticated provider webhook receivers;
- provider status normalization;
- provider-specific reconciliation fetchers.

Production enablement is additionally blocked on exact current provider evidence for identifiers, webhook authentication, recovery/idempotency and status vocabularies.

### Worker and outbound webhooks

Persistence and lease primitives exist, but runtime execution is still missing:

- job worker loop;
- provider recovery jobs;
- HMAC merchant webhook signing;
- HTTP delivery;
- SSRF protections;
- delivery retry/backoff and observability.

### Merchant/admin product

Not yet implemented:

- signup/onboarding UI;
- merchant dashboard;
- KYC screens;
- API-key management UI;
- sales/payment views;
- wallet/balance/statement views;
- provider/admin operational screens.

### Selling and revenue surfaces

Still pending:

- hosted checkout;
- payment links;
- Quick Pix;
- conversion funnel/events;
- UTM attribution;
- revenue insights;
- automation engine;
- UTMify/n8n/WhatsApp/Telegram integrations.

### Production operations/cutover

Still pending:

- production runtime deployment topology;
- secrets/credential provisioning;
- application observability;
- representative performance/load evidence;
- backup/recovery/operator runbooks;
- provider sandbox certification/conformance;
- migration/cutover dry runs;
- production acceptance and rollback plan.

## Weighted V1 engineering view

The percentages below are deliberately weighted by expected implementation/risk, not by number of files or TODO items.

| Workstream | Weight | Estimated completion | Contribution |
| --- | ---: | ---: | ---: |
| Product contracts / architecture / reverse engineering | 10% | 95% | 9.5% |
| Database + financial core | 20% | 95% | 19.0% |
| Supabase security/platform foundation | 10% | 90% | 9.0% |
| Trusted backend + public API runtime | 15% | 5% | 0.8% |
| Pix provider integrations + recovery | 15% | 10% | 1.5% |
| Worker + merchant webhook HTTP runtime | 10% | 15% | 1.5% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment/observability/cutover | 2% | 5% | 0.1% |

Weighted engineering foundation result: approximately **42%**.

For a **production-ready** assessment, provider conformance and operational deployment are hard gates, so the current practical production-readiness estimate is lower: approximately **30%**.

## Milestones from here

### Milestone A — platform foundation complete

Remaining primary work:

1. K5 deterministic local sandbox/seed fixtures;
2. K6 trusted API/worker production deployment topology;
3. representative performance/index review.

Expected state afterward: database/platform foundation can be considered essentially complete.

### Milestone B — first executable Pix slice

Build the smallest real payment path:

```text
API credential
-> POST /Pix payment
-> provider router
-> AkkadPag/FlevoPay adapter
-> QR Code / copy-paste Pix response
-> provider status/webhook
-> canonical paid transition
-> ledger posting
-> balance
-> merchant webhook delivery
```

At this point SwiftPay becomes a **real usable Pix gateway in sandbox/staging**, even before the broader merchant product is complete.

### Milestone C — merchant MVP

Add:

- signup/login;
- merchant creation;
- KYC submission/admin approval;
- API key management;
- transaction/sales dashboard;
- balance/wallet view;
- minimal admin operations.

At this point a merchant can onboard and operate the gateway without direct database intervention.

### Milestone D — production Pix V1

Hard requirements:

- exact retained-provider conformance evidence;
- provider sandbox/acceptance tests;
- deployment and secrets topology;
- webhook security/recovery;
- observability and alerting;
- payout operational flow if included in launch scope;
- load/performance evidence;
- runbooks and production acceptance.

### Milestone E — differentiated SwiftPay product

After the payment spine is stable:

- hosted checkout;
- payment links;
- Quick Pix;
- conversion intelligence;
- UTM attribution;
- recovery automations;
- merchant integrations.

This is where SwiftPay moves from "Pix gateway" to the intended **Payments + Conversion Intelligence + Revenue Automation** product.

## Current critical path

The fastest safe route to something visibly usable is now:

```text
K5 sandbox fixtures
-> K6 runtime/deployment contract
-> scaffold trusted TypeScript API + worker
-> API credential HTTP path
-> Pix create/get path with provider emulator
-> retained provider conformance
-> real provider adapters
-> paid transition + ledger + balance
-> merchant webhook delivery
-> minimal dashboard
```

The recommendation is to stop extending deep database foundation after K5/K6 unless a vertical-slice requirement exposes a concrete missing invariant. The next major engineering effort should move upward into the executable application layer.