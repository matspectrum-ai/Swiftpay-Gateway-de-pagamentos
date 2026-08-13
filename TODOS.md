# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-13

This is the durable backlog and handoff ledger for the reconstruction. Detailed evidence lives in the linked product, contract, reverse-engineering and ADR documents; this file tracks status and sequencing rather than duplicating every audit note.

## States

- `PENDING`: known, not started
- `IN_PROGRESS`: actively being worked
- `EVIDENCE_REQUIRED`: design direction exists but external/live evidence is required before activation
- `BLOCKED`: cannot proceed until an external dependency/decision is resolved
- `DONE`: completed with durable evidence/contract recorded
- `DEFERRED`: deliberately postponed from the current release
- `DROPPED`: deliberately removed from scope
- `SUPERSEDED`: replaced by a later decision

# Phase 0 — Foundation and reverse engineering

## Foundation

- `DONE` Create reconstruction repository and canonical documentation structure.
- `DONE` Establish `AGENTS.md` governance and evidence standards.
- `DONE` Record Pix-first rebuild scope and materially simpler architecture.
- `DONE` Select Supabase/PostgreSQL as platform foundation behind a trusted SwiftPay API/worker boundary.
- `DONE` Select modular monolith as first-release application topology.
- `DONE` Define foundational financial invariants.
- `DONE` Define product vision and merchant experience principles.
- `DONE` Establish Brand System v0 exploration baseline.

## Legacy/product inventory

- `DONE` Classify primary merchant/admin/frontend capabilities using `KEEP | SIMPLIFY | REPLACE | REMOVE | DEFER`.
- `DONE` Inventory merchant/admin/checkout/payment-link/integration surfaces.
- `DONE` Define first-release Pix selling spine and defer broad commerce/catalog/stock/digital-delivery breadth.
- `DONE` Produce migration data classification: migrate, recompute, archive, discard or reconcile-at-cutover.
- `PENDING` Complete exhaustive line-oriented sweep of remaining author-written legacy source/configuration. This is a completeness task; it does not block already-audited retained-domain contracts unless it reveals a contradiction.

## Providers

- `DONE` Audit all 12 legacy `IAcquirerService` implementations at adapter level.
- `DONE` Audit exact-brand Hyperswitch connector coverage; no first-party exact-brand connector match was found for the 12 legacy provider names at the audited revision.
- `DONE` Close provider-orchestration ADR: native thin Pix adapters are the first-release baseline; Hyperswitch is only a future optional adapter boundary.
- `DONE` Produce engineering provider-retention tiers and operation-specific safety gates.
- `DONE` Deep-dive Accithus vs MagicPay for first provider proof.
- `EVIDENCE_REQUIRED` MagicPay Pix-in: first proof candidate; prove `ExternalRef` query/recovery or provider-side dedupe before `RETAIN`.
- `EVIDENCE_REQUIRED` Accithus Pix-out: strong first proof candidate; prove provider honors repeated `Idempotency-Key: PayoutId` as one external transfer before `RETAIN`.
- `IN_PROGRESS` Finish retained-provider client/webhook/status/refund contract deep dives for any provider that remains commercially relevant.

## Financial core

- `DONE` Audit legacy `LedgerService` and `LedgerRepository`.
- `DONE` Audit fee/calculation services.
- `DONE` Audit internal reconciliation behavior.
- `DONE` Audit merchant payout reservation/execution/webhook paths.
- `DONE` Record payout concurrent overspend risk and require atomic reservation.
- `DONE` Record unknown-result flaw where legacy provider exceptions can release funds despite possible external execution.
- `DONE` Record method-agnostic HTTP retry risk on monetary provider POSTs.
- `DONE` Audit refund state/source identity and repeated-partial-refund defects.
- `DONE` Audit platform payout/provider sweep execution and defer it from initial V2 pending treasury/fund-ownership contracts.
- `DONE` Audit material financial migrations/source-event constraints.
- `DONE` Record historical duplicate `SettlementOut` repair as evidence that database idempotency is a launch requirement.
- `DONE` Record nullable account identity/read-before-insert race and require deterministic database account identity/upsert.
- `EVIDENCE_REQUIRED` Determine actual live use of non-zero reserve/compensation settings from safe production/configuration evidence. First-release design keeps risk reserve disabled until this evidence/ADR says otherwise.

## Public API/security

- `DONE` Audit client-credentials token flow and immediate credential revocation/secret-version behavior.
- `DONE` Audit Pix create/get/list public contract.
- `DONE` Audit public balance semantic mismatch (`available` vs `withdrawable`, reserve vs blocked).
- `DONE` Audit public cashout create/get/list/cancel and sandbox relation.
- `DONE` Audit merchant payment/payout webhook signing/retry behavior.
- `DONE` Record legacy merchant-webhook HMAC weakness and non-durable delivery identity.
- `DONE` Audit API credential lifecycle and internal API authentication boundary.
- `DONE` Audit KYC lifecycle and prove legacy production financial access can precede approved KYC.
- `DONE` Audit KYC storage visibility/ownership/deletion weaknesses.
- `DONE` Audit BaseResponse/error envelope and source-level OpenAPI behavior.
- `DONE` Record first-validation-error loss, inconsistent `error.code`, and source OpenAPI/runtime mismatch.

