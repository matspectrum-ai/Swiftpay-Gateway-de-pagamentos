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
- `PENDING` Produce legacy capability matrix with `KEEP | SIMPLIFY | REPLACE | REMOVE | DEFER` decisions.
- `PENDING` Produce endpoint inventory and public compatibility matrix.
- `PENDING` Produce provider integration inventory, including webhook/status quirks.
- `PENDING` Produce database/entity inventory and identify duplicated/derived state.
- `PENDING` Produce frontend route/capability inventory.
- `PENDING` Produce event/queue/job inventory and determine which asynchronous flows are genuinely required.
- `PENDING` Produce security/authentication inventory.
- `PENDING` Produce migration data classification: migrate, recompute, archive, discard.

## Phase 1 — Product and domain specification

- `PENDING` Approve V2 product boundary.
- `PENDING` Define merchant lifecycle and onboarding/KYC contract.
- `PENDING` Define API credential model.
- `PENDING` Define Pix charge state machine.
- `PENDING` Define provider adapter contract.
- `PENDING` Decide whether Hyperswitch is used for Pix orchestration or a smaller native adapter layer is retained.
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

- Repository selected as canonical SwiftPay V2 source of truth.
- Foundation branch created: `agent/foundation-phase-0`.
- Governance established.

### Verification

- GitHub repository is accessible with write/admin permission.
- Branch was created from `main` initial commit.

### Next concrete action

Continue the legacy code audit and populate the capability/dependency matrix before introducing production framework code.