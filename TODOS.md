# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-15

This is the durable backlog and handoff ledger for the reconstruction. Detailed evidence lives in the linked contracts, ADRs, reverse-engineering notes, specs, migrations and tests. Repository artifacts are the source of truth; managed Supabase verification is additional deployed-environment proof.

Executive readiness checkpoint: `docs/product/v1-readiness-status.md`.

## States

- `PENDING`: known, not started
- `IN_PROGRESS`: actively being worked
- `EVIDENCE_REQUIRED`: current external/provider evidence is required before activation
- `BLOCKED`: external dependency prevents progress
- `DONE`: completed with durable evidence/tests
- `DEFERRED`: deliberately outside the current release
- `DROPPED`: removed from scope
- `SUPERSEDED`: replaced by a later accepted decision

# Phase 0 — Foundation and reverse engineering

## Foundation

- `DONE` Reconstruction repository, governance and documentation structure.
- `DONE` Pix-first scope and materially simpler architecture.
- `DONE` Supabase/PostgreSQL platform foundation behind trusted SwiftPay API/worker boundaries.
- `DONE` Modular-monolith first-release topology.
- `DONE` Foundational financial/security invariants.
- `DONE` Product vision and merchant experience direction.
- `IN_PROGRESS` Brand/design system and representative UI validation.

## Legacy/product inventory

- `DONE` Merchant/admin/frontend capability inventory and `KEEP | SIMPLIFY | REPLACE | REMOVE | DEFER` classification.
- `DONE` First-release selling spine; broad legacy commerce/catalog/stock/delivery breadth deferred.
- `DONE` Migration data classification baseline.
- `PENDING` Exhaustive residual author-written legacy sweep. This does not block already-proven retained-domain contracts unless contradictory evidence appears.

## Providers

- `DONE` Audit all 12 legacy `IAcquirerService` adapters.
- `DONE` Audit Hyperswitch exact-brand coverage; no first-party exact-brand connector match for the retained legacy brands.
- `DONE` ADR 0004: native thin provider adapters; Hyperswitch is not an initial dependency.
- `DONE` Freeze V1 processor scope to exactly **AkkadPag + FlevoPay**.
- `DEFERRED` Accithus, ActivePayments, Bankizi, Coldfy, HeartPay, HunterPay, IHubBanking, MagicPay, Pluggou and Rapdyn.
- `DONE` Deep source audit of retained AkkadPag/FlevoPay client, DTO, status and webhook behavior.
- `DONE` Current public retained-provider conformance evidence recorded in `docs/evidence/providers/2026-08-14-retained-provider-conformance.md`.
- `EVIDENCE_REQUIRED` Prove whether current AkadPay is the same operational/API provider as legacy AkkadPag before using AkadPay contract semantics.
- `EVIDENCE_REQUIRED` AkkadPag current sandbox/docs: webhook auth, create recovery/idempotency, payout recovery/idempotency, statuses and rate limits.
- `EVIDENCE_REQUIRED` FlevoPay current sandbox/docs: webhook auth, authoritative create-recovery identifier, statuses and rate limits.
- `DONE` FlevoPay V1 Pix-out rule remains unsupported/rejected locally until an exact current contract supersedes it.
- `DONE` AkkadPag V1 capability direction: Pix-in + Pix-out; production activation still requires conformance evidence.
- `DEFERRED` Provider refunds until an exact retained-provider refund endpoint/identity/recovery contract is proven.

## Financial core

- `DONE` Audit legacy ledger, calculations, fees and reconciliation.
- `DONE` Audit payout reservation/execution/webhooks and document concurrent overspend risk.
- `DONE` Record unknown-result flaw and generic monetary POST retry risk.
- `DONE` Audit refund source identity/state defects.
- `DONE` Defer platform treasury/provider sweep from initial V2.
- `DONE` Define canonical V2 double-entry chart/source identity/balance model.
- `EVIDENCE_REQUIRED` Determine whether non-zero risk reserve/compensation is required. Initial V2 keeps risk reserve disabled.

## Public API/security/KYC

