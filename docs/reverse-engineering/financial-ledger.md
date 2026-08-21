# Legacy SwiftPay — Financial Ledger and Payout Audit

Status: `LedgerService`, `LedgerRepository` and payout creation/reservation path audited. Calculation/reconciliation/provider settlement audit remains in progress.

Legacy source: `SwiftPay-Prod/swiftpay---Prod`

## Scope reviewed

Line-oriented review completed for:

- `swiftpay-api-core/Services/LedgerService.cs` — complete file;
- `swiftpay-api-core/Repositories/LedgerRepository.cs` — complete file;
- `swiftpay-api-core/Models/Database/Primary/Account.cs`;
- `swiftpay-api-core/Models/Database/Primary/LedgerTransaction.cs`;
- `swiftpay-api-core/Models/Database/Primary/LedgerEntry.cs`;
- `swiftpay-api-core/Models/Database/Primary/Payout.cs`;
- `swiftpay-api-payment/Services/CashoutService.cs` — payout creation/reservation and webhook lifecycle sections;
- `swiftpay-api-payment/Endpoints/Cashouts/Create/CreateCashoutEndpoint.cs`;
- relevant `PrimaryDbContext` account/ledger/payout mapping and unique constraints.

This document describes what the legacy implementation actually does. It does not automatically approve those semantics for V2.

## Legacy chart of accounts

### Merchant accounts

- `MerchantPending`
- `MerchantAvailable`
- `MerchantBlocked`
- `MerchantReserved`
- `MerchantPayoutsOut`

Merchant accounts can be bucketed by `MerchantAcquirerId`, so a merchant may hold separate financial buckets associated with different provider assignments.

### Platform accounts

- `PlatformBlocked`
- `PlatformPayoutsOut`

Production platform system accounts use fixed IDs; non-production accounts can be generated dynamically.

### Provider/acquirer accounts

- `AcquirerSettlement`
- `AcquirerPayoutsOut`

These model money received through and sent through each acquirer/provider.

## Core ledger model

Legacy ledger structure:

```text
Account
  <- LedgerEntry ->
LedgerTransaction
```

`Account.Balance` is stored as a mutable cache/current balance. `LedgerEntry` stores individual credit/debit evidence. `LedgerTransaction` groups entries and links them to payments/payouts/platform payouts.

The repository updates account balances and inserts ledger transaction/entries in one PostgreSQL transaction.

This is a concept worth preserving, but V2 should tighten the database-level invariants.

## Posting matrix — payment lifecycle

### Payment becomes pending

Legacy operation: `RecordPaymentPendingAsync`

Input financial amount:

```text
pending = max(0, gross_amount - fee)
```

Posting:

```text
MerchantPending   CREDIT pending
```

Ledger operation/status:

```text
operation = PixIn
status    = Pending
```

Legacy idempotency gate:

Any `LedgerTransaction` for the same `PaymentId` with `Status == Pending` suppresses another pending posting.

Observation:

The method receives `merchantSettlementAmount` but does not use it.

### Pending payment cancelled/failed before settlement

Legacy operation: `RecordPaymentCancelledAsync`

Posting:

```text
MerchantPending   DEBIT pending
```

where:

```text
pending = max(0, gross_amount - fee)
```

Ledger operation/status:

```text
operation = PixIn
status    = Refused
```

### Payment completed

Legacy operation: `RecordPaymentReceivedAsync`

Calculated values:

```text
merchant_net       = gross_amount - platform_fee
merchant_settlement = configured settlement amount, otherwise merchant_net
merchant_reserve   = max(0, merchant_net - merchant_settlement)
pending_release    = merchant_settlement + merchant_reserve
provider_net       = gross_amount - provider_fee
platform_profit    = platform_fee - provider_fee
```

Normal merchant posting:

```text
MerchantPending    DEBIT  pending_release
MerchantAvailable  CREDIT merchant_settlement
MerchantReserved   CREDIT merchant_reserve      # only when > 0
AcquirerSettlement CREDIT provider_net          # when acquirer exists
```

If provider fee handling is `AutoSplitToBank` and platform profit is positive:

```text
PlatformPayoutsOut CREDIT platform_profit
AcquirerPayoutsOut CREDIT platform_profit
```

The latter pair records that the provider already split/transferred SwiftPay's fee directly to SwiftPay's bank account and that the money physically left the provider.

Merchant KPI deltas are also updated:

- lifetime volume;
- today/week/month volume;
- lifetime fees paid.

