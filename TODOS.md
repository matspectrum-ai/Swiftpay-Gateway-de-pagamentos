# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-15

This is the durable backlog and handoff ledger for the reconstruction. Repository artifacts are the source of truth. Detailed implementation proof lives in specs, migrations, tests and `docs/evidence/**`; Git history preserves checkpoint chronology.

Executive readiness checkpoint: `docs/product/v1-readiness-status.md`.

## States

- `PENDING`: known, not started
- `IN_PROGRESS`: actively being worked
- `EVIDENCE_REQUIRED`: implementation exists but closure evidence is incomplete
- `BLOCKED`: cannot proceed without an external dependency or unresolved contract
- `DONE`: contract, implementation and required evidence are complete
- `DEFERRED`: intentionally outside the current critical path
- `DROPPED`: explicitly removed from scope
- `SUPERSEDED`: replaced by a later canonical artifact

## Current checkpoint

- Branch: `agent/foundation-phase-0`
- Draft PR: #1 — `foundation: establish SwiftPay V2 reconstruction baseline`
- `main`: intentionally untouched by this workstream
- Canonical hosted Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
- A3 migration alignment commit: `0f1027dd045dbe6fa8b3fca6ab27b6ff8ddcb485`
- A3 evidence commit: `e8342281757b04c2ceb14e1db2a2576466038682`
- Final pre-sync A3 Application workflow: `31885388887` — GREEN
- Final pre-sync A3 Database workflow: `31885388900` — GREEN
- Canonical database lane: 35 files / 1209 pgTAP tests / PASS
- Application contract lane: 104 tests / PASS
- Real A3 paid-evidence race: `applied/absorbed`
- Weighted V1 engineering estimate: ~59%
- First end-to-end Pix sandbox MVP estimate: ~82%
- Production-capable Pix V1 estimate: ~45%
- Current critical slice: A4 merchant webhook delivery runtime

## Non-negotiable delivery method

Every new behavior follows this order:

1. Problem Analysis
2. YAML Specification
3. Contracts/interfaces
4. Tests first — RED
5. Minimal implementation — GREEN
6. Refactor without behavior drift
7. Evidence + handoff update

No live PSP integration is allowed to bypass deterministic emulator and provider-conformance gates. No merchant/browser surface receives direct financial authority.

---

# Phase 0 — Reconstruction truth and target architecture

## Product/reverse-engineering baseline — `DONE`

Canonical artifacts establish the intended SwiftPay V2 shape:

- Pix-first payment gateway/fintech platform;
- modular TypeScript monolith;
- Fastify trusted API and separate worker;
- Supabase/PostgreSQL canonical state;
- provider-agnostic Payment Core;
- append-oriented financial/audit semantics;
- durable jobs and merchant webhooks;
- initial retained live Pix providers: AkkadPag and FlevoPay;
- dashboard/admin/checkout as separate product surfaces.

The repository contains PRD, architecture, ADRs, domain/public/provider/ledger/webhook contracts, specs, tests and evidence sufficient for an implementation agent to work without chat context.

---

# Phase 1 — Database and financial core

## Identity, compliance and provider catalog — `DONE`

## Payment idempotency and provider events — `DONE`

## Ledger foundation — `DONE`

Append-oriented double-entry transaction/entry persistence, account balance caching/locking and integrity checks are established.

## Durable jobs — `DONE`

Persistence/claim foundations exist for reliable asynchronous work.

## Merchant webhook persistence — `DONE`

Durable webhook event/delivery state and job fanout persistence exist. HTTP delivery runtime is A4.

## Payout/refund database foundations — `DONE`

Database state machines, policy snapshots, reservations, execution claims and resolutions exist. Merchant-usable application/API/UI workflows remain `PENDING`.

## Reconciliation foundations — `DONE`

Internal/provider-evidence foundations exist. Live-provider reconciliation adapters remain gated by PSP conformance.

---

# Phase 2 — Supabase security and trusted runtime foundation

## K1 — private schema / Data API boundary — `DONE`

Browser/Data API/default roles do not receive direct authority over private financial state.

## K2 — append-only audit events — `DONE`

Evidence: `docs/evidence/supabase/2026-08-15-k2-audit-events.md`.

## K3 — dashboard membership authorization — `DONE`

Evidence: `docs/evidence/supabase/2026-08-15-k3-dashboard-membership-authorization.md`.

## K4 — trusted runtime database boundary — `DONE`

Separate least-privilege API/worker capability roles are established.

Evidence: `docs/evidence/supabase/2026-08-15-k4-trusted-runtime-database-boundary.md`.

## K5 — deterministic local sandbox seed fixtures — `DONE`

Canonical local seed remains deterministic and non-financial. Runtime/API credentials, Payments, Ledger transactions, jobs and merchant webhook events are not pre-seeded. A1/A2/A3 use separate TEST-ONLY acceptance fixtures.

Evidence: `docs/evidence/supabase/2026-08-15-k5-local-sandbox-seed-fixtures.md`.

## K6 — trusted runtime deployment topology — `DONE`