## Async consistency

- `DONE` Inventory RabbitMQ/MassTransit logical queues/consumers.
- `DONE` Inventory Hangfire/Valkey recurring work.
- `DONE` Confirm lack of transactional outbox around audited financial/message boundaries.
- `DONE` Record payment, Pix-create and cashout DB/message dual-write windows.
- `DONE` Set first-release async baseline: PostgreSQL transactional outbox/jobs + small worker.

# Phase 1 — Product and domain specification

## Core contracts

- `DONE` Product vision: `docs/product/product-vision.md`.
- `DONE` Merchant experience principles: `docs/product/experience-principles.md`.
- `IN_PROGRESS` Brand/design system; representative UI concepts and accessibility validation remain.
- `DONE` Financial invariants: `docs/contracts/financial-invariants.md`.
- `DONE` Payment + ProviderAttempt + create idempotency: `docs/contracts/payment-and-provider-attempt.md`.
- `DONE` Ledger chart, posting/source identity and balance semantics: `docs/contracts/ledger-and-balance.md`.
- `DONE` Native provider capability/adapter contract: `docs/contracts/native-pix-provider-adapter.md`.
- `DONE` PostgreSQL transactional outbox/job/lease contract: `docs/contracts/outbox-and-jobs.md`.
- `DONE` Payout/Pix-out state machine: `docs/contracts/payout.md`.
- `DONE` First-class Refund resource/state machine: `docs/contracts/refund.md`.

## Contracts still required before implementation-ready vertical slice

- `PENDING` Merchant lifecycle + production KYC authorization contract.
- `PENDING` API credential issuance/verification/rotation/revocation contract.
- `PENDING` Canonical public API success/error/idempotency/status projection contract.
- `PENDING` Fee/pricing model and deterministic rounding/snapshot contract.
- `PENDING` Merchant webhook endpoint/event/delivery/signature/replay contract.
- `PENDING` Sandbox semantics with structural Production exclusion.
- `PENDING` Internal + external reconciliation contract.
- `PENDING` Admin operational capability, step-up authorization and financial repair contract.

## Selling/product surfaces

- `PENDING` Hosted Pix Checkout contract and merchant-branding boundary.
- `PENDING` Payment Link contract.
- `PENDING` Quick Pix seller flow.
- `PENDING` Canonical conversion-event taxonomy and denominators.
- `PENDING` UTM attribution/retention/deduplication.
- `PENDING` Constrained automation model (`EVENT -> CONDITION -> ACTION`).
- `PENDING` Integration contracts for UTMify, n8n, WhatsApp, Telegram and generic webhooks.
- `DEFERRED` Wallet top-up until fund-flow/provider/legal contract is approved.
- `PENDING` Direct Pix-out/payment-from-balance product contract where approved.
- `DEFERRED` Seller ranking until canonical-sales eligibility/privacy rules are approved.
- `PENDING` Developer experience roadmap: canonical OpenAPI, SDK, CLI and safe agent/MCP integration.

# Phase 2 — Supabase/PostgreSQL foundation

No production schema implementation starts until the required Phase 1 core contracts above are closed and fail-first tests/specs are defined.

- `PENDING` Define environment/project strategy.
- `PENDING` Write fail-first database/schema tests.
- `PENDING` Define schemas/migrations from contracts.
- `PENDING` Configure Supabase Auth for dashboard users.
- `PENDING` Implement fail-closed RLS policies and tests.
- `PENDING` Configure public asset vs private KYC storage buckets/policies.
- `PENDING` Create API credential/request-idempotency/provider-event source identity primitives.
- `PENDING` Create ledger accounts/transactions/entries and controlled financial posting functions.
- `PENDING` Create durable jobs/outbox claim/lease/recovery primitives.
- `PENDING` Create audit/event infrastructure.
- `PENDING` Create local seed/sandbox fixtures.
- `PENDING` Decide trusted SwiftPay API/worker production deployment topology around managed Supabase.

# Phase 3 — First vertical slice

Target:

```text
signup
-> merchant
-> KYC
-> approve
-> API credential
-> create Pix
-> native provider
-> authenticated provider event
-> Payment transition
-> ledger posting
-> balance
-> merchant webhook
```

TDD rule: contracts and failing tests precede production implementation.

- `PENDING` Vertical-slice acceptance/contract tests.
- `PENDING` Auth/merchant profile.
- `PENDING` Minimal KYC + approval capability gate.
- `PENDING` API credential issuance/verification.
- `PENDING` Pix create + request idempotency.
- `EVIDENCE_REQUIRED` Promote first Pix-in provider to `RETAIN` through conformance/sandbox proof; current first proof candidate is MagicPay.
- `PENDING` First retained provider adapter implementation.
- `PENDING` Provider event authentication/normalization/source idempotency.
- `PENDING` Atomic paid-payment ledger posting.
- `PENDING` Canonical balance read model.
- `PENDING` Durable outbox/worker execution.
- `PENDING` Signed durable merchant webhook delivery.
- `PENDING` Minimal merchant/admin UI for the slice.

