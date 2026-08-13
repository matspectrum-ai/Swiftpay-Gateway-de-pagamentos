# SwiftPay V2 — Agent Governance

This repository is the canonical source of truth for the SwiftPay reconstruction.

## Mission

Rebuild SwiftPay as a substantially simpler, Pix-first payment platform while preserving the financial and operational invariants that matter from the legacy system.

Legacy reference repository:

- `SwiftPay-Prod/swiftpay---Prod`

The legacy repository is evidence and behavioral reference. It is **not** the architecture template for this repository.

## Mandatory startup sequence

Every agent or contributor must read, in order:

1. `AGENTS.md`
2. `TODOS.md`
3. `docs/reverse-engineering/audit-method.md`
4. `docs/reverse-engineering/legacy-inventory.md`
5. `docs/specs/rebuild-scope-v0.md`
6. `docs/architecture/target-architecture.md`
7. `docs/contracts/financial-invariants.md`
8. Relevant ADRs under `docs/decisions/`

## Engineering rules

### 1. No implementation without a contract

Before production code for a behavior is added, the repository must contain:

- the problem statement;
- expected behavior;
- domain/financial invariants;
- API or internal contract;
- failure modes;
- tests that demonstrate the behavior.

### 2. Test-first for financial behavior

Ledger, balances, fees, settlement, refunds, payouts, idempotency and webhook state transitions require fail-first tests before implementation.

### 3. Money is integer cents

All BRL monetary values are represented as integer centavos (`bigint`/`int8`) at persistence and domain boundaries. Floating point is forbidden for financial amounts.

Percentages must use integer basis points unless an ADR explicitly defines another representation.

### 4. Provider invisibility

External merchants must not depend on provider-specific identifiers, payloads, status names or credentials. Provider details stay behind an adapter/orchestration boundary.

### 5. Idempotency is mandatory

Any operation that can be retried or delivered more than once must have a deterministic idempotency contract. This includes:

- Pix creation;
- provider webhooks;
- ledger postings;
- payout requests;
- payout webhooks;
- outgoing merchant webhooks.

### 6. Database integrity over application convention

Critical financial invariants must be enforced by PostgreSQL transactions, constraints, unique keys and/or database functions where appropriate. Do not rely only on frontend or application checks.

### 7. Supabase is infrastructure, not the financial model

Supabase may provide PostgreSQL, Auth, Storage, Realtime and serverless primitives. It does not replace domain modeling, ledger correctness, authorization design, reconciliation or provider contracts.

### 8. RLS must fail closed

Merchant-facing data uses explicit Row Level Security policies. Service-role access is limited to trusted server-side execution. No sensitive financial table is exposed through permissive policies.

### 9. Secrets never enter the client or durable docs

Provider credentials, webhook secrets, service-role tokens and signing keys must never be committed or exposed to browser code.

### 10. No feature parity by default

A legacy feature survives only if one of these is true:

- required for the target product;
- required for financial correctness;
- required for compliance/security;
- required for migration compatibility;
- explicitly approved as product scope.

Otherwise it is a candidate for removal.

## Required workflow for substantial changes

1. Problem analysis
2. Specification
3. Contracts/invariants
4. Fail-first tests
5. Minimal implementation
6. Refactor
7. Verification evidence
8. Documentation/TODO update

## Durable handoff

Before ending a substantial work unit, update `TODOS.md` with:

- completed scope;
- evidence/verification;
- changed files;
- open risks;
- next concrete action.

New architecture decisions belong in `docs/decisions/`.

New reverse-engineering evidence belongs in `docs/reverse-engineering/`.

## Production safety

The legacy production system must not be modified as part of reconstruction unless a separate, explicit migration/cutover plan has been approved.

The V2 repository starts as an isolated system. Migration comes later and must be reversible until final cutover.