- `DONE` Audit client-credentials token/revocation behavior.
- `DONE` Audit Pix create/get/list and public balance semantics.
- `DONE` Audit cashout and Sandbox defects.
- `DONE` Audit merchant webhook signing/retry behavior and legacy public-ID HMAC flaw.
- `DONE` Audit API credential lifecycle and internal API auth boundary.
- `DONE` Audit KYC lifecycle and storage/ownership/immutability defects.
- `DONE` Audit BaseResponse/error/OpenAPI behavior.

## Async consistency

- `DONE` Inventory legacy RabbitMQ/MassTransit and Hangfire/Valkey work.
- `DONE` Confirm absence of transactional outbox around audited financial/message boundaries.
- `DONE` Record payment/Pix-create/payout dual-write windows.
- `DONE` Select PostgreSQL durable jobs/outbox + small worker as V1 async baseline.

# Phase 1 — Product and domain specification

## Core contracts

- `DONE` `docs/contracts/financial-invariants.md`
- `DONE` `docs/contracts/payment-and-provider-attempt.md`
- `DONE` `docs/contracts/ledger-and-balance.md`
- `DONE` `docs/contracts/native-pix-provider-adapter.md`
- `DONE` `docs/contracts/outbox-and-jobs.md`
- `DONE` `docs/contracts/payout.md`
- `DONE` `docs/contracts/refund.md`
- `DONE` `docs/contracts/merchant-kyc.md`
- `DONE` `docs/contracts/api-credentials.md`
- `DONE` `docs/contracts/public-api.md`
- `DONE` `docs/contracts/fees-and-rounding.md`
- `DONE` `docs/contracts/merchant-webhooks.md`
- `DONE` `docs/contracts/sandbox.md`
- `DONE` `docs/contracts/reconciliation.md`
- `DONE` `docs/contracts/selling-surfaces.md`
- `PENDING` Admin operational capability/step-up/financial repair contract.

## Selling/product surfaces

- `PENDING` Detailed hosted-checkout branding/configuration contract.
- `PENDING` Detailed payment-link management contract.
- `PENDING` Conversion-event taxonomy/denominators and UTM attribution retention/deduplication.
- `PENDING` Constrained automation model (`EVENT -> CONDITION -> ACTION`).
- `PENDING` Integration contracts for UTMify, n8n, WhatsApp, Telegram and generic merchant integrations.
- `DEFERRED` Wallet top-up until an explicit fund-flow/legal/provider contract exists.
- `DEFERRED` Seller ranking until canonical eligibility/privacy rules exist.

# Phase 2 — Supabase/PostgreSQL foundation

Implementation is active under strict RED -> migration -> GREEN database TDD.

## Harness and canonical remote

- `DONE` Versioned Supabase project configuration; PostgreSQL 17.
- `DONE` Supabase CLI pinned in CI.
- `DONE` pgTAP database-contract workflow using `supabase db start` + `supabase test db`.
- `DONE` Server-owned private `app` schema outside browser Data API mutation surface.
- `DONE` Canonical managed Supabase project: **`swiftpay v2`**, ref `vsidrgbbyzibqfjkuiqb`.
- `DONE` Remote migration history normalized to repository timestamps through `20260815032700_trusted_runtime_database_boundary_behavior.sql`.
- `DONE` Remote baseline security evidence in `docs/evidence/supabase/2026-08-14-canonical-remote-sync.md`.
- `DONE` K1 Storage evidence in `docs/evidence/supabase/2026-08-14-kyc-private-storage.md`.
- `DONE` K2 audit evidence in `docs/evidence/supabase/2026-08-15-k2-audit-events.md`.
- `DONE` K3 Auth/membership evidence in `docs/evidence/supabase/2026-08-15-k3-dashboard-membership-authorization.md`.
- `DONE` K4 trusted runtime boundary evidence in `docs/evidence/supabase/2026-08-15-k4-trusted-runtime-database-boundary.md`.
- `DONE` Supabase Security Advisor after K4: **0 security lints**.
- `PENDING` Performance-index review after representative workload/query plans. Current advisor notices are INFO-only; do not add/remove indexes mechanically.

## A — merchant / KYC / provider configuration

- `DONE` `app.merchants`, `app.merchant_members`, `app.kyc_cases`, `app.kyc_documents`, `app.api_credentials`, `app.providers`, `app.provider_accounts`.

