# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-13

This file is the durable backlog and handoff ledger for the reconstruction.

## States

- `PENDING`: known, not started
- `IN_PROGRESS`: actively being worked
- `BLOCKED`: requires external action or unresolved decision
- `DONE`: completed with evidence recorded
- `DROPPED`: deliberately removed from scope with rationale
- `SUPERSEDED`: replaced by a later decision

## Phase 0 — Foundation and reverse engineering

- `DONE` Create reconstruction repository.
- `DONE` Establish agent governance in `AGENTS.md`.
- `IN_PROGRESS` Build a defensible inventory of the legacy SwiftPay codebase and behavior.
- `DONE` Define reverse-engineering method and evidence standards.
- `DONE` Record initial target scope: Pix-first, materially simpler architecture.
- `DONE` Record initial target architecture centered on Supabase/PostgreSQL.
- `DONE` Record foundational financial invariants.
- `DONE` Record V2 product vision: Payments + Conversion Intelligence + Revenue Automation for digital sellers.
- `DONE` Record merchant experience principles: progressive disclosure, few mental models, seller-language defaults and financial truthfulness.
- `DONE` Record Brand System v0 exploration baseline; final brand lock requires representative UI concepts and accessibility validation.
- `PENDING` Complete line-oriented audit of all author-written legacy source and relevant configuration.
- `IN_PROGRESS` Produce legacy capability matrix with `KEEP | SIMPLIFY | REPLACE | REMOVE | DEFER` decisions; broad frontend/product capability disposition is complete, remaining backend-only capabilities close with their specialist audits.
- `IN_PROGRESS` Produce endpoint inventory and public compatibility matrix; core auth/transactions/balance/cashout/webhook/sandbox-refund surface audited, BaseResponse/OpenAPI remainder pending.
- `IN_PROGRESS` Produce provider integration inventory, including webhook/status quirks; all 12 `IAcquirerService` implementations audited, retained-provider client/DTO/webhook/status/refund-contract detail still pending.
- `DONE` Audit current exact-brand Hyperswitch connector coverage for the 12 legacy SwiftPay provider names; no first-party exact-brand connector occurrence found in the current connector crate.
- `DONE` Close provider-orchestration baseline for the first V2 release: native thin Pix adapters; Hyperswitch remains only a future optional adapter boundary.
- `IN_PROGRESS` Produce database/entity inventory and identify duplicated/derived state; core payment/ledger/account/payout/KYC/auth/storage mappings audited.
- `DONE` Produce frontend route/capability inventory and classify user-facing capabilities for V2.
- `DONE` Produce core event/queue/job inventory and determine required async boundaries; legacy RabbitMQ/MassTransit/Hangfire/Valkey topology does not survive as the first-release baseline.
- `DONE` Audit API credential management and internal API authentication boundary.
- `DONE` Audit KYC/onboarding and sensitive-document storage/security boundary.
- `IN_PROGRESS` Produce security/authentication inventory; merchant/API credential, internal auth, KYC/storage and selected provider-webhook auth paths audited; retained-provider webhook details remain in provider deep-dive.
- `PENDING` Produce migration data classification: migrate, recompute, archive, discard.

### Financial audit checkpoints

- `DONE` Complete line-oriented audit of legacy `LedgerService`.
- `DONE` Complete line-oriented audit of legacy `LedgerRepository`.
- `DONE` Complete line-oriented audit of legacy `CalculationService`.
- `DONE` Complete line-oriented audit of legacy `FeeCalculator`.
- `DONE` Complete line-oriented audit of legacy `BankReconciliationService`.
- `DONE` Audit merchant payout creation/reservation and terminal webhook locking path.
- `DONE` Audit core public cashout contract and `ProcessCashoutConsumer`/`WithdrawService` provider-execution path.
- `DONE` Record payout reservation concurrency/idempotency risk and V2 fail-first concurrency contract.
- `DONE` Record external Pix-out unknown-result flaw: generic provider exceptions become definitive failure and release blocked funds.
- `DONE` Record generic HTTP retry risk for monetary provider POSTs; 10 legacy provider clients use method-agnostic retry policy.
- `DONE` Record cashout Sandbox create/simulate reachability mismatch.
- `DONE` Record legacy reserve-vs-reconciliation model incompatibility.
- `DONE` Record legacy platform-profit vs platform-withdrawable calculation discrepancy as unresolved fund-flow risk.
- `PENDING` Audit platform payout execution end-to-end.
- `DONE` Audit core refund execution/endpoints, state transitions and partial-refund event identity; retained-provider external refund contracts remain in provider deep-dive.
- `DONE` Record absence of a generic production refund execution abstraction; MagicPay contains an uncalled concrete refund HTTP method while production core primarily reacts to refund webhooks.
- `DONE` Record refund state-machine defect: after first `PartiallyRefunded`, later partial or final refund events cannot be represented because refund targets accept only `Completed` source state.
- `DONE` Record Bankizi refund-request dead-end: `Completed -> Processing` on `RequestedRefund`, while final refund targets do not accept `Processing`.
- `DONE` Record lack of first-class refund/source-event identity and ambiguity between provider cumulative refunded totals and per-event refund deltas.
- `DONE` Record HeartPay partial-refund normalization gap: status can map to `PartiallyRefunded` but inspected webhook path does not pass a refund amount to the consumer/ledger.
- `DONE` Record Sandbox refund parity mismatch: Sandbox can directly simulate full refund, but no equivalent generic production refund-request contract was found; no partial-refund simulation exists in the inspected path.
- `PENDING` Audit all financial migrations/constraints relevant to source-event idempotency.
- `PENDING` Determine current production usage of non-zero merchant reserve/compensation settings from safe configuration evidence.