Legacy idempotency gate:

```text
PaymentId + PixIn + Approved
```

### Important economic observation

When `PaymentFeeSplitHandling != AutoSplitToBank`, `RecordPaymentReceivedAsync` does not credit a dedicated platform revenue/available ledger account with `platform_fee - provider_fee`.

Legacy platform available funds are therefore partly derived elsewhere through calculation logic around acquirer balances/liabilities rather than represented solely by a platform revenue account in this posting.

V2 consequence:

Do not copy this accounting model before the provider fund-flow and `CalculationService` audit is complete. V2 should prefer an explicit chart of accounts where platform economic ownership is explainable directly from postings.

## Posting matrix — refunds

### Full Pix refund

Legacy operation: `RecordPaymentRefundedAsync`

Merchant amount to reverse:

```text
merchant_net      = gross_amount - platform_fee
settlement_amount = historical settlement amount or merchant_net
reserve_amount    = merchant_net - settlement_amount
merchant_debit    = settlement_amount + reserve_amount
```

Legacy requires:

```text
MerchantAvailable + MerchantReserved >= merchant_debit
```

Debit order:

1. consume `MerchantReserved` first;
2. consume `MerchantAvailable` for the remainder.

Provider posting:

```text
AcquirerSettlement DEBIT (gross_amount - provider_fee)
```

If the original provider behavior auto-split platform profit:

```text
PlatformPayoutsOut DEBIT (platform_fee - provider_fee)
```

Merchant KPI behavior:

- lifetime refunds increases;
- lifetime/period volume decreases;
- lifetime fees paid decreases by full platform fee.

Legacy idempotency gate:

```text
PaymentId + PixRefund
```

### Partial Pix refund

Legacy operation: `RecordPaymentPartiallyRefundedAsync`

Merchant ownership is reversed proportionally to refunded/gross amount.

Legacy again consumes reserved balance before available balance.

Provider settlement and auto-split platform profit are also reversed proportionally.

Merchant KPI behavior:

- refund total increases by partial refund;
- lifetime/period volume decreases by partial refund;
- platform fee KPI is **not** reversed for partial refund.

Legacy idempotency gate observed:

```text
PaymentId + PixPartialRefund + LedgerTransaction.Amount == refundedAmount
```

Risk to investigate:

If two distinct partial-refund events legitimately have the same amount, amount-based deduplication may conflate them. This cannot be labelled a confirmed defect until the caller/webhook contract is audited to determine whether `refundedAmount` is incremental or cumulative and whether another identifier exists upstream.

V2 requirement:

A refund must have its own stable refund/event identity. Amount must never be the idempotency key.

## Posting matrix — merchant payout

### Payout request / funds reservation

Legacy operation: `RecordWithdrawalRequestedAsync`

Posting:

```text
MerchantAvailable DEBIT  gross_payout_amount
MerchantBlocked   CREDIT gross_payout_amount
```

The platform payout fee is accounted in a KPI (`LifetimeFeesPaid`) at request time.

This `available -> blocked` concept is sound: external Pix-out must not begin while the same funds remain spendable.

### Payout completed

Legacy operation: `RecordWithdrawalCompletedAsync`

Values:

```text
merchant_net       = gross_payout_amount - platform_fee
provider_total_out = merchant_net + provider_fee
```

Posting:

```text
MerchantBlocked    DEBIT  gross_payout_amount
MerchantPayoutsOut CREDIT merchant_net
AcquirerPayoutsOut CREDIT provider_total_out
```

KPI:

```text
LifetimePayouts += merchant_net
```

Legacy has two layers of completion idempotency:

1. application check for existing `PayoutId + SettlementOut`;
2. PostgreSQL unique constraint `IX_LedgerTransactions_PayoutId_SettlementOut_Unique`.

The service explicitly catches the unique-constraint race and returns `already-recorded`.

This is a good pattern to preserve conceptually: financial idempotency must ultimately be protected by the database.

### Payout failed/rejected/cancelled

Legacy operation: `RecordWithdrawalFailedAsync`

Posting:

```text
MerchantBlocked   DEBIT  gross_payout_amount
MerchantAvailable CREDIT gross_payout_amount
```

Fee KPI is reversed.

The service contains cycle-aware failure idempotency because a payout may be rearmed/reprocessed in internal tooling.

Before reversing, it checks that blocked balance is at least the amount being released.

## Payout webhook state lock