Migration: `20260814005500_identity_compliance_and_providers.sql`

## B/C/D — request idempotency / Payment / provider evidence

- `DONE` `app.request_idempotency`, `app.payments`, `app.provider_attempts`, `app.provider_events`.
- `DONE` Payment cents/BRL/fee/net/refund constraints.
- `DONE` Request-idempotency database uniqueness.
- `DONE` One unresolved provider-create attempt per Payment.
- `DONE` Provider-event durable identity primitives.

Migration: `20260814010000_payment_idempotency_and_provider_events.sql`

## E — canonical ledger

- `DONE` `app.accounts`, `app.ledger_transactions`, `app.ledger_entries`.
- `DONE` Deterministic merchant/provider/platform account identities.
- `DONE` `app.ensure_account(...)` database-native upsert.
- `DONE` `app.post_ledger_transaction(...)` double-entry/source-idempotency boundary.
- `DONE` Deterministic row locking and non-negative merchant liability buckets.
- `DONE` Cached balances update atomically by natural side.
- `DONE` Risk-reserve account is not created by default payment posting.

Migration: `20260814014500_ledger_foundation.sql`

## F — PostgreSQL durable jobs/outbox

- `DONE` `app.jobs` with logical dedupe, versioned payloads, due/lease state and structured errors.
- `DONE` `enqueue_job(...)`, `claim_jobs(...)`, `complete_job(...)`, `reschedule_job(...)`.
- `DONE` `FOR UPDATE SKIP LOCKED` claim and lease fencing semantics.

Migration: `20260814020500_jobs_foundation.sql`

## G — merchant webhook persistence

- `DONE` `app.webhook_endpoints`, `app.webhook_events`, `app.webhook_deliveries`.
- `DONE` Atomic logical-event -> endpoint-delivery -> durable-job materialization.
- `DONE` Endpoint secret/version/rotation persistence independent from public IDs.

Migration: `20260814022000_merchant_webhook_persistence.sql`

## H — payouts/refunds

- `DONE` First-class payout-account, Payout, payout-attempt, Refund and refund-attempt resources.
- `DONE` Atomic Available -> payout/refund-blocked reservation with non-negative merchant liabilities.
- `DONE` Request replay/idempotency conflict semantics.
- `DONE` Payout routing-policy snapshot.
- `DONE` Durable payout attempt preparation and one-shot execution claim/fencing.
- `DONE` `app.payout_evidence` normalized evidence and exactly-once terminal ledger effects.
- `DONE` Authoritative payout completion/failure merchant events.
- `DONE` Payment refund-fee policy snapshot and cumulative refundable-limit enforcement.
- `DONE` `app.refund_evidence` normalized evidence with explicit amount semantics.
- `DONE` Refund completion/failure ledger effects and Payment refund aggregate update exactly once.
- `DONE` Current executable refund economics fail-closed to `merchant_fee_non_refundable`.
- `DEFERRED` Provider-originated refund application until exact retained-provider conformance exists.

Migrations:

- `20260814043000_payout_refund_foundation.sql`
- `20260814044000_payment_refund_policy_snapshot.sql`
- `20260814050000_financial_reservations.sql`
- `20260814052000_payout_execution_claim_foundation.sql`
- `20260814053000_payout_execution_claim_behavior.sql`
- `20260814054000_payout_resolution_foundation.sql`
- `20260814055000_payout_resolution_behavior.sql`
- `20260814056000_refund_resolution_foundation.sql`
- `20260814057000_refund_resolution_behavior.sql`

## I — reconciliation

### I1 — internal read-only detection

- `DONE` `docs/specs/internal-reconciliation-v0.yaml`.
- `DONE` Account-cache parity, expected posting, refund projection and deterministic finding views.
- `DONE` Detect `cache_mismatch`, `missing_required_posting`, `orphan_posting`, `unexpected_posting`, `refund_projection_mismatch`.
- `DONE` Read-only deterministic behavior; no repair side effects.

Migrations: `20260814058000_internal_reconciliation_foundation.sql`, `20260814059000_internal_reconciliation_behavior.sql`.

### I2 — durable reconciliation operations