### Public/API security checkpoints

- `DONE` Audit `/v1/auth/token` client-credentials flow.
- `DONE` Confirm credential status + `secret_version` invalidate existing JWTs on subsequent requests.
- `DONE` Audit public Pix transaction create/get/list core contract.
- `DONE` Audit public balance projection and record available/withdrawable/reserved/blocked semantic mismatch.
- `DONE` Audit core public cashout create/get/list/cancel semantics and payout execution lifecycle.
- `DONE` Audit public Sandbox transaction simulation refund path.
- `DONE` Audit payment and payout merchant-webhook signing services.
- `DONE` Record cryptographic weakness: legacy merchant webhook HMAC key is public payment/payout ID.
- `DONE` Audit merchant webhook retry layering and record mismatch between persisted attempt count and actual HTTP transport retries.
- `DONE` Audit sandbox cashout simulation relationship and record create/simulate mismatch.
- `DONE` Audit API credential creation/regeneration/revocation management and derive V2 one-time-secret/step-up-auth requirements.
- `DONE` Audit internal API authentication/dependencies and establish in-process modular-monolith calls as the default V2 boundary.
- `DONE` Audit KYC lifecycle authorization and prove that legacy production capability checks can rely on `MerchantStatus.Active` before KYC approval.
- `DONE` Audit KYC file visibility/ownership/deletion boundary and derive private, tenant-bound, versioned evidence requirements.
- `PENDING` Audit BaseResponse/error envelope and public OpenAPI compatibility in full.

### Async consistency checkpoints

- `DONE` Inventory the 23 logical RabbitMQ queue names and registered MassTransit consumers.
- `DONE` Inventory Hangfire/Valkey recurring jobs and identify the actual minutely/five-minute schedules.
- `DONE` Confirm no transactional MassTransit/EF outbox in the audited path.
- `DONE` Record payment-webhook dual-write window: terminal DB state can commit before `PaymentCompleted` publication, allowing completed payment without guaranteed ledger/side effects.
- `DONE` Record Pix-create dual-write window: Payment/PaymentPix persist before pending-ledger publication.
- `DONE` Record cashout execution-task dual-write window: funds can be reserved/blocked before process message publication.
- `DONE` Set first-release V2 async baseline: PostgreSQL transactional outbox/jobs + small worker; dedicated broker/scheduler infrastructure only if measured need justifies it.

### Frontend/product capability checkpoints

- `DONE` Inventory merchant/admin route tree and primary navigation.
- `DONE` Audit merchant dashboard information model and classify it as a V2 Home replacement rather than a cache-pipeline port.
- `DONE` Audit Payment Link management and public runtime; retain as a first-class Pix selling surface with progressive disclosure.
- `DONE` Audit hosted Checkout runtime/editor breadth; retain the hosted conversion surface but defer catalog/stock/shipping/template-builder complexity.
- `DONE` Audit legacy integration UI truth; configurable providers observed are Utmify, Otimizey and Facebook CAPI while several other cards are `coming soon` only.
- `DONE` Establish V2 information-architecture collapse around Home, Sales, Conversion, Wallet, Automations and Integrations.
- `DONE` Defer/remove initial commerce-platform scope: products/orders/stock/digital delivery/services/coupons where not required by the Pix selling spine.

## Phase 1 — Product and domain specification

