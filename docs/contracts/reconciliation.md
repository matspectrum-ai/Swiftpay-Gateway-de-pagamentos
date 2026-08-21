# SwiftPay V2 — Reconciliation Contract

Status: Phase 1 foundational contract

## Purpose

Reconciliation is independent evidence that canonical business state, ledger state and provider state agree. It is not a mechanism for silently rewriting financial history.

## Layers

SwiftPay V2 separates four layers:

1. database invariants;
2. internal business-to-ledger reconciliation;
3. external provider settlement reconciliation;
4. explicit audited correction.

These layers answer different questions and never collapse into one service.

## Layer 1 — prevent impossible state

The database prevents known invalid states before reconciliation:

- unique canonical accounts;
- balanced double-entry postings;
- unique financial source identity;
- atomic payout reservation;
- non-negative available balance unless a future debt product explicitly permits otherwise;
- deterministic state transitions;
- immutable monetary snapshots.

Reconciliation is not a substitute for these constraints.

## Layer 2 — internal consistency

Rebuild expected ledger effects from canonical Payment, Refund, Payout, WalletTopUp and approved Adjustment source events and compare them with ledger postings/account projections.

Every merchant-owned and platform/provider account used by the approved chart must be included. No account class may be omitted merely because it complicates the reconstruction.

Internal reconciliation is read-only by default.

It can detect, for example:

- canonical source event with no financial posting;
- posting with no valid source;
- duplicate source posting;
- incorrect amount/account template;
- account cache differing from sum of entries;
- negative available balance;
- refund/payout total inconsistent with source aggregate.

## Layer 3 — provider truth

External reconciliation compares independent PSP evidence with SwiftPay canonical state and provider-clearing/funding ledger accounts.

Provider evidence may come from transaction/status APIs, payout APIs, settlement reports, balance/statement exports or other provider-authoritative sources.

It must be able to flag at least:

```text
provider paid, SwiftPay not paid
SwiftPay paid, provider operation absent
amount mismatch
fee/cost mismatch
payout outcome mismatch
unknown execution unresolved too long
provider clearing/funding mismatch
```

Provider deactivation for new routing does not suppress reconciliation of historical operations.

## Reconciliation identity

Each run has a durable ID, scope, evidence window/version, started/completed timestamps and status. A discrepancy has a stable ID and remains traceable across investigation/correction.

Repeated runs may rediscover the same unresolved discrepancy without generating duplicate financial corrections.

## Corrections

Never edit ledger history or source Payment/Payout/Refund rows to make a report pass.

A financial correction is a new compensating source event/posting with:

```text
correction_id
actor/automation identity
reason code
human explanation
evidence reference
discrepancy_id
approval data when required
created_at
```

High-impact corrections require operator step-up/approval according to admin policy.

Automatic correction is disabled by default. It may later be enabled only for narrowly proven deterministic cases.

## Unknown external execution

`execution_unknown` is a first-class reconciliation target.

Reconciliation may resolve an unknown operation only from sufficiently authoritative provider evidence. Resolution applies the same canonical transition/posting source identity as webhook/query recovery and therefore remains exactly-once financially.

## Merchant balance semantics

Reconciliation uses canonical ledger account semantics from `ledger-and-balance.md`, not merchant UI labels.

`available`, `reserved`, `blocked_payouts` and any future hold account are reconciled according to actual postings. Displayed `withdrawable` is a policy/read projection and is tested separately from ledger ownership.

## Provider funding

Merchant liability is not reconstructed per PSP merely because a Payment was routed through that PSP. Provider funding/clearing accounts track physical provider location separately from merchant ownership.

This keeps provider routing changes from changing the meaning of merchant balance.

## Observability

Operators can see run scope, counts, discrepancies, severity, evidence source, unresolved unknown executions and corrections linked to each discrepancy.

Severity thresholds are explicit operations policy, not hard-coded arbitrary cent thresholds in domain logic.

## Required fail-first tests

1. source event missing its required ledger posting is detected;
2. duplicate posting for one source identity is prevented/detected;
3. account cache mismatch with entries is detected;
4. every canonical merchant-owned account participates in internal reconciliation;
5. negative available cannot be created through normal financial functions;
6. provider-paid/internal-pending discrepancy is detected;
7. internal-paid/provider-absent discrepancy is detected;
8. provider amount/cost mismatch is detected without rewriting history;
9. unknown payout/refund/payment can be resolved once from authoritative provider evidence;
10. repeated reconciliation cannot duplicate a correction;
11. correction is append-only and linked to discrepancy/evidence/actor;
12. provider deactivation does not hide historical reconciliation;
13. merchant balance reconciliation is independent from provider routing bucket;
14. UI withdrawable projection cannot change ledger ownership totals.
