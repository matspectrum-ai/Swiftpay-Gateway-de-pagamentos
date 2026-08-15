# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-15

This is the durable backlog and handoff ledger for the reconstruction. Repository artifacts are the source of truth. Detailed implementation proof lives in specs, migrations, tests and `docs/evidence/**`; Git history preserves prior checkpoint chronology.

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
- A2 accepted runtime checkpoint: `48abee66ecd28f820fba52be3154be931d15089b`
- A2 Supabase migration-version alignment: `4bc3f1d7b653a86be2bb250e4ce077283676c8a7`
- Final A2 Application contracts run: `31877334094` — GREEN
- Final A2 Database contracts run: `31877334073` — GREEN
- Canonical database test lane: 33 files / 1140 pgTAP tests / PASS
- Application contract lane: 91 tests / PASS
- Weighted V1 engineering estimate: ~56%
- First end-to-end Pix sandbox MVP estimate: ~68%
- Current critical slice: `paid-transition-ledger-balance-v0` (A3)

## Non-negotiable delivery method

Every new behavior follows this order:

1. Problem Analysis
2. YAML Specification
3. Contracts/interfaces
4. Tests first — RED
5. Minimal implementation — GREEN
6. Refactor without behavior drift
7. Evidence + handoff update

No live PSP integration is allowed to bypass the deterministic emulator/conformance gates.

---

# Phase 0 — Reconstruction truth and target architecture

## Product/reverse-engineering baseline — `DONE`

Canonical artifacts establish the intended SwiftPay V2 shape:

- Pix-first payment gateway/fintech platform;
- modular TypeScript monolith;
- Fastify trusted API and separate worker;
- Supabase/PostgreSQL canonical state;
- provider-agnostic Payment Core;
- append-only financial/audit semantics;
- durable jobs and merchant webhooks;
- initial retained Pix providers: AkkadPag and FlevoPay;
- separate dashboard/admin/checkout surfaces as later product layers.

The repository contains PRD, architecture, ADRs, domain contracts, public API contracts, provider contracts and reconstruction notes sufficient to drive implementation without chat context.

---

# Phase 1 — Database and financial core

## Identity, compliance and provider catalog — `DONE`

Foundation exists for merchant identity/KYC/compliance/provider catalog state.

## Payment idempotency and provider events — `DONE`

Database contracts exist for canonical payment identifiers, idempotency foundations and provider-event persistence.

## Ledger foundation — `DONE`

Append-oriented ledger transactions/entries and financial integrity constraints are established and tested.

## Durable jobs — `DONE`

Persistence/claim foundations exist for reliable asynchronous work.

## Merchant webhook persistence — `DONE`

Durable merchant webhook event/delivery state exists at the database layer. HTTP delivery runtime remains pending later in the application path.

## Payout/refund database foundations — `DONE`

Database state machines, policy snapshots, reservations, execution claims and resolution foundations are implemented and tested.

Application-level payout/refund operation remains `PENDING`; database completion does not imply a merchant-usable payout product.

## Reconciliation foundations — `DONE`

Internal reconciliation operations and provider reconciliation evidence are represented and tested.

Live-provider reconciliation adapters remain `PENDING` until PSP conformance/live integration exists.

---

# Phase 2 — Supabase security and trusted runtime foundation

## K1 — private schema / Data API boundary — `DONE`

Browser/Data API/default Supabase roles do not receive direct authority over private financial state.

## K2 — append-only audit events — `DONE`

Evidence: `docs/evidence/supabase/2026-08-15-k2-audit-events.md`.

## K3 — dashboard membership authorization — `DONE`

Evidence: `docs/evidence/supabase/2026-08-15-k3-dashboard-membership-authorization.md`.

## K4 — trusted runtime database boundary — `DONE`

Separate least-privilege API/worker capability roles are established.

Evidence: `docs/evidence/supabase/2026-08-15-k4-trusted-runtime-database-boundary.md`.

## K5 — deterministic local sandbox seed fixtures — `DONE`

The canonical local seed creates deterministic non-financial identity/KYC/provider-catalog state and intentionally keeps these financial/runtime tables empty:

- API credentials;
- payments;
- ledger transactions;
- jobs;
- merchant webhook events.

A1/A2 therefore use separate test-only runtime fixtures rather than weakening K5. The A2 `swiftpay_emulator` account is not canonical seed/hosted business data.

Evidence: `docs/evidence/supabase/2026-08-15-k5-local-sandbox-seed-fixtures.md`.

## K6 — trusted runtime deployment topology — `DONE`

API and worker identities are separate and capability-scoped. Cross-membership and broad table authority are rejected by tests.

Evidence: `docs/evidence/supabase/2026-08-15-k6-trusted-runtime-deployment-topology.md`.