- `DONE` `docs/specs/reconciliation-operations-v0.yaml`.
- `DONE` Durable run, stable discrepancy, immutable run observation and lifecycle-event persistence.
- `DONE` Stable identity across runs and explicit `open -> acknowledged -> resolved` lifecycle.
- `DONE` Missing from a later run never auto-resolves a discrepancy.
- `DONE` No ledger posting, job enqueue or automatic financial repair.

Migrations: `20260814060000_reconciliation_operations_foundation.sql`, `20260814061000_reconciliation_operations_behavior.sql`.

### I3a — normalized external/provider evidence envelope

- `DONE` `docs/specs/provider-reconciliation-evidence-v0.yaml`.
- `DONE` `app.provider_reconciliation_evidence` normalized provider-authoritative facts.
- `DONE` Provider/account/environment validation and logical-source idempotency/conflict behavior.
- `DONE` Explicit operation/settlement/balance shapes; V1 BRL.
- `DONE` Evidence append-only with zero Payment/Payout/Refund/ledger/job side effects.
- `DONE` PostgreSQL performs no provider HTTP/report fetching.

Migrations: `20260814062000_provider_reconciliation_evidence_foundation.sql`, `20260814063000_provider_reconciliation_evidence_behavior.sql`.

### I3b — provider-vs-SwiftPay comparison

- `EVIDENCE_REQUIRED` Authoritative AkkadPag/FlevoPay query/report/balance sources, stable operation identifiers and provider-absence semantics.
- `PENDING` External provider-evidence reconciliation findings after conformance evidence is captured.
- `PENDING` Provider settlement/balance/report comparisons once exact evidence contracts exist.
- `PENDING` Admin step-up/approval boundary for any future append-only correction flow.

## J — Supabase/Data API access hardening

### J1 — private `app` schema ACL

- `DONE` `docs/specs/app-schema-access-control-v0.yaml`.
- `DONE` `PUBLIC`, `anon`, `authenticated`, `service_role` denied schema/object access to `app`.
- `DONE` Future `app` routines/tables/sequences fail closed via default ACL.
- `DONE` Transactional probes verify future-object ACL behavior.

Migration: `20260814064000_app_schema_access_control.sql`.
Validation: **21 pgTAP files / 716 tests / PASS**.

### J2 — public Data API grants explicit opt-in

- `DONE` `docs/specs/public-data-api-default-grants-v0.yaml`.
- `DONE` Future `public` tables/sequences do not inherit Data API privileges.
- `DONE` Future routines do not inherit executable access for `PUBLIC`, `anon`, `authenticated`, `service_role`.
- `DONE` Managed `public.rls_auto_enable()` remains installed but inaccessible to Data API roles.
- `DONE` Managed `ensure_rls` event trigger remains enabled.
- `DONE` No bulk revoke of unrelated existing `public`, `auth`, `storage`, `realtime` surfaces.

Migration: `20260814065000_public_data_api_default_grants.sql`.
Validation: **22 pgTAP files / 734 tests / PASS**.

## K — remaining platform/security foundation

### K1 — private KYC Storage

- `DONE` `docs/specs/kyc-private-storage-v0.yaml`.
- `DONE` Dedicated private `kyc-evidence` bucket, 10 MiB ceiling, no invented compliance MIME allowlist.
- `DONE` RLS enabled on `storage.buckets` and `storage.objects`.
- `DONE` Eight command-specific `AS RESTRICTIVE` fences for bucket/object SELECT/INSERT/UPDATE/DELETE across `anon` + `authenticated`.
- `DONE` Broad permissive probe policies cannot expose/mutate KYC rows.
- `DONE` Managed `storage.protect_delete()` guards preserved.
- `DONE` Browser receives no direct KYC Storage capability; future upload/download remains a trusted-backend Storage API operation.

Migration: `20260815021111_kyc_private_storage.sql`.
Validation: **23 pgTAP files / 778 tests / PASS**, GitHub Actions run #98.
Managed verification: private bucket + 8/8 restrictive policies + Security Advisor **0 lints**.

### K2 — append-only audit events

