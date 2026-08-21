# Legacy SwiftPay — Financial Calculation and Fee Rules

Status: `CalculationService` and `FeeCalculator` audited. Reconciliation and all caller semantics remain in progress.

Legacy source: `SwiftPay-Prod/swiftpay---Prod`

## Scope reviewed

Line-oriented review completed for:

- `swiftpay-api-core/Services/CalculationService.cs` — complete file;
- `swiftpay-api-core/Utils/FeeCalculator.cs` — complete file;
- relevant usages previously identified in ledger and payout flows.

## Fee primitives

Legacy fee mode:

```text
FixedOnly
PercentageOnly
FixedAndPercentage
```

Canonical percentage representation is integer basis points.

### Percentage rounding

Legacy `FeeCalculator.CalculatePercentage` uses:

```text
ceil(amount * basis_points / 10000)
```

Therefore percentage fees always round **up to the next cent** when the fractional result is non-integer.

Example:

```text
amount = 101 cents
fee = 1% = 100 bp
raw = 1.01 cents
legacy charged fee = 2 cents
```

This rounding behavior is financially material and must become an explicit V2 contract rather than an incidental language implementation.

### Referral rounding

Referral commission uses:

```text
floor(amount * basis_points / 10000)
```

Referral is out of initial V2 scope, but this proves the legacy platform intentionally uses different rounding directions for different financial concepts.

### Net values

Payment transaction calculations distinguish:

```text
merchant/platform fee
provider/acquirer fee
merchant net = amount - platform fee
provider net = amount - provider fee
```

This distinction is correct conceptually and must survive.

### Payout fee calculations

For merchant payouts:

```text
platform_fee = fee charged by SwiftPay to merchant
provider_fee = provider Pix-out cost
merchant_net = requested gross amount - platform_fee
```

Provider transfer amount depends on `PayoutFeeHandling`:

```text
FeeDeductedFromTransfer -> send merchant_net + provider_fee
FeeAddedToDebit         -> send merchant_net
```

This is provider-specific fund-flow behavior and belongs in provider/payment-out capability/configuration, not a generic assumption.

## Platform profit calculations

Legacy historical payment profit query:

```text
payment_profit = PlatformFee - AcquirerFee
```

Legacy historical payout profit query:

```text
payout_profit = PlatformFee - AcquirerFee
```

These are useful economic metrics but are not, by themselves, proof that the money is physically withdrawable from a provider account.

## Acquirer/provider balance composition

For each provider, legacy derives:

```text
settlement_balance = AcquirerSettlement account balance
payouts_out        = AcquirerPayoutsOut account balance
gross_balance      = settlement_balance - payouts_out
```

It also aggregates merchant liabilities associated with that provider.

Two different merchant-liability projections are built:

```text
merchant_balance = MerchantAvailable + MerchantBlocked + MerchantReserved
merchant_available = MerchantAvailable only
```

`MerchantPending` is not included in either provider liability composition because pending Pix has not yet become provider settlement in the same sense.

## Two materially different platform formulas

### “Platform profit”

Legacy `GetPlatformProfitByAcquirerAsync` uses:

```text
platform_profit = max(0, gross_balance - merchant_balance)
```

where:

```text
merchant_balance = available + blocked + reserved
```

This treats blocked and reserved merchant funds as merchant liabilities when calculating platform profit.

### “Available for platform withdrawal”

Legacy `GetTotalAvailableForWithdrawalByAcquirerAsync` uses:

```text
available_for_platform_withdrawal = gross_balance - merchant_available_balance
```

where:

```text
merchant_available_balance = available only
```

No `max(0, ...)` is applied inside `CalculateAvailableForWithdrawal`.

### Consequence

The platform-withdrawal formula does **not** subtract merchant blocked or reserved balances, while the profit formula does.

Conceptually:

```text
Gross provider funds
  - MerchantAvailable       -> “available for platform withdrawal”

Gross provider funds
  - MerchantAvailable
  - MerchantBlocked
  - MerchantReserved        -> “platform profit”
```

This discrepancy is financially significant.

It may be intentional only if blocked/reserved funds are legally/economically available for platform withdrawal under the actual provider/fund-flow arrangement. The current source code alone does not establish that business/legal assumption.

Therefore V2 must **not** inherit this formula without a fund-flow decision.

## Potential liability-overstatement/withdrawal risk to resolve

Suppose one provider account has:

```text
gross provider balance = 100000
merchant available      = 60000
merchant blocked        = 20000
merchant reserved       = 10000
```

Legacy formulas produce:

```text
platform profit = 100000 - (60000 + 20000 + 10000) = 10000
platform withdrawal availability = 100000 - 60000 = 40000
```

The latter is four times the economic profit in this example.

This is not labelled a confirmed production bug because:

- provider blocked/reserve fund ownership semantics are not yet fully audited;
- platform payout business rules may add additional controls elsewhere;
- actual provider physical balances and timing may change the interpretation.

