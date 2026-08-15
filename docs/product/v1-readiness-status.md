# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-15

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. This file separates foundation maturity from actual merchant usability. Percentages are planning estimates weighted by engineering effort, risk and unresolved integration surface; they are not raw TODO/file counts.

## Executive status

SwiftPay V2 now has an executable TypeScript API and worker runtime plus a fully accepted machine-to-machine authentication boundary. A merchant machine client can exchange an API credential for a short-lived Bearer token, and every protected-boundary authentication can revalidate current credential/merchant state in PostgreSQL.

The platform is **not yet a usable Pix gateway** because authenticated Pix create/get, provider execution, payment transition orchestration and merchant webhook delivery are not yet connected end to end.

Current estimate:

- **Core architecture/domain/database/platform foundation:** ~98% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~52% complete.
- **Production-capable Pix V1:** ~37% complete.
- **Weighted V1 engineering completion:** ~50% complete.
- **Broader SwiftPay product vision** including hosted checkout, payment links, conversion surfaces, richer payouts/automation/integrations: ~23–28% complete.

The practical reading is: **roughly half of the V1 engineering remains**. Most remaining risk is no longer schema/foundation work; it is product-path execution and operational hardening.

## What is already materially complete

### Product and architecture contracts

The repository already carries the canonical PRD/architecture/domain/API/provider/ledger/webhook/payout/reconciliation contracts needed to drive implementation without relying on chat history.

The target remains a Pix-first modular monolith with:

- Fastify trusted API;
- separate worker runtime;
- Supabase/PostgreSQL canonical source of truth;
- provider-agnostic Payment Core;
- append-only financial/audit boundaries;
- durable jobs and merchant webhook persistence;
- AkkadPag and FlevoPay retained as initial live PSP adapters, but not called before emulator/conformance gates.

### Database and financial foundation

The database already contains strongly tested foundations for:

- merchants, KYC/compliance and provider catalog;
- payment idempotency and provider events;
- ledger transactions/entries;
- durable jobs;
- merchant webhook persistence;
- payout/refund state and execution foundations;
- financial reservations;
- internal/provider reconciliation evidence;
- private KYC storage;
- append-only audit events;
- dashboard membership authorization;
- trusted runtime database capability roles.

Final post-A1 database CI on run `31872423956` is GREEN, including:

- canonical pgTAP lane: **31 files / 1050 tests / PASS**;
- K5 deterministic sandbox fixture lane: PASS;
- K6 runtime-topology lane: PASS.

### K5 — deterministic local sandbox fixtures

K5 is DONE.

The canonical seed deliberately creates deterministic non-financial sandbox identity/KYC/provider-catalog data and deliberately avoids pre-seeding API credentials, payments, ledger transactions, jobs and webhook events. A1 uses a separate test-only runtime fixture so the K5 invariant remains intact.

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

A1 is DONE and post-refactor GREEN.

The accepted boundary includes:

- `POST /v1/auth/token`;
- exact `client_credentials` grant;
- `scrypt-v1` Secret Key verification;
- HS256 access JWTs with 900-second TTL;
- exact-IP allowlists;
- PostgreSQL-atomic 10-successful-token/3600-second issuance quota;
- reusable Bearer authentication;
- current DB revalidation of credential status, merchant status, environment and `secret_version`;
- immediate old-token invalidation after credential revocation/version rotation;
- existence-indistinguishable invalid credential failures;
- no financial/async side effects.

Final application run `31872424000` is GREEN for typecheck, build, application contracts, K7 real runtime acceptance and A1 real runtime acceptance.

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

Credential create/rotate/revoke dashboard endpoints remain intentionally outside A1 and are still pending as a later management surface.

## Weighted V1 workstream estimate

| Workstream | Weight | Estimated completion | Weighted contribution |
|---|---:|---:|---:|
| Product contracts / architecture / reverse engineering | 10% | 96% | 9.6% |
| Database + financial core | 20% | 97% | 19.4% |
| Supabase security/platform foundation | 10% | 98% | 9.8% |
| Trusted backend + public API runtime | 15% | 40% | 6.0% |
| Pix provider integrations + recovery | 15% | 10% | 1.5% |
| Worker + merchant webhook HTTP runtime | 10% | 20% | 2.0% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0.0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment / observability / cutover | 2% | 12% | 0.2% |
| **Total** | **100%** |  | **~50%** |

This estimate intentionally does not award full credit to the backend workstream merely because authentication is complete. Public business endpoints, credential lifecycle management and payment orchestration still remain.

## Critical path from here

The current critical path is:

```text
K5 deterministic sandbox fixture                 DONE
  -> K6 trusted runtime topology                 DONE
  -> K7 executable API/worker runtime            DONE
  -> A1 API credential token authentication      DONE
  -> authenticated Pix create/get + emulator     NEXT
  -> paid transition + ledger + balance
  -> merchant webhook delivery runtime
  -> PSP conformance fixtures
  -> AkkadPag/FlevoPay live adapters
  -> dashboard operational surfaces
  -> production hardening / observability / cutover
```

## Next slice: `pix-create-get-emulator-v0`

The next implementation slice must remain provider-independent and deterministic before any live PSP call. Its minimum intended boundary is:

1. accept the authenticated A1 machine principal;
2. expose Pix create and get operations under the public API contract;
3. enforce merchant/environment ownership at the trusted boundary;
4. implement durable database idempotency for create;
5. drive a deterministic provider emulator rather than AkkadPag/FlevoPay;
6. persist the payment/provider-attempt state required to prove retries and duplicate behavior;
7. preserve zero direct client authority over financial state;
8. add RED application/database/runtime acceptance before implementation.

The precise behavior must be frozen in its own YAML spec before code is added.

## What still blocks a usable Pix sandbox MVP

The most important remaining gaps are:

- authenticated `POST /v1/transactions`/Pix create equivalent according to the canonical public API contract;
- authenticated payment get/status;
- deterministic emulator execution path;
- create idempotency proven across requests/processes;
- provider attempt and payment-state transition orchestration;
- paid transition posting into the ledger and merchant balance view;
- merchant webhook delivery worker/runtime with retries and signing;
- end-to-end sandbox acceptance from token → Pix create → status transition → ledger/balance → webhook.

Until those are connected, the system has a strong platform foundation but is not yet merchant-usable as a gateway.

## What still blocks production-capable Pix V1

Beyond the sandbox MVP, production readiness additionally requires:

- provider contract/conformance fixtures for AkkadPag and FlevoPay;
- live adapters behind the provider abstraction;
- provider webhook verification and replay handling;
- timeout/retry/recovery policy proven against PSP behavior;
- credential/provider-secret management and rotation operations;
- broader merchant/admin operational UI;
- production observability, alerting, SLOs and runbooks;
- deployment/cutover/rollback evidence;
- security and operational acceptance for the full money-moving path.

## Current truth in one sentence

**SwiftPay V2 has finished most of its architectural/database/security foundation and the first real public authentication boundary; approximately half of V1 engineering remains, with the next decisive milestone being an authenticated, idempotent Pix create/get flow against a deterministic provider emulator.**
