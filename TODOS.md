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
- `PENDING` Complete line-oriented audit of all author-written legacy source and relevant configuration.
- `IN_PROGRESS` Produce legacy capability matrix with `KEEP | SIMPLIFY | REPLACE | REMOVE | DEFER` decisions.
- `IN_PROGRESS` Produce endpoint inventory and public compatibility matrix; core auth/transactions/balance/webhook surface audited, cashout/internal/sandbox remainder pending.
- `IN_PROGRESS` Produce provider integration inventory, including webhook/status quirks; all 12 `IAcquirerService` implementations audited, client/DTO/webhook/status-converter detail still pending for retained providers.
- `DONE` Audit current exact-brand Hyperswitch connector coverage for the 12 legacy SwiftPay provider names; no first-party exact-brand connector occurrence found in the current connector crate. Alias/upstream mapping remains a separate check.
- `IN_PROGRESS` Produce database/entity inventory and identify duplicated/derived state; core payment/ledger/account/payout entities and DbContext financial mappings audited.
- `PENDING` Produce frontend route/capability inventory.
- `IN_PROGRESS` Produce event/queue/job inventory and determine which asynchronous flows are genuinely required; payment merchant-webhook consumer/retry path audited, complete queue/consumer/job inventory pending.
- `IN_PROGRESS` Produce security/authentication inventory; public API credential/JWT/revocation/rate-limit and selected provider-webhook auth paths audited.
- `PENDING` Produce migration data classification: migrate, recompute, archive, discard.

### Financial audit checkpoints

- `DONE` Complete line-oriented audit of legacy `LedgerService`.
- `DONE` Complete line-oriented audit of legacy `LedgerRepository`.
- `DONE` Complete line-oriented audit of legacy `CalculationService`.
- `DONE` Complete line-oriented audit of legacy `FeeCalculator`.
- `DONE` Complete line-oriented audit of legacy `BankReconciliationService`.
- `DONE` Audit merchant payout creation/reservation and terminal webhook locking path.
- `DONE` Record payout reservation concurrency/idempotency risk and V2 fail-first concurrency contract.
- `DONE` Record legacy reserve-vs-reconciliation model incompatibility.
- `DONE` Record legacy platform-profit vs platform-withdrawable calculation discrepancy as unresolved fund-flow risk.
- `PENDING` Audit platform payout execution end-to-end.
- `PENDING` Audit refund provider execution/endpoints and partial-refund event identity.
- `PENDING` Audit all financial migrations/constraints relevant to source-event idempotency.
- `PENDING` Determine current production usage of non-zero merchant reserve/compensation settings from safe configuration evidence.

### Public/API security checkpoints

- `DONE` Audit `/v1/auth/token` client-credentials flow.
- `DONE` Confirm credential status + `secret_version` invalidate existing JWTs on subsequent requests.
- `DONE` Audit public Pix transaction create/get/list core contract.
- `DONE` Audit public balance projection and record available/withdrawable/reserved/blocked semantic mismatch.
- `DONE` Audit payment and payout merchant-webhook signing services.
- `DONE` Record cryptographic weakness: legacy merchant webhook HMAC key is public payment/payout ID.
- `DONE` Audit merchant webhook retry layering and record mismatch between persisted attempt count and actual HTTP transport retries.
- `PENDING` Audit cashout public request/response/list/status contract.
- `PENDING` Audit sandbox simulation public contract.
- `PENDING` Audit BaseResponse/error envelope and public OpenAPI compatibility in full.
- `PENDING` Audit internal API authentication/dependencies.
- `PENDING` Audit API credential creation/regeneration/revocation management endpoints.

## Phase 1 — Product and domain specification