It is, however, a mandatory reconciliation question before V2 chart-of-accounts approval.

## Auto-split profit

For payments whose provider fee handling is `AutoSplitToBank`, legacy derives the historical split amount as:

```text
PlatformFee - AcquirerFee
```

and includes it in expected `PlatformPayoutsOut`.

This matches the ledger behavior where completed auto-split payments credit `PlatformPayoutsOut` and `AcquirerPayoutsOut` directly.

V2 implication:

Provider auto-split is not merely a pricing flag. It changes the physical fund-flow and therefore the ledger posting template.

## Partial refund profit

For partially refunded payments, legacy computes remaining platform profit proportionally:

```text
profit = platform_fee - provider_fee
refund_profit_debit = profit * refunded_amount / original_amount
remaining_profit = profit - refund_profit_debit
```

Conversion to integer cents truncates toward zero after decimal multiplication.

This differs from normal fee calculation, which uses ceiling.

V2 must specify refund fee economics and rounding separately. Do not assume symmetric rounding automatically reverses the original fee.

## Merchant reserve calculations

Reserve amount:

```text
reserve = floor/truncate(net_amount * reserve_bp / 10000)
```

because decimal multiplication is cast directly to `long`.

Settlement amount:

```text
merchant_settlement = max(0, net_amount - reserve)
```

However, as documented in the ledger audit, the actual merchant balance read later may also apply provider compensation windows dynamically.

V2 should distinguish clearly between:

- risk reserve owned by merchant but unavailable;
- provider settlement delay;
- payout block;
- platform-owned revenue.

These must not collapse into one generic “pending” concept without explicit accounting rules.

## Refund settlement calculation

Legacy proportional merchant refund calculation:

```text
normalized_refund = min(refunded_amount, original_amount)
refunded_merchant_settlement = merchant_owned_amount * normalized_refund / original_amount
```

The decimal result is cast to integer cents, truncating fractional cents.

V2 needs deterministic property tests ensuring cumulative partial refunds cannot debit more or less than the approved total policy permits due to rounding accumulation.

## Platform expected-balance diagnostics

`GetPlatformExpectedBalancesAsync` derives an operational diagnostic model using historical payments, payouts and platform payout items.

It reports, among other values:

- total available for platform withdrawal;
- expected platform blocked;
- expected platform payouts out;
- payment platform fees;
- provider fees;
- payment profit;
- payout platform/provider fees;
- partial refund remaining profit;
- auto-split profit;
- processing/completed platform payout totals and counts.

Expected values are derived from business records rather than solely from ledger entries.

This indicates the legacy reconciliation model cross-checks multiple sources, which is useful conceptually. V2 should preserve independent reconciliation evidence while making the ledger/fund-flow model simpler.

## Platform payout distribution

Legacy can distribute a platform payout across providers.

Smart distribution:

1. sort providers by computed available balance descending;
2. take as much as possible from each;
3. compute provider payout fee;
4. validate provider min/max payout limits;
5. continue until requested total is allocated.

Manual distribution accepts provider-specific requested amounts but still clamps each to computed availability and validates limits.

This complexity should only survive V2 if SwiftPay genuinely needs to sweep platform-owned funds from multiple provider accounts.

## V2 fee contract direction

For Pix-only V2, a minimal fee snapshot should contain:

```text
amount_cents
merchant_fee_mode
merchant_fee_fixed_cents
merchant_fee_basis_points
merchant_fee_cents
provider_fee_mode / provider cost rule when known
provider_fee_cents
merchant_net_cents
platform_economic_margin_cents
pricing_version/config id
rounding_policy
```

The source payment must retain the snapshot so later pricing changes do not alter history.

## V2 rounding requirements

Before implementation, choose and test explicitly:

1. merchant percentage fee rounding;
2. provider cost rounding when computed internally;
3. reserve rounding;
4. partial refund allocation rounding;
5. payout fee rounding;
6. any remainder allocation after multiple partial refunds.

Do not rely on JavaScript/SQL default numeric casts to reproduce C# behavior accidentally.

## V2 platform funds requirement

The V2 ledger should make the following question answerable without reconstructing business history:

> Of the cash physically held at each provider, how much belongs to merchants, how much is blocked/reserved, and how much is SwiftPay-owned withdrawable revenue?

A preferred target is explicit ledger accounts/postings for liabilities and platform revenue rather than deriving platform ownership from:

```text
provider gross - selected merchant balance categories
```

Final account names depend on the legal/provider fund-flow audit.

## Remaining calculation audit dependencies

Still required before approving the financial model:

- `BankReconciliationService` complete review;
- platform payout service and approval/execution flow;
- provider balance APIs/reconciliation inputs;
- reserve compensation/release behavior outside balance reads;
- all direct `CalculationService` consumers;
- migration history for fee/account semantics;
- test suite for fee rounding and platform balance equations;
- retained provider fee/split behavior.

Until those are complete, the V2 chart of accounts and platform withdrawal equation remain unresolved.