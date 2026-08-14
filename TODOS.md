# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-14

This is the durable backlog and handoff ledger for the reconstruction. Detailed evidence lives in the linked contracts, ADRs, reverse-engineering notes, specs, migrations and tests. This file records current status and sequencing.

## States

- `PENDING`: known, not started
- `IN_PROGRESS`: actively being worked
- `EVIDENCE_REQUIRED`: implementation direction exists but current provider/live evidence is required before activation
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
- `PENDING` Exhaustive residual author-written legacy sweep. This completeness task does not block already-proven retained-domain contracts unless contradictory evidence appears.

## Providers

- `DONE` Audit all 12 legacy `IAcquirerService` adapters.
- `DONE` Audit Hyperswitch exact-brand coverage; no first-party exact-brand connector match was found for the audited legacy provider set.
- `DONE` Accept ADR 0004: native thin provider adapters; Hyperswitch is not an initial dependency.
- `SUPERSEDED` Engineering provider-retention tiers used during exploration.
- `SUPERSEDED` MagicPay/Accithus first-proof candidate recommendation.
- `DONE` Freeze V1 processor scope to exactly **AkkadPag + FlevoPay**.
- `DEFERRED` Accithus, ActivePayments, Bankizi, Coldfy, HeartPay, HunterPay, IHubBanking, MagicPay, Pluggou and Rapdyn.
- `DONE` Deep source audit of retained AkkadPag/FlevoPay client, DTO, status and webhook behavior.
- `EVIDENCE_REQUIRED` AkkadPag current sandbox/docs: webhook auth, create recovery/idempotency, payout recovery/idempotency, current statuses/rate limits.
- `EVIDENCE_REQUIRED` FlevoPay current sandbox/docs: webhook auth, authoritative create-recovery identifier, current statuses/rate limits.
- `DONE` FlevoPay V1 capability rule: Pix-out unsupported and rejected locally before HTTP.
- `DONE` AkkadPag V1 capability direction: Pix-in + Pix-out; production activation still requires conformance evidence.
- `DEFERRED` Provider refunds until an exact retained-provider refund endpoint/identity/recovery contract is proven.

## Financial core

- `DONE` Audit legacy ledger, calculations, fees and reconciliation.
- `DONE` Audit payout reservation/execution/webhooks and record concurrent overspend risk.
- `DONE` Record unknown-result flaw and generic monetary POST retry risk.
- `DONE` Audit refund source identity/state defects.
- `DONE` Defer platform treasury/provider sweep from initial V2.
- `DONE` Define canonical V2 double-entry chart/source identity/balance model.
- `EVIDENCE_REQUIRED` Determine whether non-zero risk reserve/compensation is actually required. Initial V2 keeps risk reserve disabled.

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
- `PENDING` Admin operational capability/step-up/financial repair contract.

## Selling/product surfaces

- `DONE` Unified Hosted Checkout / Payment Link / Quick Pix / REST source model in `docs/contracts/selling-surfaces.md`.
- `PENDING` Detailed hosted checkout branding/configuration contract.
- `PENDING` Detailed payment-link management contract.
- `PENDING` Conversion-event taxonomy/denominators and UTM attribution retention/deduplication.
- `PENDING` Constrained automation model (`EVENT -> CONDITION -> ACTION`).
- `PENDING` Integration contracts for UTMify, n8n, WhatsApp, Telegram and generic merchant integrations.
- `DEFERRED` Wallet top-up until an explicit fund-flow/legal/provider contract exists.
- `DEFERRED` Seller ranking until canonical eligibility/privacy rules exist.

# Phase 2 — Supabase/PostgreSQL foundation

Implementation is active under strict RED -> migration -> GREEN database TDD.

## Harness

- `DONE` Versioned Supabase project configuration; PostgreSQL 17.
- `DONE` Supabase CLI pinned in CI.
- `DONE` pgTAP database-contract workflow with `supabase db start` + `supabase test db`.
- `DONE` Server-owned `app` schema kept outside direct browser Data API mutation surface.
- `IN_PROGRESS` Fail-first schema suites; each slice is introduced RED before its migration.

## Implemented slices

### A — merchant / KYC / provider configuration

- `DONE` `app.merchants`
- `DONE` `app.merchant_members`
- `DONE` `app.kyc_cases`
- `DONE` `app.kyc_documents`
- `DONE` `app.api_credentials`
- `DONE` `app.providers`
- `DONE` `app.provider_accounts`

Migration: `20260814005500_identity_compliance_and_providers.sql`

### B/C/D — request idempotency / Payment / provider evidence

- `DONE` `app.request_idempotency`
- `DONE` `app.payments`
- `DONE` `app.provider_attempts`
- `DONE` `app.provider_events`
- `DONE` Payment cents/BRL/fee/net/refund constraints.
- `DONE` Request-idempotency database uniqueness.
- `DONE` One unresolved provider-create attempt per Payment.
- `DONE` Provider-event durable identity primitives.

Migration: `20260814010000_payment_idempotency_and_provider_events.sql`

### E — canonical ledger

