# SwiftPay V2 — Fees and Rounding Contract

Status: Phase 1 foundational contract; commercial fee-refund policy remains versioned configuration

## Objective

Make every cent deterministic. Pricing changes must never rewrite historical Payment/Payout/Refund economics.

## Monetary representation

All monetary values are signed/unsigned integer centavos according to field semantics. Floating-point money is forbidden in application, database functions and public API.

Percentage rates use integer basis points (`100 bp = 1%`).

## Pricing snapshot

Every created Payment stores an immutable pricing snapshot with at least:

```text
pricing_version
amount_cents
fee_mode
fee_fixed_cents
fee_basis_points
fee_percentage_component_cents
merchant_fee_cents
merchant_net_cents
provider_cost_cents?          # internal only when known
platform_margin_cents?        # internal derived snapshot when valid
rounding_policy_version
```

Payouts/refunds similarly retain the approved fee/economic snapshot needed to explain their posting later.

Changing merchant pricing affects future operations only.

## Merchant payment fee

Supported initial modes:

```text
fixed
percentage
fixed_plus_percentage
```

Percentage component:

```text
ceil(amount_cents * basis_points / 10000)
```

This intentionally preserves the legacy merchant-percentage rounding direction and makes it explicit.

Combined fee:

```text
fixed                  -> fixed_cents
percentage             -> percentage_component
fixed_plus_percentage  -> fixed_cents + percentage_component
```

A pricing configuration that would make `merchant_fee_cents > amount_cents` is rejected for that operation. SwiftPay does not silently clamp a malformed pricing rule into a zero/negative merchant net.

```text
merchant_net_cents = amount_cents - merchant_fee_cents
```

## Provider cost

Provider cost is not the merchant fee. It is platform economics/funding evidence.

When the provider returns an authoritative cost, store the normalized integer-cent snapshot. When SwiftPay computes provider cost from a contractual rate, the provider-specific contract must declare its rate base and rounding rule.

Do not expose provider cost to merchants through the public Payment API.

## Platform margin

Where fund-flow allows the concept:

```text
platform_margin_cents = merchant_fee_cents - provider_cost_cents
```

This is an economic value, not proof that the amount is physically withdrawable from a provider. Treasury availability comes from explicit ledger/funding ownership, not this arithmetic alone.

## Payout fees

Merchant payout fee and provider Pix-out cost remain separate snapshots.

The payout contract must state whether provider cost is absorbed by SwiftPay or changes the external transfer amount. This is provider/fund-flow configuration, not an implicit global rule.

Payout fee calculation uses the same integer/basis-point primitives. Any percentage fee uses the declared rounding policy version rather than language casts.

## Refund fee policy

Whether SwiftPay returns merchant fees on full/partial refund is a versioned business policy, not inferred from Payment status.

Initial supported policy vocabulary:

```text
merchant_fee_non_refundable
merchant_fee_refundable_pro_rata
merchant_fee_refundable_full_on_full_refund
```

The active policy is snapshotted on the source Payment/pricing version before refund execution is enabled.

Provider-refund costs are separate and follow the retained provider contract.

## Proportional allocation without rounding drift

Repeated partial refunds must not accumulate independent rounding errors.

For any component `C` that is allocated pro rata against original amount `A`, calculate the cumulative target from cumulative refunded principal `R`:

```text
target(R) = floor(C * R / A)
delta     = target(R_after) - target(R_before)
```

For the final refund where `R_after == A`, force:

```text
target(A) = C
```

so the final operation consumes the exact residual cent(s).

This cumulative-target method applies to every component whose approved policy is proportional, such as refundable merchant net/fee/provider component. It avoids calculating each partial refund independently.

Two equal-value partial refunds remain distinct resources; allocation identity comes from Refund/source identity, never amount.

## Reserve

Merchant reserve is disabled by default in first release. If later enabled, its rate, rounding and release schedule require a separate approved policy/version and explicit ledger postings. Legacy truncation is not inherited accidentally.

## Invariants

For a Payment:

```text
amount = merchant_fee + merchant_net
```

when no other merchant-owned split is part of the approved pricing model.

For every posting, ledger debits equal credits.

For cumulative full refund under a refundable component policy, sum of refund allocation deltas equals the exact original refundable component.

No historical fee/net/cost snapshot changes when pricing configuration changes.

## Required fail-first tests

1. 101 cents at 100 bp produces a 2-cent percentage component;
2. exact integer percentage results are not over-rounded;
3. fixed-plus-percentage adds the exact two components;
4. pricing that produces fee greater than amount is rejected;
5. merchant net always equals amount minus snapshotted merchant fee;
6. pricing update does not mutate an existing Payment snapshot;
7. provider cost cannot overwrite merchant fee semantics;
8. public Payment serialization does not expose provider cost/margin;
9. many partial refunds allocate a proportional component without cumulative cent drift;
10. final full refund consumes the exact residual component cents;
11. two same-amount refunds receive independent allocation/source identities;
12. fee-refund policy change affects only new snapshotted Payments;
13. reserve remains zero/absent when the capability is disabled;
14. equivalent SQL and application fee calculations produce identical cent values.
