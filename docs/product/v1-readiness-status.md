# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-15

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. Percentages here are planning estimates weighted by engineering effort, integration risk and unresolved operational surface; they are not raw file/TODO counts.

## Executive status

SwiftPay V2 now has an executable trusted API/worker runtime, accepted machine-to-machine authentication, and its first real authenticated Pix business path.

A merchant machine client can:

1. exchange API credentials for a 900-second Bearer token;
2. create a sandbox Pix Payment through `POST /v1/transactions`;
3. rely on database-backed idempotency across independent API processes;
4. receive deterministic emulator Pix data;
5. query the same Payment through `GET /v1/transactions/:id`.

The platform is **not yet a complete Pix gateway** because no canonical provider/emulator paid transition currently posts ledger effects or merchant balance, merchant webhook delivery is not connected, and live PSP adapters remain gated behind conformance work.

Current estimate:

- **Core architecture/domain/database/platform foundation:** ~98% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~68% complete.
- **Production-capable Pix V1:** ~42% complete.
- **Weighted V1 engineering completion:** ~56% complete.
- **Broader SwiftPay product vision** including hosted checkout, payment links, richer merchant/admin surfaces, broader payout automation and integrations: ~26–31% complete.

The practical reading is: the architectural/security/database risk has largely been retired, authentication and Pix creation are now real, and the critical risk has moved to **money-state transition, exactly-once ledger posting, asynchronous delivery and live-provider behavior**.

## What is already materially complete

### Product and architecture contracts

The repository is the canonical implementation source and carries PRD, architecture, ADRs, domain contracts, public API/provider/ledger/webhook contracts, specs, migrations, tests and evidence.

The target remains a Pix-first modular monolith with:

- Fastify trusted API;
- separate worker runtime;
- Supabase/PostgreSQL canonical source of truth;
- provider-agnostic Payment Core;
- append-only financial/audit boundaries;
- durable jobs and merchant webhook persistence;
- AkkadPag and FlevoPay retained as initial live PSP adapters, but blocked behind emulator/conformance gates.

### Database and financial foundation

Strongly tested foundations exist for:

- merchants, KYC/compliance and provider catalog;
- machine API credentials;
- payment idempotency and provider evidence;
- canonical Payment/ProviderAttempt state;
- ledger transactions/entries;
- durable jobs;
- merchant webhook persistence;
- payout/refund state and execution foundations;
- financial reservations;
- reconciliation operations/evidence;
- private KYC storage;
- append-only audit events;
- dashboard membership authorization;
- trusted runtime database capability roles.

Final A2 database acceptance workflow `31877334073` is GREEN:

- canonical pgTAP lane: **33 files / 1140 tests / PASS**;
- K5 deterministic sandbox fixture lane: PASS;
- K6 runtime-topology lane: PASS.

### K5 — deterministic local sandbox fixtures

K5 is DONE.

The canonical seed creates deterministic non-financial identity/KYC/provider-catalog data and deliberately avoids pre-seeding API credentials, payments, ledger transactions, jobs and merchant webhook events. A1/A2 runtime fixtures remain separate; the A2 emulator provider account is not hosted production-like business data.

Evidence: `docs/evidence/supabase/2026-08-15-k5-local-sandbox-seed-fixtures.md`.

### K6 — trusted runtime deployment topology

K6 is DONE.

API and worker use separate PostgreSQL runtime identities/capabilities. Browser/Data API/service-role paths do not become trusted financial authority, and API/worker capabilities remain segregated.

Evidence: `docs/evidence/supabase/2026-08-15-k6-trusted-runtime-deployment-topology.md`.

### K7 — executable runtime bootstrap

K7 is DONE.

SwiftPay has:

- Node.js 24 LTS workspace;
- pinned/frozen pnpm dependencies;
- executable Fastify API;
- separate executable worker;
- liveness/readiness behavior;
- strict independent API/worker database configuration;
- real K6 identity acceptance against isolated PostgreSQL.

Evidence: `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`.

### A1 — API credential token authentication

A1 is DONE.

Accepted boundary:

- `POST /v1/auth/token`;
- exact `client_credentials` grant;
- `scrypt-v1` Secret Key verification;
- HS256 access JWTs with 900-second TTL;
- exact-IP allowlists;
- PostgreSQL-atomic 10-successful-token/3600-second issuance quota;
- current DB revalidation of credential/merchant/environment/secret-version state;
- immediate old-token invalidation after revocation/version rotation;
- existence-indistinguishable invalid credential failures;
- no payment/ledger/job/webhook side effects.

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

### A2 — authenticated Pix create/get + deterministic emulator

A2 is DONE.

Accepted public/runtime behavior:

- authenticated `POST /v1/transactions`;
- authenticated `GET /v1/transactions/:id`;
- strict merchant/environment ownership;
- required and normalized `Idempotency-Key`;
- deterministic canonical request hash;
- durable PostgreSQL idempotency;
- Payment/ProviderAttempt persistence before emulator execution;
- PostgreSQL-atomic attempt claim;
- visibly non-payable deterministic emulator Pix output;
- success/pending, execution-unknown and definitive-rejection outcomes;
- replay without duplicate execution;
- 409 for idempotency-key reuse with a different canonical request;
- production create blocked before side effects;
- no ledger/jobs/merchant-webhook/provider-event effects in this slice.

The real acceptance starts two independent API processes against one PostgreSQL database and proves the create race converges safely. Final CI logged:

`A2 create race statuses: 201/202`

`SwiftPay A2 real runtime acceptance: OK`

Final application workflow `31877334094` is GREEN with **91/91 application contracts**, K7, A1 and A2 real runtime acceptance.

Canonical A2 hosted Supabase migrations:

- `20260815101512_pix_create_get_emulator_foundation.sql`;
- `20260815101609_pix_create_get_emulator_behavior.sql`;
- `20260815101641_pix_create_get_emulator_prepare_key_count_fix.sql`;
- `20260815101729_pix_create_get_emulator_resolve_coalesce_fix.sql`.

Remote validation confirms the six A2 schema columns, four trusted routines, API-only execution boundary, PostgreSQL-17-compatible key counting and native `coalesce(...)` resolution behavior.

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

## Weighted V1 workstream estimate

| Workstream | Weight | Estimated completion | Weighted contribution |
|---|---:|---:|---:|
| Product contracts / architecture / reverse engineering | 10% | 96% | 9.6% |
| Database + financial core | 20% | 97% | 19.4% |
| Supabase security/platform foundation | 10% | 98% | 9.8% |
| Trusted backend + public API runtime | 15% | 65% | 9.8% |
| Pix provider integrations + recovery | 15% | 25% | 3.8% |
| Worker + merchant webhook HTTP runtime | 10% | 20% | 2.0% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0.0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment / observability / cutover | 2% | 12% | 0.2% |
| **Total** | **100%** |  | **~56%** |

The emulator increases confidence in provider-independent payment orchestration but does not count as a live PSP integration. Provider-conformance/live-adapter completion therefore remains intentionally low.

## Critical path from here

```text
K5 deterministic sandbox fixture                 DONE
  -> K6 trusted runtime topology                 DONE
  -> K7 executable API/worker runtime            DONE
  -> A1 API credential token authentication      DONE
  -> A2 authenticated Pix create/get + emulator  DONE
  -> A3 paid transition + ledger + balance       NEXT / IN PROGRESS
  -> A4 merchant webhook delivery runtime
  -> PSP conformance fixtures
  -> AkkadPag/FlevoPay live adapters
  -> dashboard operational surfaces
  -> production hardening / observability / cutover
```

## Next slice: `paid-transition-ledger-balance-v0`

A3 must establish the money-moving invariant before merchant webhook delivery or live PSP integration.

Minimum intended boundary:

1. accept canonical paid evidence from the emulator/provider-independent boundary;
2. transition an eligible pending Payment to `paid` exactly once;
3. preserve replay-safe evidence identity;
4. post one balanced ledger transaction exactly once;
5. ensure duplicate/concurrent evidence cannot double-credit merchant funds;
6. expose the merchant balance/read model through a narrow trusted boundary;
7. prove payment transition + ledger posting atomicity;
8. hand off a durable paid event/state for the later merchant-webhook slice.

The precise transition, account mapping, fee treatment, evidence identity and API surface must be frozen in YAML before implementation.

## What still blocks a complete Pix sandbox MVP

The most important remaining gaps are:

- canonical pending -> paid transition from provider/emulator evidence;
- exactly-once balanced ledger posting;
- merchant balance/read model;
- merchant webhook delivery worker/runtime with retries and signing;
- end-to-end sandbox acceptance from token -> create -> paid transition -> ledger/balance -> webhook.

Pix **creation/status** is now usable in the deterministic sandbox boundary; the full payment lifecycle is not yet complete.

## What still blocks production-capable Pix V1

Beyond the sandbox lifecycle, production readiness additionally requires:

- provider contract/conformance fixtures for AkkadPag and FlevoPay;
- live adapters behind the provider abstraction;
- provider webhook verification and replay handling;
- timeout/retry/recovery policy proven against real PSP behavior;
- credential/provider-secret management and rotation operations;
- broader merchant/admin operational UI;
- production observability, alerting, SLOs and runbooks;
- deployment/cutover/rollback evidence;
- security and operational acceptance for the full money-moving path.

## Current truth in one sentence

**SwiftPay V2 has completed its first authenticated, idempotent Pix create/get flow against a deterministic provider emulator; weighted V1 engineering is now ~56%, and the decisive next milestone is an exactly-once paid transition that atomically posts the ledger and exposes merchant balance.**