# Phase 4 — Selling surfaces and conversion

- `PENDING` Hosted Pix Checkout over canonical Payment Core.
- `PENDING` Payment Links over canonical Payment Core.
- `PENDING` Quick Pix seller flow.
- `PENDING` Canonical conversion event capture.
- `PENDING` Conversion funnel and approved/lost sale metrics.
- `PENDING` UTM/campaign attribution.
- `PENDING` Provider conversion observability.
- `PENDING` Actionable/recoverable-revenue insights with explicit estimate labeling.

# Phase 5 — Wallet, payouts and operations

- `PENDING` Payout account management.
- `PENDING` Withdrawal request/approval policy.
- `EVIDENCE_REQUIRED` Promote a Pix-out provider through conformance proof; Accithus is current strong first proof candidate.
- `PENDING` Pix-out adapter execution/recovery.
- `PENDING` Payout event/idempotency/reconciliation.
- `PENDING` Payout ledger postings for reservation/completion/failure/unknown recovery.
- `PENDING` Wallet statement/read model.
- `PENDING` Reconciliation views/admin operations.
- `DEFERRED` Platform treasury/provider sweep until explicit fund ownership, treasury controls and external reconciliation are approved.

# Phase 6 — Revenue automation and integrations

- `PENDING` Durable integration execution foundation on canonical outbox/jobs.
- `PENDING` Automation rules/executions.
- `PENDING` Unpaid-Pix recovery template.
- `PENDING` UTMify integration.
- `PENDING` n8n integration surface.
- `PENDING` WhatsApp integration through approved provider/contract.
- `PENDING` Telegram integration.

# Phase 7 — Developer experience

- `PENDING` Publish canonical OpenAPI/integration guide.
- `PENDING` Add OpenAPI contract/breaking-change CI.
- `PENDING` TypeScript SDK if it materially reduces integration friction.
- `PENDING` SwiftPay CLI/bootstrap flow if justified.
- `PENDING` Safe MCP/agent integration if approved.
- `PENDING` Agent-readable integration examples/fixtures.

# Phase 8 — Migration and cutover

- `PENDING` Build legacy -> V2 migration mapping from approved data classification.
- `PENDING` Create replay/parity harness.
- `PENDING` Capture deployed legacy OpenAPI and representative merchant compatibility fixtures.
- `PENDING` Validate retained provider behavior against legacy/provider conformance cases.
- `PENDING` Shadow-read/dual-run strategy where justified.
- `PENDING` Migration dry run.
- `PENDING` Reconcile open Pix/refunds/payouts and financial opening balances.
- `PENDING` Rollback plan.
- `PENDING` Production cutover plan and acceptance criteria.

# Current handoff

## Durable Phase 1 baseline now established

```text
Payment / ProviderAttempt / RequestIdempotency
                |
                v
Capability-aware native provider adapter
                |
       authenticated ProviderEvent
                |
                v
canonical state transition
+ double-entry ledger posting
+ durable outbox/job
                |
                v
small SwiftPay worker
```

Merchant accounting is provider-independent:

```text
pending_settlement
available
reserved            # disabled by default until explicitly enabled
blocked_payouts
blocked_refunds
withdrawable
```

Provider funding location/cost is represented on the provider asset/expense side and does not fragment merchant ownership by PSP.

## Provider proof status

- MagicPay: first Pix-in proof candidate because source exposes `ExternalRef`, provider payment ID, first-class webhook event ID and HMAC path; `ExternalRef` recovery/create dedupe remains unproven.
- Accithus: weaker Pix-in recovery from inspected source, but strong Pix-out proof candidate because withdrawal sends explicit `Idempotency-Key` derived from `PayoutId`; PSP behavior still requires conformance proof.
- Neither provider is `RETAIN` yet.

## Next execution order

1. define merchant lifecycle/KYC capability contract;
2. define API credential contract;
3. define public API/error/idempotency projection contract;
4. define deterministic fee/pricing/rounding contract;
5. define merchant webhook contract;
6. define sandbox + reconciliation/admin contracts;
7. write Phase 2 fail-first PostgreSQL/Supabase schema tests;
8. only then begin production schema/application implementation.

Remaining Phase 0 provider/live-evidence work continues in parallel and can reopen a contract only when concrete evidence contradicts it.

## Verification

- All reconstruction work remains on `agent/foundation-phase-0` and draft PR #1.
- `main` is untouched by this reconstruction branch.
- No production application implementation has been introduced yet.
- Legacy `SwiftPay-Prod/swiftpay---Prod` has not been mutated.
- The repository, not chat context, is the canonical engineering source of truth.