API and worker identities are separate and capability-scoped; cross-membership and broad table authority are rejected.

Evidence: `docs/evidence/supabase/2026-08-15-k6-trusted-runtime-deployment-topology.md`.

## K7 — executable runtime bootstrap — `DONE`

Node.js 24 TypeScript workspace, pinned pnpm, Fastify API, separate worker, liveness/readiness and real role-boundary acceptance are operational.

Evidence: `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`.

---

# Phase 3 — Public API authentication and deterministic Pix lifecycle

## A1 — API credential token exchange and Bearer authentication — `DONE`

Spec: `docs/specs/api-credential-token-exchange-v0.yaml`.

Accepted boundary:

- `POST /v1/auth/token`;
- `client_credentials` only;
- canonical `scrypt-v1` Secret Key verifier;
- HS256 JWT, issuer `swiftpay`, audience `swiftpay-api`, TTL 900 seconds;
- exact-IP allowlist;
- PostgreSQL-atomic 10-successful-token/3600-second quota;
- current database revalidation;
- immediate revoke/secret-version invalidation;
- narrow trusted routines only;
- no financial/async side effects.

Canonical migrations:

- `20260815052828_api_credential_token_auth_foundation.sql`
- `20260815054302_api_credential_token_auth_behavior.sql`

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

Credential create/rotate/revoke management UI/API and signing-key-ring rotation remain `PENDING`.

## A2 — `pix-create-get-emulator-v0` — `DONE`

Specs:

- `docs/specs/pix-create-get-emulator-v0.yaml`
- `docs/specs/pix-create-get-emulator-fixture-v0.yaml`

Accepted boundary:

- authenticated `POST /v1/transactions`;
- authenticated `GET /v1/transactions/:id`;
- Bearer revalidation first;
- sandbox-only create;
- strict request validation and canonical hashing;
- required merchant/environment-scoped `Idempotency-Key`;
- durable Payment + ProviderAttempt before execution;
- atomic attempt claim;
- deterministic non-payable `swiftpay_emulator`;
- pending / execution-unknown / definitive rejection outcomes;
- safe replay and 409 conflict;
- merchant-safe Payment projection;
- production create blocked before side effects.

Canonical hosted migrations:

- `20260815101512_pix_create_get_emulator_foundation.sql`
- `20260815101609_pix_create_get_emulator_behavior.sql`
- `20260815101641_pix_create_get_emulator_prepare_key_count_fix.sql`
- `20260815101729_pix_create_get_emulator_resolve_coalesce_fix.sql`

Accepted CI baseline:

- Application workflow `31877334094`: GREEN, 91/91 application contracts plus K7/A1/A2 runtime acceptance;
- Database workflow `31877334073`: GREEN, 33 files / 1140 pgTAP tests plus K5/K6;
- real dual-API same-key race: `201/202` with one logical Payment/provider execution.

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

## A3 — `paid-transition-ledger-balance-v0` — `DONE`

Spec: `docs/specs/paid-transition-ledger-balance-v0.yaml`.

Accepted boundary:

- sandbox paid evidence is worker-only;
- Payment row lock serializes concurrent observations;
- ProviderEvent persists immutable evidence identity;
- eligible `pending`/`expired` Pix transitions to `paid`;
- replay/distinct duplicate evidence is absorbed without double-credit;
- invalid evidence is rejected without monetary side effects;
- exactly one `settlement_paid` double-entry ledger transaction per Payment;
- merchant net first credits `merchant_pending_liability`;
- authenticated `GET /v1/balance` derives scope only from Bearer principal;
- balance keeps pending/available/reserved/blocked/withdrawable semantics distinct;
- public paid Payment preserves normalized Pix without provider/financial internals;
- canonical `payment.paid` webhook outbox event is written transactionally;
- no live PSP/network payment operation is introduced.

Canonical hosted migrations:

- `20260816004515_paid_transition_ledger_balance_foundation.sql`
- `20260816004620_paid_transition_ledger_balance_behavior.sql`

Final pre-sync accepted CI:

- Application workflow `31885388887`: GREEN, 104/104 application contracts, K7/A1/A2/A3 real runtime acceptance;
- Database workflow `31885388900`: GREEN, 35 files / 1209 pgTAP tests, K5 and K6;
- A3 real worker race: `applied/absorbed`.

Hosted verification:

- exact API/worker EXECUTE segregation;
- no migration-created `settlement_paid`, `pix_paid` or `payment.paid` rows;
- Supabase Security Advisor: no lints;
- no A3 test fixture or test provider/webhook inserted into hosted canonical data.

Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

### A3 gates

- [x] Problem Analysis grounded in Payment/Ledger/provider-event contracts
- [x] freeze `docs/specs/paid-transition-ledger-balance-v0.yaml`
- [x] freeze trusted transition/balance contracts
- [x] RED database tests
- [x] minimal database GREEN
- [x] RED/GREEN financial adapters
- [x] RED/GREEN `GET /v1/balance`
- [x] RED/GREEN API/worker runtime composition
- [x] duplicate/concurrent evidence acceptance
- [x] real runtime acceptance
- [x] hosted migration synchronization
- [x] hosted ACL/security verification
- [x] evidence report

