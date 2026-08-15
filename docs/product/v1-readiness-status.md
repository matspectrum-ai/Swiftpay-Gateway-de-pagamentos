# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-15

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. This file intentionally separates foundation maturity from actual merchant usability.

## Executive status

SwiftPay V2 now has an **executable TypeScript API and worker runtime**, but it is **not yet a usable Pix gateway**. The database/financial/security foundation is essentially complete, and K7 proved that the real API and worker binaries can run against their separate K6 PostgreSQL identities without bypassing least privilege.

The next missing product boundary is API credential management/authentication. After that, work moves directly into Pix create/get and the provider execution path.

Estimated readiness, weighted by engineering effort and risk rather than raw file/TODO counts:

- **Core architecture/domain/database/platform foundation:** ~98% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~47% complete.
- **Production-capable Pix V1:** ~34% complete.
- **Weighted V1 engineering completion:** ~47%.
- **Broader SwiftPay product vision** including checkout, links, conversion intelligence, payouts, automations and integrations: ~22–27% complete.

These are planning estimates. Provider conformance, real payment execution, recovery, webhooks, observability, deployment and operational acceptance remain hard production gates.

## What exists now

### Product and architecture

Defined and versioned:

- Pix-first V1;
- modular-monolith architecture;
- canonical Payment Core;
- provider-independent accounting;
- AkkadPag + FlevoPay for V1 Pix In;
- AkkadPag-only V1 Pix Out;
- public API, credentials, KYC, fees, webhooks, sandbox, reconciliation and selling-surface contracts;
- strict SDD/TDD/contract-driven workflow.

### Database / financial core

Implemented and tested:

- merchants and memberships;
- KYC cases/documents and private Storage fences;
- API credential persistence model;
- providers/provider accounts;
- request idempotency;
- Payments, ProviderAttempts and ProviderEvents;
- double-entry ledger and cached balances;
- durable PostgreSQL jobs/outbox;
- merchant webhook persistence;
- payouts/refunds and atomic reservations;
- one-shot payout execution fencing;
- `execution_unknown` safety semantics;
- authoritative payout/refund evidence and exactly-once terminal financial effects;
- internal reconciliation and durable discrepancy lifecycle;
- normalized provider reconciliation evidence;
- append-only operational audit;
- Supabase Auth dashboard membership authorization;
- least-privilege API/worker capability roles.

### Platform/security proof

Current preserved database boundary:

- **29 pgTAP files / 973 tests / PASS**;
- **1 sandbox fixture file / 20 tests / PASS**;
- **1 K6 runtime-topology file / 27 tests / PASS**;
- **29 canonical migrations** deployed to the managed Supabase project;
- last managed Supabase Security Advisor: **0 security lints**;
- browser/Data API roles remain outside the private `app` schema;
- `service_role` is not used as a generic financial-schema shortcut.

Database-contract run #161 (`31866431232`) re-proved all three lanes after K7.

### Executable application runtime — K7 DONE

SwiftPay now contains:

```text
apps/api
apps/worker
packages/config
packages/db
```

Runtime baseline:

- Node.js 24 LTS;
- pnpm `11.17.0` with committed frozen lockfile;
- Fastify 5 API;
- `pg` PostgreSQL driver;
- strict TypeScript workspace;
- separate API and worker database URLs;
- bounded database timeouts;
- secret-safe configuration errors;
- structured API logging with sensitive-field redaction.

API behavior:

- `GET /health/live` is process-only and never queries PostgreSQL;
- `GET /health/ready` proves the K6 API database boundary;
- wrong identity/database failure returns sanitized `503`.

Worker behavior:

- `--check` proves the K6 worker identity and exits deterministically;
- wrong identity fails closed;
- no durable job-processing loop exists yet.

Application run #14 (`31866431229`) passed both jobs, including a real isolated PostgreSQL acceptance test using `swiftpay_api_runtime` and `swiftpay_worker_runtime`. The test also proved zero Payment/job/ledger/webhook-event side effects.

K7 evidence: `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`.

## What is still missing

### API authentication and credential lifecycle

Next active boundary:

- dashboard/API credential issuance;
- raw secret returned exactly once;
- verification/authentication of merchant API requests;
- rotation/revocation;
- audit integration;
- HTTP endpoints and error contracts.

The persistence contract exists, but this behavior is not yet exposed through the executable API.

### Pix HTTP/payment execution

Still missing:

- `POST` Pix creation;
- Pix get/list;
- request authentication/idempotency middleware;
- provider-independent application orchestration;
- QR Code/copy-paste response;
- canonical paid transition orchestration;
- balance HTTP/read model.

### Real PSP execution

Still missing:

- `AkkadPagAdapter`;
- `FlevoPayAdapter`;
- capability-aware provider router;
- timeout/recovery layer;
- authenticated provider webhook receiver;
- provider status normalization;
- provider reconciliation fetchers.

The current exact AkkadPag/FlevoPay contracts remain evidence-gated where documentation/sandbox behavior has not been proven. Legacy provider behavior is not silently promoted to current behavior.

### Worker and outbound merchant webhooks

Persistence and leasing exist, but runtime behavior still needs:

- durable worker claim loop;
- provider recovery jobs;
- HMAC merchant webhook signing;
- SSRF-safe HTTP delivery;
- retry/backoff and observability.

### Merchant/admin UI

Still pending:

- onboarding/login experience;
- KYC screens;
- API key management UI;
- sales/payment dashboard;
- wallet/balance/statement view;
- minimal admin operations.

### Differentiated SwiftPay layer

Still pending:

- hosted checkout;
- payment links;
- Quick Pix;
- conversion funnel/events;
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
| Trusted backend + public API runtime | 15% | 20% | 3.0% |
| Pix provider integrations + recovery | 15% | 10% | 1.5% |
| Worker + merchant webhook HTTP runtime | 10% | 20% | 2.0% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment/observability/cutover | 2% | 12% | 0.2% |

Weighted result: approximately **47%**.

Practical production readiness remains lower, approximately **34%**, because provider conformance and live operational controls are hard gates.

## Milestones

### Milestone A — platform foundation

**Status: essentially complete.**

K1–K6 are closed. Performance/index tuning stays workload-driven and will follow representative executable queries rather than speculative optimization.

### Milestone B — executable application runtime

**Status: DONE (K7).**

```text
frozen pnpm workspace
-> Fastify API
-> separate worker
-> typed secret-safe configuration
-> K6 API/worker database identities
-> real liveness/readiness acceptance
```

This runs, compiles and connects correctly, but does not yet process money.

### Milestone C — authenticated payment spine

Current path:

```text
API credential HTTP lifecycle
-> merchant API authentication
-> Pix create/get
-> deterministic provider emulator
-> provider evidence/status
-> canonical paid transition
-> ledger
-> balance
-> merchant webhook delivery
```

Once this is GREEN with the emulator, SwiftPay has a deterministic end-to-end Pix sandbox spine independent of an external PSP.

### Milestone D — retained PSP integration

Replace the emulator only after exact conformance evidence:

```text
AkkadPag/FlevoPay contract proof
-> adapter tests
-> controlled Pix In acceptance
-> query/recovery
-> provider webhook normalization
-> external reconciliation
```

### Milestone E — merchant MVP

Signup/login, merchant/KYC operation, API-key management, transaction dashboard, balance/wallet view and minimal admin.

### Milestone F — production Pix V1

Hard gates include provider acceptance, production secrets/runtime credentials, webhook recovery/security, observability/alerting, representative load evidence, runbooks and rollback/production acceptance.

### Milestone G — differentiated SwiftPay

Hosted checkout, payment links, Quick Pix, conversion intelligence, UTM attribution, recovery automations and integrations.

## Current critical path

```text
K7 executable runtime                 DONE
-> API credential HTTP/auth           CURRENT
-> Pix create/get + emulator
-> paid transition + ledger + balance
-> merchant webhook delivery
-> retained-provider conformance
-> AkkadPag/FlevoPay adapters
-> minimal merchant dashboard
-> production hardening
```

Rule from this checkpoint forward: new database capabilities are added only when an executable vertical-slice contract proves they are necessary.