- `DONE` `docs/specs/audit-events-v0.yaml`.
- `DONE` `app.audit_events` generic server-owned audit history.
- `DONE` Frozen actor/source/environment vocabularies and canonical merchant scope.
- `DONE` `app.record_audit_event(...)` validates the envelope and has no domain/financial/async/webhook side effects.
- `DONE` Exact trusted replay returns the original event ID and keeps one row.
- `DONE` Same source identity with changed fingerprint or changed immutable data fails with `23505`.
- `DONE` UPDATE/DELETE rejected with append-only `23514` behavior.
- `DONE` `PUBLIC`, `anon`, `authenticated`, `service_role` cannot execute the recorder or directly mutate audit storage.
- `DONE` Generic infrastructure stores no raw request/response bodies, KYC document bytes, provider payloads or secret material; module-specific callers own safe metadata allowlists/redaction tests.

Migrations:

- `20260815021956_audit_events_foundation.sql`
- `20260815022800_audit_events_behavior.sql`

Validation after K2 GREEN: **25 pgTAP files / 856 tests / PASS** on GitHub Actions run #105 (`31859297198`).

Managed Supabase verification after K2:

- 25 canonical migration-history entries through `20260815022800`;
- exact replay returns same ID and row count remains one;
- changed replay returns SQLSTATE `23505`;
- UPDATE/DELETE return SQLSTATE `23514`;
- recorder EXECUTE denied to `anon`, `authenticated`, `service_role`;
- remote proof was transaction-scoped and rolled back; zero verification rows persisted;
- Supabase Security Advisor: **0 security lints**.

Evidence: `docs/evidence/supabase/2026-08-15-k2-audit-events.md`.

### K3 — Supabase Auth dashboard membership authorization

- `DONE` `docs/specs/dashboard-merchant-membership-authorization-v0.yaml`.
- `DONE` Supabase `auth.users.id` retained as canonical dashboard identity anchor.
- `DONE` `app.merchant_members` is the sole merchant-membership/merchant-role source of truth.
- `DONE` `app.require_merchant_membership(uuid,uuid,text)` implements `owner > admin > member` and returns the actual active role.
- `DONE` Missing/anonymous/soft-deleted identity, missing/disabled/cross-merchant membership and insufficient role fail closed with `42501`.
- `DONE` Invalid arguments/required role fail with `23514`.
- `DONE` `raw_user_meta_data` and `raw_app_meta_data` cannot grant or replace canonical merchant authorization.
- `DONE` Membership disablement/role changes are visible on the next check without waiting for JWT refresh.
- `DONE` Merchant lifecycle/KYC remains separate from dashboard membership authorization.
- `DONE` Helper is `STABLE SECURITY DEFINER` with fixed search path and remains revoked from `PUBLIC`, `anon`, `authenticated`, `service_role` and direct K4 runtime execution.
- `DONE` Authorization checks have zero audit/domain/ledger/job/webhook side effects.

Migrations:

- `20260815024000_dashboard_membership_authorization_foundation.sql`
- `20260815024519_dashboard_membership_authorization_behavior.sql`

Validation after K3 GREEN: **27 pgTAP files / 902 tests / PASS** on GitHub Actions run #112 (`31860024259`).

Managed Supabase verification after K3:

- 27 canonical migration-history entries through `20260815024519`;
- role hierarchy, suspended-merchant dashboard access, anonymous/deleted/spoof/disabled denial and invalid-role handling proven transactionally;
- helper EXECUTE remains denied to `anon`, `authenticated`, `service_role`;
- corrected remote proof was rolled back and left zero verification merchants/Auth users/memberships;
- Supabase Security Advisor: **0 security lints**.

Evidence: `docs/evidence/supabase/2026-08-15-k3-dashboard-membership-authorization.md`.

### K4 — explicit trusted runtime database boundary

- `DONE` `docs/specs/trusted-runtime-database-boundary-v0.yaml`.
- `DONE` `swiftpay_api` and `swiftpay_worker` are explicit `NOLOGIN`, non-superuser capability roles.
- `DONE` Neither runtime role receives direct `app` table or sequence access.
- `DONE` `swiftpay_api` receives only the composed dashboard merchant/environment context helper.
- `DONE` `swiftpay_worker` receives only `claim_jobs`, `complete_job`, `reschedule_job` baseline capabilities.
- `DONE` Financial/provider/reconciliation/audit primitives remain outside the K4 allowlists.
- `DONE` `app.require_dashboard_merchant_context(...)` accepts only `sandbox|production`, delegates canonical membership authority to K3 and ignores spoofable custom GUCs.
- `DONE` Cross-merchant/disabled/insufficient role remains fail-closed; context resolution has zero financial/domain/async side effects.
- `DONE` Managed transactional proof exercised the real capability roles and was fully rolled back.