- `IN_PROGRESS` Approve detailed V2 product boundary; product category/pillars and broad frontend capability disposition are approved, detailed contracts remain open.
- `DONE` Establish product vision and high-level seller mental model in `docs/product/product-vision.md`.
- `DONE` Establish merchant experience principles in `docs/product/experience-principles.md`.
- `IN_PROGRESS` Establish SwiftPay brand/design system; v0 palette/voice/data-viz direction recorded, representative UI concepts and validation pending.
- `PENDING` Define merchant lifecycle and onboarding/KYC contract from the audited explicit approved-KYC financial gate.
- `PENDING` Define API credential model from the audited one-time secret/rotation/revocation/step-up requirements.
- `PENDING` Define Pix charge/payment state machine.
- `PENDING` Define native provider adapter contract and capability matrix.
- `DONE` Close provider-orchestration ADR: native thin Pix adapters are the initial baseline; Hyperswitch is not an initial dependency.
- `PENDING` Define fee model.
- `PENDING` Define ledger chart of accounts and posting rules.
- `PENDING` Define balance semantics: pending, available, reserved, blocked/in-payout.
- `PENDING` Define payout/withdrawal state machine; V2 must distinguish definitive provider failure from `execution_unknown/recovery_required`.
- `PENDING` Define first-class refund resource/state machine and refundable-balance concurrency contract based on `docs/reverse-engineering/refunds.md`.
- `PENDING` Define merchant webhook contract, signing, retries and delivery log.
- `PENDING` Define transactional outbox/job/worker contract.
- `PENDING` Define sandbox semantics.
- `PENDING` Define reconciliation boundary.
- `PENDING` Define admin operational capabilities.
- `PENDING` Define Checkout contract and merchant-branding boundary.
- `PENDING` Define Payment Link contract.
- `PENDING` Define Quick Pix seller flow.
- `PENDING` Define conversion-event taxonomy and metric denominators.
- `PENDING` Define UTM attribution model and analytics retention/deduplication.
- `PENDING` Define constrained automation model (`EVENT -> CONDITION -> ACTION`).
- `PENDING` Define integration contract for UTMify, n8n, WhatsApp, Telegram and generic webhooks.
- `PENDING` Define wallet top-up/fund-flow semantics; top-up must remain financially distinct from sales.
- `PENDING` Define direct Pix-out/payment-from-balance product contract.
- `PENDING` Define seller ranking eligibility/privacy rules; ranking remains isolated from financial core.
- `PENDING` Define developer experience roadmap: OpenAPI, SDK, CLI and safe MCP/agent integration.

## Phase 2 — Supabase foundation

- `PENDING` Create Supabase project/environment strategy.
- `PENDING` Define schemas and migrations.
- `PENDING` Configure Auth.
- `PENDING` Implement RLS policies with fail-closed tests.
- `PENDING` Configure separate public asset and private KYC Storage buckets/policies.
- `PENDING` Create audit/event infrastructure.
- `PENDING` Create transactional outbox/job tables and worker claim/recovery primitives.
- `PENDING` Create financial database functions for atomic posting/state transitions.
- `PENDING` Create local development seed/sandbox data.
- `PENDING` Decide production application runtime/deployment topology (managed Supabase foundation + SwiftPay API/worker deployment remains current direction).

## Phase 3 — First vertical slice

Target flow:

`signup -> merchant -> KYC -> approve -> API key -> create Pix -> provider webhook -> ledger -> balance -> merchant webhook`

- `PENDING` Write vertical-slice contract tests first.
- `PENDING` Implement auth/merchant profile.
- `PENDING` Implement minimal KYC.
- `PENDING` Implement API credential issuance/verification.
- `PENDING` Implement Pix creation.
- `PENDING` Integrate first provider.
- `PENDING` Implement provider webhook normalization/idempotency.
- `PENDING` Implement atomic ledger postings.
- `PENDING` Implement balance read model.
- `PENDING` Implement transactional outbox/worker for post-commit effects.
- `PENDING` Implement signed merchant webhooks.
- `PENDING` Build minimal merchant/admin UI for the slice.

## Phase 4 — Selling surfaces and conversion

- `PENDING` Implement hosted Pix Checkout over canonical Payment Core.
- `PENDING` Implement Payment Links over canonical Payment Core.
- `PENDING` Implement Quick Pix seller flow over canonical Payment Core.
- `PENDING` Implement canonical product/payment event capture.
- `PENDING` Implement conversion funnel and approved/lost sale metrics.
- `PENDING` Implement UTM/campaign attribution.
- `PENDING` Implement provider conversion observability.
- `PENDING` Implement actionable/recoverable-revenue insights with estimate labeling.

## Phase 5 — Wallet, payouts and operations

- `PENDING` Payout account management.
- `PENDING` Withdrawal request and approval policy.
- `PENDING` Provider Pix-out integration with explicit idempotency/recovery capabilities.
- `PENDING` Payout webhook/idempotency.
- `PENDING` Ledger posting for blocked/completed/failed/unknown payouts.
- `PENDING` Reconciliation views and admin tooling.
- `PENDING` Implement wallet statement/read model.
- `PENDING` Implement Pix top-up only after approved fund-flow/provider contract.
- `PENDING` Implement Pix payment from balance where approved.