## K7 — executable runtime bootstrap — `DONE`

Implemented and accepted:

- Node.js 24 LTS TypeScript workspace;
- pinned/frozen pnpm install;
- executable Fastify API;
- executable worker;
- shared typed configuration/database packages;
- API liveness and database readiness;
- worker readiness check;
- real K6 identity acceptance against isolated PostgreSQL;
- no financial side effects from readiness checks.

Evidence: `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`.

---

# Phase 3 — Public API authentication and Pix execution

## A1 — API credential token exchange and Bearer authentication — `DONE`

Spec: `docs/specs/api-credential-token-exchange-v0.yaml`.

Implemented boundary:

- `POST /v1/auth/token`;
- `client_credentials` only;
- trimmed/validated Public Key and opaque Secret Key;
- canonical `scrypt-v1$16384$8$1$...` verifier;
- constant-time derived-key comparison;
- HS256 JWT through `jose`, issuer `swiftpay`, audience `swiftpay-api`, TTL 900 seconds;
- signing key required and minimum 32 UTF-8 bytes;
- exact-IP allowlist, fail-closed malformed policy;
- PostgreSQL-atomic quota: 10 successful issuances per credential per 3600 seconds;
- 429 with positive integer `Retry-After`;
- invalid/unknown/revoked/inactive credentials collapse to the same public authentication failure where required;
- reusable Bearer authentication with current database revalidation;
- revocation and `secret_version` rotation immediately invalidate old JWTs;
- API uses only narrow auth routines rather than direct table DML;
- no payments/ledger/jobs/webhook side effects.

Database migrations:

- `20260815052828_api_credential_token_auth_foundation.sql`
- `20260815054302_api_credential_token_auth_behavior.sql`

Trusted routines:

- `app.lookup_api_credential_for_token(text)`
- `app.consume_api_token_issuance(uuid)`
- `app.get_api_credential_auth_state(uuid)`

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

### Explicitly not completed by A1

The following API credential management operations remain `PENDING` because they were intentionally out of A1 scope:

- credential create;
- credential rotation;
- credential revoke from dashboard/admin HTTP surfaces;
- richer credential management UI;
- MFA/step-up management flows;
- signing-key ring/rotation architecture beyond the current single signing key.

## A2 — `pix-create-get-emulator-v0` — `DONE`

Specs:

- `docs/specs/pix-create-get-emulator-v0.yaml`;
- `docs/specs/pix-create-get-emulator-fixture-v0.yaml`.

Implemented and accepted:

- authenticated `POST /v1/transactions`;
- authenticated `GET /v1/transactions/:id`;
- A1 Bearer revalidation before payment operations;
- sandbox-only create and fail-closed production principal;
- strict request validation with no synthetic customer data;
- frozen canonical request hash and required `Idempotency-Key`;
- merchant/environment-scoped idempotency;
- durable Payment `creating` + ProviderAttempt `prepared` state before execution;
- atomic execution claim in PostgreSQL;
- deterministic `swiftpay_emulator` with visibly non-payable Pix output;
- deterministic `success_pending`, `execution_unknown` and `definitive_rejection` outcomes;
- replay without duplicate emulator execution;
- 409 for same idempotency key with different canonical request;
- merchant/environment-scoped GET with foreign/missing resources collapsed to 404;
- strict public Payment projection without provider account/execution-token/internal leakage;
- no ledger/jobs/merchant-webhook/provider-event side effects;
- real dual-API acceptance against one PostgreSQL database.

Canonical hosted migrations:

- `20260815101512_pix_create_get_emulator_foundation.sql`;
- `20260815101609_pix_create_get_emulator_behavior.sql`;
- `20260815101641_pix_create_get_emulator_prepare_key_count_fix.sql`;
- `20260815101729_pix_create_get_emulator_resolve_coalesce_fix.sql`.

Final accepted CI:

- Application workflow `31877334094`: GREEN, including 91/91 application contracts, K7, A1 and A2 real runtime acceptance;
- Database workflow `31877334073`: GREEN, including 33 files / 1140 pgTAP tests, K5 and K6;
- real A2 create race across two API processes: `201/202` with one logical Payment/ProviderAttempt execution.

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

### Explicitly not completed by A2

A2 does not mark a Pix as paid, create ledger effects, expose balance, emit merchant webhook deliveries or call a live PSP. Those effects require their own frozen transition/replay contracts.

## A3 — `paid-transition-ledger-balance-v0` — `IN_PROGRESS`

This is now the critical slice. No implementation starts before Problem Analysis, YAML spec and RED contracts.

Required problem boundary:

- consume canonical provider/emulator paid evidence idempotently;
- transition an eligible pending Pix Payment to `paid` exactly once;
- preserve immutable evidence identifying the transition source;
- post a balanced ledger transaction exactly once for the merchant net amount and fee policy snapshot;
- ensure duplicate/replayed provider evidence cannot double-credit;
- define conflict/invalid-transition behavior explicitly;
- expose merchant balance/read model only through trusted API/database capabilities;
- prove payment transition and ledger posting are atomic at the canonical database boundary;
- preserve recovery semantics for ambiguous/non-paid provider outcomes;
- establish the durable handoff required for A4 merchant webhook delivery.

### A3 gate sequence

- [ ] Problem Analysis grounded in Payment/Ledger/provider-event contracts
- [ ] freeze `docs/specs/paid-transition-ledger-balance-v0.yaml`
- [ ] freeze trusted transition/balance contracts
- [ ] RED database tests for exactly-once paid transition + balanced ledger
- [ ] RED application/store/API tests
- [ ] minimal GREEN implementation
- [ ] duplicate/concurrent evidence acceptance
- [ ] real runtime acceptance
- [ ] refactor
- [ ] evidence report

## A4 — merchant webhook delivery runtime — `PENDING`

After canonical paid transition exists:

- worker claim loop;
- signed merchant webhook HTTP delivery;
- retry/backoff/dead-letter semantics;
- replay-safe delivery identity;
- observability without secret leakage;
- acceptance against a deterministic local merchant endpoint.

---

# Phase 4 — PSP conformance and live Pix providers

## Provider conformance fixtures — `PENDING`

Before live network calls:

- freeze request/response/webhook fixtures for AkkadPag;
- freeze request/response/webhook fixtures for FlevoPay;
- validate auth, amount units, identifiers, Pix payload/QR fields, status mapping and error taxonomy;
- validate timeout/retry/reconciliation behavior;
- prove adapters against fixtures.

## AkkadPag adapter — `PENDING`

Blocked until the provider conformance gate is GREEN.

## FlevoPay adapter — `PENDING`

Blocked until the provider conformance gate is GREEN.

## Provider webhook ingress — `PENDING`

Requires provider-specific verification/replay contracts and canonical transition orchestration.

## Provider recovery/reconciliation runtime — `PENDING`

Requires live adapter behavior plus retry/timeout ambiguity policy.

---

# Phase 5 — Merchant/admin product surfaces

## Merchant authentication/session surface — `PENDING`

Dashboard user identity/session UX must sit on top of the established membership authorization boundary.

## API credential management UI/API — `PENDING`

Create/rotate/revoke and secure one-time secret disclosure.

## Merchant Pix transaction UI — `PENDING`

List/detail/search/status/retry-operational visibility after the core payment transition APIs exist.

## KYC/compliance operations UI — `PENDING`

Must respect private storage and audit boundaries already established.

## Webhook endpoint management UI — `PENDING`

Create/update/rotate signing secret/test delivery/replay controls after delivery runtime exists.

## Payout/refund operational UI — `PENDING`

Database foundations exist; trusted application workflows and operator surfaces do not yet.

---

# Phase 6 — Hosted checkout, links and broader conversion product

## Hosted Pix checkout — `PENDING`

## Payment links — `PENDING`

## Conversion/analytics surfaces — `PENDING`

These are deliberately behind the core gateway path and are not counted as blockers for the first Pix V1 API milestone.

---

# Phase 7 — Production hardening and launch

## Observability — `PENDING`

Required before production:

- structured operational logs with redaction;
- metrics for token auth, Pix creation, provider latency/errors, job/webhook queues and reconciliation drift;
- tracing/correlation/request IDs across API/worker/provider paths;
- alert thresholds and dashboards.

## Security hardening — `PENDING`

- final secret inventory/rotation procedures;
- signing-key rotation strategy;
- dependency/security review;
- least-privilege re-audit after all new routines;
- abuse/rate-limit review for business endpoints;
- operational audit review.

## Deployment/cutover/rollback — `PENDING`

- production environment contract;
- migrations/cutover plan;
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
  -> A3 paid transition + ledger + balance              IN_PROGRESS
  -> A4 merchant webhook delivery runtime               PENDING
  -> provider conformance fixtures                       PENDING
  -> AkkadPag/FlevoPay adapters                          PENDING
  -> merchant/admin operational surfaces                PENDING
  -> production hardening/cutover                        PENDING
```

## Immediate next action

Execute the mandatory pipeline for `paid-transition-ledger-balance-v0`:

1. inspect canonical Payment, ProviderEvent, Ledger and balance/read-model contracts;
2. produce the Problem Analysis;
3. write/freeze the YAML spec;
4. define trusted database/application/API contracts;
5. add RED tests for exactly-once paid transition and balanced ledger posting;
6. only then implement the minimal GREEN path.

Do **not** call AkkadPag or FlevoPay yet.