Migrations:

- `20260815031330_trusted_runtime_database_boundary_foundation.sql`
- `20260815032700_trusted_runtime_database_boundary_behavior.sql`

Validation after K4 GREEN: **29 pgTAP files / 973 tests / PASS** on GitHub Actions run #121 (`31861783216`).

Managed Supabase verification after K4:

- 29 canonical migration-history entries through `20260815032700`;
- API routine allowlist count `1`, worker routine allowlist count `3`;
- valid context, GUC spoof resistance, cross-merchant denial and invalid-environment behavior proven transactionally;
- API direct table/ledger access denied; worker direct table/dashboard-context access denied;
- worker durable claim + fenced completion proven under actual `swiftpay_worker` role;
- verification fixtures rolled back;
- creator memberships retain `SET=false`, `INHERIT=false` after proof rollback;
- Supabase Security Advisor: **0 security lints**.

Evidence: `docs/evidence/supabase/2026-08-15-k4-trusted-runtime-database-boundary.md`.

### Remaining K slices

- `PENDING` **K5 — deterministic local sandbox/seed fixtures.**
- `PENDING` **K6 — trusted API/worker production deployment topology around managed Supabase.**
- `PENDING` Merchant-facing exposed read/write models only after their own grants + RLS contracts; J2 keeps exposure opt-in by default.

# Phase 3 — First executable Pix vertical slice

Target:

```text
signup
-> merchant
-> KYC approved
-> API credential
-> create Pix
-> AkkadPag or FlevoPay
-> authenticated provider evidence
-> canonical Payment transition
-> ledger posting
-> balance
-> durable merchant webhook
```

- `PENDING` Vertical-slice application/acceptance tests.
- `PENDING` Trusted backend auth/merchant/KYC capability gate.
- `PENDING` API credential issuance/verification endpoints.
- `PENDING` Public Pix create/get/list with request idempotency.
- `EVIDENCE_REQUIRED` AkkadPag Pix-in conformance/sandbox proof before production enablement.
- `EVIDENCE_REQUIRED` FlevoPay Pix-in conformance/sandbox proof before production enablement.
- `PENDING` `AkkadPagAdapter` implementation.
- `PENDING` `FlevoPayAdapter` implementation.
- `PENDING` Two-provider capability-aware router.
- `PENDING` Provider webhook authentication/normalization/recovery application layer.
- `PENDING` Atomic paid-Payment transition + ledger + merchant-event job orchestration.
- `PENDING` Canonical balance API/read model.
- `PENDING` Small SwiftPay worker for durable jobs.
- `PENDING` HMAC-signed merchant webhook HTTP delivery with SSRF/replay controls.
- `PENDING` Minimal merchant/admin UI for the slice.

# Phase 4 — Selling surfaces and conversion

- `PENDING` Hosted Pix Checkout over Payment Core.
- `PENDING` Payment Links over Payment Core.
- `PENDING` Quick Pix seller flow.
- `PENDING` Conversion events/funnel/approved-lost metrics.
- `PENDING` UTM/campaign attribution.
- `PENDING` Provider conversion observability and actionable revenue insights.

# Phase 5 — Wallet, payouts and operations

- `PENDING` Payout account management.
- `PENDING` Withdrawal request/approval policy.
- `EVIDENCE_REQUIRED` AkkadPag Pix-out conformance: withdrawal key, non-terminal Processing, idempotency/recovery/unknown-result semantics.
- `PENDING` AkkadPag Pix-out adapter execution/recovery.
- `DONE` FlevoPay Pix-out outside frozen V1 capability; route rejects locally.
- `DONE` Provider-independent payout reservation/execution-claim/evidence/terminal ledger primitives.
- `PENDING` AkkadPag payout evidence normalization plus external reconciliation integration.
- `PENDING` Wallet statement/read model.
- `PENDING` Reconciliation/admin operations.
- `DEFERRED` Platform treasury/provider sweep.

