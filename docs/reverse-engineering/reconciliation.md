# Legacy SwiftPay — Reconciliation Audit

Status: `BankReconciliationService` fully audited line-oriented. External provider/bank reconciliation paths, if any, still require separate audit.

Legacy source: `SwiftPay-Prod/swiftpay---Prod`

## Scope reviewed

Complete file:

- `swiftpay-api-core/Services/BankReconciliationService.cs`

Related ledger/payment/payout behavior is documented in:

- `financial-ledger.md`
- `financial-calculation.md`

## What the service actually reconciles

Despite the class name `BankReconciliationService`, the reviewed service does not call a bank or PSP API.

Its primary comparison is:

```text
business source records
Payments + Payouts + manual adjustments
             |
             v
reconstructed expected merchant account impacts
             |
             v
compare with
actual internal LedgerTransactions / LedgerEntries / Account.Balance
```

Therefore this is primarily an **internal business-record-to-ledger consistency reconciliation**, not independent external bank settlement reconciliation.

V2 should name these two concerns separately:

1. `internal ledger reconciliation` — canonical business objects vs ledger;
2. `provider settlement reconciliation` — SwiftPay records vs independent PSP/bank evidence.

They answer different questions and must not be conflated.

## Lifecycle

A reconciliation is created per merchant/environment.

Legacy prevents a new run when another run for that merchant/environment is `Pending` or `Processing`.

Processing is asynchronous through a queue:

```text
StartReconciliationAsync
 -> persist BankReconciliation(Pending)
 -> publish ProcessBankReconciliation
 -> consumer calls ProcessReconciliationAsync
```

Final statuses include:

- completed;
- completed with discrepancies;
- failed;
- corrections applied.

Batch mode can queue reconciliation for all active merchants with accounts.

## Accounts tracked

The service explicitly tracks only:

```text
MerchantAvailable
MerchantPending
MerchantBlocked
MerchantPayoutsOut
```

It does **not** track:

```text
MerchantReserved
```

nor provider/platform accounts in the merchant reconstruction logic.

## Expected payment reconstruction

For each payment:

### Pending / Processing

```text
MerchantPending += Payment.NetAmount
```

### Completed

```text
MerchantAvailable += Payment.NetAmount
```

### Refunded / PartiallyRefunded

```text
refund_net = proportional Payment.NetAmount
MerchantAvailable += Payment.NetAmount - refund_net
```

The service then compares these expected impacts with actual merchant-account ledger entries associated with that payment.

It detects:

- payment missing from ledger;
- per-account amount mismatch;
- refund not fully represented in available balance.

## Expected payout reconstruction

### Pending / Processing / Confirming

```text
MerchantAvailable -= Payout.Amount
MerchantBlocked   += Payout.Amount
```

### Completed

```text
MerchantAvailable  -= Payout.Amount
MerchantPayoutsOut += Payout.NetAmount
```

### Failed / Rejected / Cancelled

Expected net merchant-account effect is neutral.

The service can detect:

- payout missing from ledger;
- amount mismatch;
- missing reversal;
- negative available balance;
- aggregate payout outflow greater than reconstructed inflow + manual adjustments.

## Manual adjustments

`MerchantAdjustment` ledger entries are incorporated into expected balances.

This is important because the reconciliation is not simply replaying payments/payouts: it intentionally treats privileged ledger adjustments as legitimate source events.

## Critical reserve incompatibility

The payment ledger supports financial reserve:

```text
Payment completed
 -> MerchantAvailable CREDIT settlement_amount
 -> MerchantReserved  CREDIT reserve_amount
```

where:

```text
NetAmount = settlement_amount + reserve_amount
```

However reconciliation:

- does not track `MerchantReserved`;
- reconstructs a completed payment as `MerchantAvailable += Payment.NetAmount`.

Therefore whenever `reserve_amount > 0`:

```text
expected available = full NetAmount
actual available   = settlement_amount
actual reserved    = reserve_amount   # ignored by reconciliation
```

This produces an apparent `MerchantAvailable` deficit equal to the reserve.

### Why automatic correction is dangerous

`ApplyCorrectionsAsync` computes expected-minus-actual deltas and can create reconciliation adjustment ledger transactions to align tracked account balances.

Because `MerchantReserved` is excluded from the tracked model, the correction can credit `MerchantAvailable` toward the full net amount while the reserved balance remains present.

Conceptually, with:

```text
net      = 10000
available = 8000
reserved  = 2000
```

reconciliation expects:

```text
available = 10000
```

and may schedule:

```text
MerchantAvailable CREDIT 2000
```

without simultaneously removing the existing `MerchantReserved 2000`.

This would make the merchant-account representation inconsistent with the intended reserve semantics.

### Classification

This is a **confirmed model incompatibility** between the reviewed reserve posting rules and the reviewed reconciliation algorithm.

Its production impact depends on whether non-zero reserve is currently enabled for merchants/providers and whether automatic correction is used on those merchants. Those runtime facts have not yet been established.

V2 requirement:

Every ledger account that represents merchant-owned funds must be included in reconciliation, or the reconciliation must explicitly explain why it is excluded.

## Compensation-window distinction

Legacy provider compensation delay is different from `MerchantReserved`.

Compensation-locked funds may remain physically posted in `MerchantAvailable` and are dynamically reclassified at read time as unavailable/pending by `LedgerService`.

The internal reconciliation sees the stored account balance, not the dynamic UI/business availability after compensation subtraction.

This means legacy has at least three different notions:

```text
ledger account balance
merchant displayed/withdrawable balance
reconstructed reconciliation balance
```

V2 should reduce these semantic layers.

## Discrepancy severity

For aggregate account mismatch, the service marks:

```text
abs(actual - expected) > 100 cents -> Critical
otherwise                           -> Error
```

Other conditions such as missing reversal, negative available and withdrawal exceeding inflow are explicitly critical.

V2 should avoid arbitrary severity thresholds embedded in logic without operational rationale. Thresholds belong in an explicit operations policy.

## Negative balance detection

Reconciliation explicitly detects:

```text
MerchantAvailable < 0
```

as critical.

It also computes:

```text
max_supported_outflow = net payment inflow + manual adjustment on available
```

and flags when payout debits exceed that amount.

This confirms that negative merchant available is considered abnormal by legacy operational logic, strengthening the V2 decision to prevent it at the database reservation boundary rather than detect it after the fact.

## Automatic correction behavior

`ApplyCorrectionsAsync`:

1. recomputes reconciliation from current records;
2. identifies error/critical discrepancies;
3. builds deltas by provider/merchant-acquirer bucket;
4. creates missing account rows when needed;
5. writes adjustment/reversal ledger transactions;
6. updates reconciliation metadata and marks corrected discrepancies;
7. notifies merchant/admin.

For payment/payout-specific deltas it uses ledger operation:

```text
Reversal
```

For residual generic account differences it uses:

```text
MerchantAdjustment
```

### Important limitation

The correction source of truth is still SwiftPay's own business records.

If both the payment record and ledger are wrong in the same direction, this internal reconciliation cannot independently discover the external truth.

V2 needs provider settlement reconciliation for that class of error.

## Duplicate-account handling

During correction, if multiple merchant accounts exist for the same bucket + account type, the service:

- chooses the most recently updated/created row as the primary account;
- sums secondary balances;
- logs an error.

This is legacy-repair complexity.

V2 should enforce a database unique constraint so duplicate canonical financial accounts cannot exist rather than teaching normal reconciliation how to choose a winner.

## Bucket model

Reconciliation is provider-bucket aware through `MerchantAcquirerId`.

It reconstructs expected and actual effects per bucket and may produce corrective transactions attached to the original payment or payout.

This is valuable only if V2 retains provider-specific merchant financial buckets.

If V2 decouples merchant liability from provider routing, this entire dimension can disappear from merchant ledger accounts and remain only in provider clearing/reconciliation accounts.

## V2 recommended reconciliation layers

### Layer 1 — database invariants

Prevent impossible state before reconciliation:

- unique financial accounts;
- non-negative available after reservation;
- source-event posting uniqueness;
- balanced posting templates;
- controlled state transitions.

### Layer 2 — internal consistency reconciliation

Rebuild financial effects from canonical payment/payout/refund events and compare with ledger.

This is the closest V2 equivalent to the current `BankReconciliationService`.

It should be read-only by default. Automatic repair should require explicit rules and evidence.

### Layer 3 — provider reconciliation

Use independent provider evidence:

```text
provider transaction/payout/settlement reports or APIs
        vs
SwiftPay canonical events + clearing ledger
```

Detect:

- provider says paid but SwiftPay says pending;
- SwiftPay says paid but provider has no transaction;
- provider settled unexpected amount;
- provider fee differs from snapshot/expected cost;
- payout provider result differs from internal status;
- clearing account differs from provider balance/statement.

### Layer 4 — manual adjustment

Corrections produce explicit compensating entries with:

- actor;
- reason;
- evidence reference;
- original discrepancy;
- approval/audit data.

Never silently edit account history.

## V2 decision supported by audit

Keep the **concept** of reconciliation, but do not port `BankReconciliationService` mechanically.

Specifically:

- rename/split internal vs external reconciliation;
- include every relevant account in internal reconstruction;
- prevent known impossible states at write time;
- avoid auto-correcting from an incomplete account model;
- use explicit provider evidence for external financial truth;
- remove duplicate-account recovery from normal operation through uniqueness constraints.

## Remaining reconciliation audit

Still required:

- search for any other service that actually queries provider bank/balance/statement APIs;
- audit admin reconciliation endpoints and approval controls;
- audit reconciliation consumers/queues;
- audit `BankReconciliation` and discrepancy entity schema;
- audit tests for reserve, payout race, correction and negative-balance cases;
- establish whether non-zero merchant reserve is active in current production configuration;
- establish whether provider-specific balance snapshots are compared to real provider balances anywhere else.