The webhook processing path uses a conditional database state transition:

```text
Processing -> Confirming
```

implemented with `ExecuteUpdateAsync(... WHERE Status == Processing)`.

This acts as a compare-and-set logical lock so duplicate webhook handlers do not both acquire the payout.

Terminal failures/cancellations/rejections also check whether a `SettlementOut` already exists. If settlement is already posted, the webhook is treated as stale and the payout remains completed.

This state-transition pattern is valuable and should survive in V2, preferably inside a controlled PostgreSQL function together with any financial posting.

## Confirmed payout reservation concurrency risk

### Legacy flow

`CreateCashoutEndpoint` accepts a payout request and calls `CashoutService.CreateAsync`.

`CreatePayoutAsync` performs:

1. merchant/settings validation;
2. available-balance validation;
3. provider/fee calculation;
4. starts a normal database transaction;
5. inserts the `Payout`;
6. calls `RecordPayoutInLedgerAsync`;
7. ledger calls `RecordWithdrawalRequestedAsync`;
8. ledger performs **another** `CheckSufficientBalanceAsync` read;
9. repository later performs unconditional balance deltas:

```sql
UPDATE "Accounts"
SET "Balance" = "Balance" + :delta
WHERE "Id" = :account_id
```

There is no observed `FOR UPDATE`, serializable transaction, advisory lock, or conditional update equivalent to:

```sql
... WHERE "Balance" >= :amount
```

### Why the transaction is insufficient

Two independent transactions can both read the same available balance before either commits. Atomic `Balance = Balance + delta` prevents lost updates but does not prevent both withdrawals from decrementing the account.

Example:

```text
available = 100

request A reads 100 -> sufficient for 80
request B reads 100 -> sufficient for 80
A debits 80
B debits 80
result = -60
```

The current account update does not fail solely because the resulting balance is negative.

### Idempotency observation

The public payout request accepts `ExternalId`, but in the reviewed `Payout` mapping:

- no unique index on `(merchant, environment, external_id)` was observed;
- `CreatePayoutAsync` does not gate creation on an existing external ID;
- the public create endpoint does not implement its own idempotency gate.

Thus the external reference currently does not provide database-enforced payout creation idempotency in the reviewed path.

### V2 contract

Payout creation/reservation must be one database-controlled operation.

Conceptual requirement:

```sql
reserve_payout(
  merchant_id,
  environment,
  idempotency_key,
  amount,
  ...
)
```

must atomically:

1. acquire/validate the idempotency key;
2. verify available balance;
3. debit available only when sufficient;
4. credit blocked/reserved funds;
5. create the payout state;
6. create ledger transaction/entries;
7. commit or fail as one unit.

The balance decrement must be conditional or row-locked so two concurrent reservations cannot overspend the same balance.

Required V2 fail-first test:

```text
Given merchant available balance = 10000 cents
When two concurrent payout reservations of 8000 cents are attempted
Then exactly one succeeds
And available never becomes negative
And blocked equals exactly 8000
And exactly one financial source posting exists
```

## Platform payout behavior

Legacy also models platform withdrawals.

### Request

```text
PlatformBlocked CREDIT amount
```

### Complete

```text
PlatformBlocked    DEBIT amount
PlatformPayoutsOut CREDIT (amount - provider_fee)
AcquirerPayoutsOut CREDIT amount
```

### Failed

```text
PlatformBlocked DEBIT amount
```

Platform payout idempotency is protected by unique keys on platform payout/item + operation.

V2 decision remains unresolved because the target fund-flow may allow a simpler model.

## Manual adjustment behavior

Legacy supports:

- `AcquirerAdjustment` — credit/debit `AcquirerSettlement`;
- `AcquirerSwiftPayProfitAdjustment` — also credit/debit `AcquirerSettlement` with distinct operation metadata;
- `MerchantAdjustment` — credit/debit merchant available balance.

All require positive adjustment amount and a reason.

Observation:

Merchant debit adjustment does not enforce non-negative available balance in the ledger method itself.

This may be intentional privileged behavior, but V2 must choose explicitly whether admin corrections can create merchant debt. Default V2 financial invariant forbids negative merchant available balance unless an ADR approves debt semantics.

## Referral commission ledger behavior

`RecordReferralCommissionPayoutAsync` currently validates positive amount but then returns success without posting any ledger entries.

This is effectively a no-op/stub at the ledger layer and is another reason not to assume every legacy domain deserves parity.