## Phase 6 — Revenue automation and integrations

- `PENDING` Implement durable integration/outbox execution foundation.
- `PENDING` Implement automation rules/executions without a generic workflow platform.
- `PENDING` Implement unpaid-Pix recovery template.
- `PENDING` Implement UTMify integration.
- `PENDING` Implement n8n integration surface.
- `PENDING` Implement WhatsApp integration through an approved provider/contract.
- `PENDING` Implement Telegram integration.
- `PENDING` Add seller ranking only after canonical sales eligibility/privacy spec is approved.

## Phase 7 — Developer experience

- `PENDING` Publish canonical OpenAPI and integration guide.
- `PENDING` TypeScript SDK if it materially reduces integration friction.
- `PENDING` SwiftPay CLI/bootstrap flow if justified.
- `PENDING` Safe MCP/agent integration surface if approved.
- `PENDING` Agent-readable examples for coding-agent workflows.

## Phase 8 — Migration and cutover

- `PENDING` Build legacy -> V2 migration mapping.
- `PENDING` Create replay/parity test harness.
- `PENDING` Validate provider behavior against legacy known cases.
- `PENDING` Shadow-read / dual-run strategy where applicable.
- `PENDING` Data migration dry run.
- `PENDING` Rollback plan.
- `PENDING` Production cutover plan and acceptance criteria.

## Current handoff

### Completed in current audit wave

- Repository foundation/governance, product direction, design baseline and Phase 0 architecture corpus.
- Adapter-level audit of all 12 legacy payment providers plus preliminary Hyperswitch fit check and native-adapter baseline decision.
- Full legacy ledger/repository, fee/calculation, balance and reconciliation core audit.
- Merchant payout reservation, public cashout/Pix-out, unknown-result and terminal webhook audit.
- Core public gateway auth/transactions/balance, merchant outbound-webhook and refund audits.
- API credential management and internal API authentication audit.
- KYC/onboarding lifecycle plus sensitive document storage/tenant-isolation audit.
- RabbitMQ/MassTransit/Hangfire/Valkey inventory and transactional-outbox consistency audit.
- Merchant/admin/checkout/payment-link/integration frontend capability inventory with explicit V2 dispositions.

### Durable evidence added

- `docs/product/product-vision.md`
- `docs/product/experience-principles.md`
- `docs/design/brand-system-v0.md`
- `docs/reverse-engineering/provider-inventory.md`
- `docs/reverse-engineering/provider-retention.md`
- `docs/reverse-engineering/hyperswitch-fit.md`
- `docs/reverse-engineering/financial-ledger.md`
- `docs/reverse-engineering/financial-calculation.md`
- `docs/reverse-engineering/reconciliation.md`
- `docs/reverse-engineering/public-gateway-api.md`
- `docs/reverse-engineering/cashout-and-pixout.md`
- `docs/reverse-engineering/refunds.md`
- `docs/reverse-engineering/api-credentials-and-internal-auth.md`
- `docs/reverse-engineering/kyc-onboarding-storage.md`
- `docs/reverse-engineering/async-jobs-and-outbox.md`
- `docs/reverse-engineering/frontend-capability-inventory.md`

### Verification

- All reconstruction changes remain isolated on `agent/foundation-phase-0`.
- Draft PR #1 tracks foundation/audit/product-definition work.
- No production implementation or mutation of `SwiftPay-Prod/swiftpay---Prod` has been introduced.
- Checkout, Payment Link, Quick Pix and REST Pix are now explicitly modeled as channels over one future Payment Core rather than separate financial systems.
- First-release async baseline is PostgreSQL transaction + durable outbox/jobs + a small worker, not inherited broker/scheduler topology.
- Production financial capability is explicitly intended to require approved KYC in trusted backend authorization.

### Highest-value next concrete action

Continue Phase 0 with the remaining unresolved evidence in this order:

1. produce migration data classification (`migrate | recompute | archive | discard`) for legacy entities and derived/cache state;
2. audit platform payout execution end-to-end and remaining financial migrations/source-event uniqueness constraints;
3. finish retained-provider webhook/client/status/refund-contract deep dives and final provider retention/capability matrix;
4. finish BaseResponse/error/OpenAPI public compatibility inventory;
5. inspect safe evidence for actual non-zero reserve/compensation usage where available.

After those gates, Phase 1 can close the exact chart of accounts, Pix/refund/payout state machines, public compatibility contract, KYC/API-key contracts, outbox contract and first implementation-ready vertical-slice tests.