- `DONE` `app.accounts`
- `DONE` `app.ledger_transactions`
- `DONE` `app.ledger_entries`
- `DONE` Deterministic merchant/provider/platform account identities.
- `DONE` `app.ensure_account(...)` database-native upsert.
- `DONE` `app.post_ledger_transaction(...)` double-entry/source-idempotency boundary.
- `DONE` Deterministic row locking and non-negative merchant liability buckets.
- `DONE` Cached balances update atomically by natural side.
- `DONE` Risk-reserve account is not created by default payment posting.

Migration: `20260814014500_ledger_foundation.sql`

### F — PostgreSQL durable jobs/outbox

- `DONE` `app.jobs`
- `DONE` Logical dedupe uniqueness.
- `DONE` Versioned job payloads.
- `DONE` `enqueue_job(...)` idempotent enqueue.
- `DONE` `claim_jobs(...)` with `FOR UPDATE SKIP LOCKED` and lease fencing token.
- `DONE` `complete_job(...)` fenced completion.
- `DONE` `reschedule_job(...)` retry/dead transition with structured error persistence.

Migration: `20260814020500_jobs_foundation.sql`

Validation after slice F: **4 pgTAP files / 95 tests / PASS**.

### G — merchant webhook persistence

- `DONE` Fail-first `005_merchant_webhooks.test.sql`.
- `DONE` `app.webhook_endpoints`.
- `DONE` `app.webhook_events`.
- `DONE` `app.webhook_deliveries`.
- `DONE` Atomic logical-event -> endpoint-delivery -> durable-job materialization.

Migration: `20260814022000_merchant_webhook_persistence.sql`

### H — payouts/refunds

- `DONE` First-class payout-account, Payout and payout-attempt resource schema.
- `DONE` Atomic Available -> payout-blocked reservation with database-enforced non-negative merchant liability.
- `DONE` Payout request replay/idempotency conflict behavior.
- `DONE` Payout routing-policy snapshot at reservation.
- `DONE` Durable payout provider-operation preparation with stable client/request identity.
- `DONE` One-shot payout execution claim with fencing token; lease expiry never authorizes a blind second monetary POST.
- `DONE` `app.payout_evidence` normalized durable evidence boundary with provenance and stable source identity.
- `DONE` Payout `processing` / `execution_unknown` application semantics; unknown external execution leaves blocked funds untouched.
- `DONE` Payout authoritative completion with exactly-once ledger consumption, provider cost/asset accounting and durable `payout.completed` merchant event.
- `DONE` Payout authoritative definitive failure with exactly-once blocked -> available release and durable `payout.failed` merchant event.
- `DONE` Same-terminal evidence absorption and contradictory terminal evidence conflict classification without financial rewind.
- `DONE` First-class Refund and refund-attempt resource schema.
- `DONE` Payment refund-fee policy snapshot boundary.
- `DONE` Refund funding reservation with source-Payment serialization and cumulative refundable-limit enforcement.
- `DONE` Refund request replay/idempotency conflict behavior; canonical Payment collection state remains `paid`.
- `PENDING` Refund terminal/`execution_unknown` evidence application and ledger coupling.
- `DONE` Current executable refund-reservation economics are fail-closed to `merchant_fee_non_refundable`; refundable-fee policies remain pending their own allocation tests.

Migrations:

- `20260814043000_payout_refund_foundation.sql`
- `20260814044000_payment_refund_policy_snapshot.sql`
- `20260814050000_financial_reservations.sql`
- `20260814052000_payout_execution_claim_foundation.sql`
- `20260814053000_payout_execution_claim_behavior.sql`
- `20260814054000_payout_resolution_foundation.sql`
- `20260814055000_payout_resolution_behavior.sql`

Validation after payout-resolution GREEN: **12 pgTAP files / 301 tests / PASS**.

### I — reconciliation

- `PENDING` Internal source/domain/ledger/cache reconciliation views/functions.
- `PENDING` External provider-evidence reconciliation surfaces.

## Remaining platform foundation

- `PENDING` Supabase Auth dashboard-user integration beyond schema identity reference.
- `PENDING` Fail-closed RLS/role-policy tests where roles can reach app-owned objects.
- `PENDING` Private KYC Storage buckets/policies.
- `PENDING` Append-only audit-event infrastructure.
- `PENDING` Local sandbox/seed fixtures.
- `PENDING` Trusted API/worker production deployment topology around managed Supabase.

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
- `DONE` FlevoPay Pix-out is outside capability; route must reject locally.
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
processing / execution_unknown -> completed | failed   <- current GREEN boundary
```

Provider runtime scope is frozen:

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

1. refund terminal/`execution_unknown` evidence application RED -> GREEN without enabling an unproven provider refund endpoint;
2. internal/external reconciliation foundation;
3. RLS/KYC-storage/audit/seed/deployment foundation;
4. trusted backend/worker vertical slice;
5. AkkadPag + FlevoPay adapters only, gated by conformance evidence.

## Verification

- Work remains on `agent/foundation-phase-0` and draft PR #1.
- `main` remains untouched.
- Legacy `SwiftPay-Prod/swiftpay---Prod` has not been mutated.
- Phase 2 PostgreSQL/Supabase implementation is active and test-driven.
- Latest payout-resolution boundary: **12 pgTAP files / 301 tests / PASS** on GitHub Actions.
- No production HTTP API/provider adapter has been introduced yet.
- Repository artifacts, not chat context, are the canonical engineering source of truth.