Referral is out of initial V2 scope.

## Balance semantics in legacy

### Available is not simply `MerchantAvailable`

Legacy merchant available balance is calculated as:

```text
sum(MerchantAvailable accounts)
- currently compensation-locked settlement amounts
```

Compensation-locked amount is recalculated from completed/partially-refunded payments, provider configuration and completion timestamps.

### Pending is also derived

Displayed pending balance is:

```text
sum(MerchantPending accounts)
+ compensation-locked settlement amounts
```

Therefore funds may physically remain posted in `MerchantAvailable` while the read model dynamically treats them as pending because the provider's compensation window has not elapsed.

### Withdraw-now is provider-bucket dependent

Merchant balances are split by `MerchantAcquirerId`. The service chooses a positive provider bucket for immediate withdrawal, adjusted for compensation locks.

This can cause:

```text
total available > amount withdrawable in one provider bucket
```

and motivates the legacy consolidated-withdrawal path.

## V2 recommendation for settlement delay

Avoid virtual balance reclassification computed from historical payment scans if possible.

If V2 requires provider settlement delay/compensation, model the financial state explicitly.

Preferred conceptual direction:

```text
payment paid
  -> MerchantPendingSettlement / MerchantPending
  -> after settlement release event
  -> MerchantAvailable
```

or an equivalent explicit account/state model.

Benefits:

- available balance is directly explainable from ledger;
- no historical payment scan is needed for every balance read;
- payout reservation only checks one authoritative available account/read model;
- release is an idempotent financial event;
- reconciliation can explain exactly why funds are unavailable.

Whether separate provider buckets remain necessary depends on the final fund-flow/provider payout routing decision.

## Account balance cache implementation

`LedgerRepository.CreateTransactionWithAtomicBalanceUpdateAsync`:

- starts a PostgreSQL transaction when one is not already active;
- applies raw SQL delta updates to each `Account.Balance`;
- inserts `LedgerTransaction` and `LedgerEntry` rows;
- applies merchant KPI deltas;
- commits everything together.

This avoids ordinary ORM lost-update behavior.

However, the SQL delta does not enforce account-specific invariants such as non-negative available balance.

V2 direction:

- keep append-only ledger evidence;
- a cached account balance is acceptable for performance;
- update it only in the same database transaction as entries;
- enforce account invariants inside controlled SQL functions/constraints;
- never expose arbitrary balance mutation to application code.

## Legacy migration compatibility logic to remove

The repository's account get-or-create path contains logic that discovers legacy merchant accounts without `MerchantAcquirerId`, moves their balances into provider-bucket accounts or relinks them in place.

This was useful for legacy evolution but must not become V2 domain behavior.

V2 migrations should be explicit migration tooling, not side effects of normal account lookup.

## KPI separation

`MerchantBalance` stores metrics such as:

- lifetime volume;
- lifetime fees;
- lifetime payouts;
- lifetime refunds;
- today/week/month volume.

These metrics are updated in the same repository transaction but are not the canonical available/pending/blocked/reserved monetary balances.

V2 should separate:

```text
financial truth -> ledger/accounts
analytics/KPIs  -> SQL views/materialized/read models
```

KPIs must not complicate the financial posting path unless there is a demonstrated performance requirement.

## V2 decisions supported by this audit

### Keep concept

- ledger transaction + entries;
- merchant available/blocking semantics;
- database-protected financial idempotency;
- conditional state locks for terminal webhooks;
- separate provider physical-flow accounting when required by reconciliation.

### Simplify/redesign

- provider-specific merchant balance buckets;
- dynamic compensation-lock calculation;
- platform available calculation;
- KPI cache updates inside every financial path;
- manual adjustment semantics;
- platform payout model.

### Remove from normal runtime

- legacy account auto-relink/migration side effects;
- referral ledger stub;
- any amount-based event idempotency.

## Remaining financial audit

Before chart-of-accounts approval, still audit:

1. `CalculationService` and platform available/liability equations;
2. fee calculators and rounding rules;
3. reserve/compensation configuration and release behavior;
4. `BankReconciliationService`;
5. payment completion consumers and exact transaction boundaries;
6. cashout processing consumer/provider unknown-result behavior;
7. platform payout service;
8. refund endpoint/provider execution path;
9. any direct writes to `Account.Balance` outside `LedgerRepository`;
10. database constraints/migrations relevant to financial idempotency.

The V2 chart of accounts remains intentionally unapproved until those items are reconciled.