## A4 — merchant webhook delivery runtime — `PENDING`

A4 is the current critical slice. Do not implement before Problem Analysis + frozen YAML spec + RED contracts.

Required boundary to define:

- consume existing durable `webhook_events` / `webhook_deliveries` / delivery jobs;
- atomic worker claim/lease ownership;
- deterministic HTTP method/headers/body contract;
- signing algorithm, timestamp/replay policy and signing-secret isolation;
- explicit success status set;
- retry/backoff schedule;
- maximum attempts and terminal/dead-letter state;
- safe concurrent workers;
- manual replay semantics if included in V0;
- structured logs with URL/secret/header redaction as required;
- deterministic local merchant endpoint for real runtime acceptance;
- strict invariant: delivery processing cannot mutate Payment/Ledger balances.

### A4 gate sequence

- [ ] inspect webhook persistence/job contracts and existing migrations/tests
- [ ] Problem Analysis
- [ ] freeze A4 YAML spec
- [ ] freeze signing/delivery/retry contracts
- [ ] RED database tests for claim/retry/terminal transitions where missing
- [ ] RED application HTTP/signature tests
- [ ] RED worker runtime composition
- [ ] minimal GREEN implementation
- [ ] multi-worker/retry/replay acceptance
- [ ] deterministic local endpoint end-to-end acceptance
- [ ] secret/redaction verification
- [ ] evidence report and hosted schema sync if A4 requires DDL

---

# Phase 4 — PSP conformance and live Pix providers

## Provider conformance fixtures — `PENDING`

Before live network calls:

- freeze AkkadPag request/response/webhook fixtures;
- freeze FlevoPay request/response/webhook fixtures;
- validate auth, amount units, identifiers, Pix fields, status mapping and error taxonomy;
- validate timeout/retry/unknown/reconciliation behavior;
- prove adapters against fixtures.

## AkkadPag adapter — `PENDING`

Blocked until provider conformance is GREEN.

## FlevoPay adapter — `PENDING`

Blocked until provider conformance is GREEN.

## Provider webhook ingress — `PENDING`

Requires provider-specific verification/replay contracts and canonical transition orchestration.

## Provider recovery/reconciliation runtime — `PENDING`

Requires live adapter behavior plus timeout/retry ambiguity policy.

---

# Phase 5 — Merchant/admin product surfaces

## Merchant authentication/session surface — `PENDING`

## API credential management UI/API — `PENDING`

Create/rotate/revoke plus one-time secret disclosure.

## Merchant Pix transaction UI — `PENDING`

List/detail/search/status and operational visibility.

## KYC/compliance operations UI — `PENDING`

## Webhook endpoint management UI/API — `PENDING`

Create/update/disable/secret rotation/test delivery/replay controls after A4.

## Payout/refund operational API/UI — `PENDING`

Database foundations exist; trusted application workflows do not.

---

# Phase 6 — Hosted checkout / links / conversion

## Hosted Pix checkout — `PENDING`

## Payment links — `PENDING`

## Conversion/analytics surfaces — `PENDING`

These are intentionally behind the core gateway API lifecycle.

---

# Phase 7 — Production hardening and launch

## Observability — `PENDING`

- structured redacted logs;
- auth/Pix/provider/job/webhook/reconciliation metrics;
- request/correlation tracing;
- alerts, dashboards and SLOs.

## Security hardening — `PENDING`

- final secret inventory/rotation;
- signing-key rotation architecture;
- dependency/security review;
- final least-privilege audit;
- abuse/rate-limit review;
- operational audit review.

## Deployment / cutover / rollback — `PENDING`

- production environment contract;
- migration/cutover plan;
- rollback/forward-fix policy;
- provider credential bootstrap;
- smoke tests;
- backup/recovery verification;
- launch runbook.

---

# Current handoff spine

```text
Foundation contracts / architecture                       DONE
  -> database + financial foundations                    DONE
  -> Supabase private/security boundaries K1-K4          DONE
  -> K5 deterministic sandbox fixtures                   DONE
  -> K6 trusted runtime topology                         DONE
  -> K7 executable API/worker runtime                    DONE
  -> A1 API credential token authentication              DONE
  -> A2 authenticated Pix create/get + emulator          DONE
  -> A3 paid transition + ledger + balance               DONE
  -> A4 merchant webhook delivery runtime                PENDING / NEXT
  -> provider conformance fixtures                       PENDING
  -> AkkadPag/FlevoPay adapters                          PENDING
  -> merchant/admin operational surfaces                PENDING
  -> production hardening/cutover                        PENDING
```

## Immediate next action

Execute the mandatory planning/TDD pipeline for A4 merchant webhook delivery runtime:

1. inspect canonical webhook event/delivery/job persistence and tests;
2. produce the Problem Analysis;
3. freeze the YAML specification;
4. freeze signing, HTTP, retry, concurrency and terminal-state contracts;
5. add RED tests;
6. only then implement the minimal GREEN delivery path.

Do **not** call AkkadPag or FlevoPay yet.