# Phase 6 — Revenue automation and integrations

- `PENDING` Integration execution on canonical jobs/outbox.
- `PENDING` Automation rules/executions.
- `PENDING` Unpaid-Pix recovery automation.
- `PENDING` UTMify, n8n, WhatsApp and Telegram integrations.

# Phase 7 — Developer experience

- `PENDING` Canonical OpenAPI/integration guide.
- `PENDING` OpenAPI breaking-change CI.
- `PENDING` TypeScript SDK if justified.
- `PENDING` SwiftPay CLI/bootstrap if justified.
- `PENDING` Safe MCP/agent integration if approved.

# Phase 8 — Migration and cutover

- `PENDING` Legacy -> V2 migration mapping/harness.
- `PENDING` Representative compatibility fixtures and deployed legacy OpenAPI capture.
- `PENDING` Retained AkkadPag/FlevoPay provider parity/conformance cases.
- `PENDING` Shadow/dual-run strategy where justified.
- `PENDING` Migration dry run and opening-balance reconciliation.
- `PENDING` Open Pix/refund/payout cutover reconciliation.
- `PENDING` Rollback and production-cutover acceptance plan.

# Current handoff

Canonical implemented spine:

```text
merchant / KYC / credentials
        |
request idempotency
        |
Payment -> ProviderAttempt -> ProviderEvent
        |
canonical double-entry ledger
        |
durable PostgreSQL jobs/outbox
        |
merchant webhook persistence
        |
payout/refund resources + atomic reservations
        |
payout prepare -> one-shot execution claim -> normalized evidence
        |
payout/refund processing / execution_unknown -> completed | failed
        |
read-only internal reconciliation detection
        |
durable reconciliation run/discrepancy lifecycle
        |
append-only normalized provider evidence envelope
        |
private app ACL + explicit-opt-in public Data API grants
        |
private KYC Storage + restrictive browser fences
        |
append-only replay-safe operational audit
        |
Supabase Auth identity -> canonical merchant membership authorization
        |
trusted API / worker least-privilege capability roles + tenant/environment context  <- current GREEN boundary
```

Provider runtime scope remains frozen:

```text
Pix In : AkkadPag | FlevoPay
Pix Out: AkkadPag only
Refund : provider execution disabled until exact retained-provider contract is proven
```

Merchant accounting remains provider-independent:

```text
pending_settlement
available
reserved            # disabled by default
blocked_payouts
blocked_refunds
withdrawable
```

## Immediate execution order

1. K5 deterministic local sandbox/seed fixtures -> spec -> RED -> GREEN;
2. K6 trusted API/worker production deployment topology;
3. scaffold the trusted TypeScript API + worker and establish the first executable Pix acceptance harness;
4. provider-specific I3b and real adapters only when current AkkadPag/FlevoPay conformance evidence exists;
5. complete the first executable Pix vertical slice over the proven foundation.

## Verification

- Work remains on `agent/foundation-phase-0` and draft PR #1.
- `main` remains untouched.
- Legacy `SwiftPay-Prod/swiftpay---Prod` has not been mutated.
- Latest database boundary: **29 pgTAP files / 973 tests / PASS** on GitHub Actions run #121 (`31861783216`).
- Canonical managed Supabase: **`swiftpay v2` / `vsidrgbbyzibqfjkuiqb`**.
- Remote history: **29 canonical migrations through `20260815032700`**.
- Remote Security Advisor after K4: **0 security lints**.
- Executive readiness checkpoint estimates **~42% weighted V1 engineering completion** and **~30% practical production readiness**; see `docs/product/v1-readiness-status.md`.
- Remote Performance Advisor remains deferred until representative workload/query-plan evidence exists.
- I3b provider-vs-SwiftPay comparison remains `EVIDENCE_REQUIRED`; provider-specific absence/query/report semantics have not been invented.
- Refund provider execution remains intentionally disabled; database refund resolution is proven only for approved sandbox/reconciliation evidence until provider conformance exists.
- No production HTTP API/provider adapter or merchant UI has been introduced yet.
- Repository artifacts, not chat context, are the canonical engineering source of truth.