- `PENDING` Approve V2 product boundary.
- `PENDING` Define merchant lifecycle and onboarding/KYC contract.
- `PENDING` Define API credential model.
- `PENDING` Define Pix charge state machine.
- `PENDING` Define provider adapter contract.
- `PENDING` Decide whether Hyperswitch is used for Pix orchestration or a smaller native adapter layer is retained. Current planning baseline favors native thin Pix adapters because no exact-brand connector coverage was found for the 12 legacy providers; ADR remains open until retained providers/aliases/webhooks/payouts are resolved.
- `PENDING` Define fee model.
- `PENDING` Define ledger chart of accounts and posting rules.
- `PENDING` Define balance semantics: pending, available, reserved, blocked.
- `PENDING` Define payout/withdrawal state machine.
- `PENDING` Define refund rules if refunds remain in V2 scope.
- `PENDING` Define merchant webhook contract, signing, retries and delivery log.
- `PENDING` Define sandbox semantics.
- `PENDING` Define reconciliation boundary.
- `PENDING` Define admin operational capabilities.
- `PENDING` Define checkout/payment-link scope.

## Phase 2 — Supabase foundation

- `PENDING` Create Supabase project/environment strategy.
- `PENDING` Define schemas and migrations.
- `PENDING` Configure Auth.
- `PENDING` Implement RLS policies with fail-closed tests.
- `PENDING` Configure Storage buckets and policies for KYC documents/assets.
- `PENDING` Create audit/event infrastructure.
- `PENDING` Create financial database functions for atomic posting/state transitions.
- `PENDING` Create local development seed/sandbox data.

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
- `PENDING` Implement signed merchant webhooks.
- `PENDING` Build minimal merchant/admin UI for the slice.

## Phase 4 — Payouts and operations

- `PENDING` Payout account management.
- `PENDING` Withdrawal request and approval policy.
- `PENDING` Provider Pix-out integration.
- `PENDING` Payout webhook/idempotency.
- `PENDING` Ledger posting for blocked/completed/failed payouts.
- `PENDING` Reconciliation views and admin tooling.

## Phase 5 — Migration and cutover

- `PENDING` Build legacy -> V2 migration mapping.
- `PENDING` Create replay/parity test harness.
- `PENDING` Validate provider behavior against legacy known cases.
- `PENDING` Shadow-read / dual-run strategy where applicable.
- `PENDING` Data migration dry run.
- `PENDING` Rollback plan.
- `PENDING` Production cutover plan and acceptance criteria.

## Current handoff

### Completed in current work unit

- Repository foundation/governance and Phase 0 architecture corpus.
- Adapter-level audit of all 12 legacy payment providers.
- Preliminary Hyperswitch fit check against the current connector crate.
- Full audit of legacy ledger repository/service, financial calculation/rounding and internal reconciliation service.
- Merchant payout reservation/terminal webhook financial-path audit.
- Core public gateway auth/transactions/balance and merchant outbound-webhook audit.
- Critical legacy behaviors/risks converted into explicit V2 requirements rather than copied blindly.

### Durable evidence added

- `docs/reverse-engineering/provider-inventory.md`
- `docs/reverse-engineering/hyperswitch-fit.md`
- `docs/reverse-engineering/financial-ledger.md`
- `docs/reverse-engineering/financial-calculation.md`
- `docs/reverse-engineering/reconciliation.md`
- `docs/reverse-engineering/public-gateway-api.md`

### Verification

- All reconstruction changes remain isolated on `agent/foundation-phase-0`.
- Draft PR #1 tracks the foundation/audit work.
- No production implementation or legacy production repository mutation has been introduced.

### Highest-value next concrete action

Continue the Phase 0 audit with the remaining financial/public boundaries in this order:

1. cashout public contract + processing consumer/provider unknown-result behavior;
2. refund execution/event identity;
3. retained-provider webhook/client/status-converter details;
4. API credential management endpoints and internal API authentication;
5. KYC/onboarding + storage/security;
6. complete async queue/job inventory;
7. frontend capability inventory.

Only after these boundaries are mapped should Phase 1 close the chart of accounts, provider strategy and public compatibility contract.