# SwiftPay V2 — Ledger and Balance Contract

Status: Phase 1 foundational contract; ready for fail-first database tests

Date: 2026-08-13

## Objective

Define one small canonical accounting model for Pix payments, merchant balances, refunds and payouts without preserving the legacy account ambiguities.

## Rules

- Ledger entries are authoritative and append-only.
- Every posting is double-entry: total debits equal total credits.
- BRL values are integer centavos; every entry amount is positive.
- Cached account balances are updated atomically with ledger entries and must be rebuildable from them.
- Merchant ownership is separate from provider funding location.
- Merchant fees are explicit revenue; provider fees are explicit costs.
- Provider calls happen outside database posting transactions.
- External unknown results never silently release blocked merchant funds.
- Reserve/compensation is disabled by default until an approved contract enables it.

## Account model

Each account has an explicit category and natural side:

```text
asset      -> debit-normal
liability  -> credit-normal
revenue    -> credit-normal
expense    -> debit-normal
```

Canonical first-release account types:

```text
ASSET
provider_settlement_asset

MERCHANT LIABILITIES
merchant_pending_liability
merchant_available_liability
merchant_risk_reserved_liability      # optional, disabled by default
merchant_payout_blocked_liability
merchant_refund_blocked_liability

REVENUE
payment_fee_revenue
payout_fee_revenue

EXPENSE
provider_payment_fee_expense
provider_payout_fee_expense
```

Do not recreate `MerchantPayoutsOut`, `AcquirerPayoutsOut`, `PlatformPayoutsOut` or KPI accounts merely for historical totals. Historical metrics are projections from immutable domain/ledger data.

## Identity

Canonical merchant liability accounts are scoped by:

```text
UNIQUE (merchant_id, environment, currency, account_type)
```

They are not provider-specific by default.

Provider settlement assets are scoped by:

```text
UNIQUE (provider_account_id, environment, currency, account_type)
```

Financial accounts are created with database-native upsert semantics. No `SELECT -> if missing -> INSERT` creation race is accepted.

## Payment paid posting

Let:

```text
gross = payment amount
merchant_fee = SwiftPay payment fee
merchant_net = gross - merchant_fee
provider_fee = provider payment cost
provider_net = gross - provider_fee
```

If paid funds are still awaiting settlement release:

```text
DEBIT   provider_settlement_asset       provider_net
DEBIT   provider_payment_fee_expense    provider_fee
CREDIT  merchant_pending_liability      merchant_net
CREDIT  payment_fee_revenue             merchant_fee
```

If the immutable settlement policy says funds are immediately available, credit `merchant_available_liability` instead of pending.

The posting is unique by stable payment/source identity. Duplicate provider-paid evidence creates no second posting.

## Settlement release

```text
DEBIT   merchant_pending_liability
CREDIT  merchant_available_liability
```

for the released amount.

If risk reserve is explicitly enabled, a release may split between available and `merchant_risk_reserved_liability`. With the default first-release policy, reserve credit is always zero.

## Payout reservation

After request idempotency and an atomic sufficient-balance check:

```text
DEBIT   merchant_available_liability
CREDIT  merchant_payout_blocked_liability
```

for the reserved merchant amount.

Payout row, idempotency claim, posting and required outbox/job row commit atomically. Concurrent payout requests cannot both spend the same available funds.

## Payout success

Let:

```text
reserved_amount
merchant_payout_fee
provider_payout_fee
recipient_amount = reserved_amount - merchant_payout_fee
asset_outflow = recipient_amount + provider_payout_fee
```

On authoritative success:

```text
DEBIT   merchant_payout_blocked_liability  reserved_amount
DEBIT   provider_payout_fee_expense         provider_payout_fee
CREDIT  provider_settlement_asset           asset_outflow
CREDIT  payout_fee_revenue                  merchant_payout_fee
```

A provider with materially different fund flow must define a balanced mapping before Pix-out is enabled.

## Payout failure and unknown result

Definitive failure releases exactly once:

```text
DEBIT   merchant_payout_blocked_liability
CREDIT  merchant_available_liability
```

An ambiguous external result (`timeout`, connection reset, lost response, ambiguous 5xx, crash after possible transmission) creates no release posting. Funds remain in `merchant_payout_blocked_liability` until recovery proves success or failure.

## Refund funding

Merchant-initiated refunds that require pre-funding reserve their required amount by moving:

```text
merchant_available_liability
  -> merchant_refund_blocked_liability
```

The exact refund amount, platform-fee reversal and provider-fee economics belong to the refund contract. Regardless of policy:

- cumulative refund cannot exceed the eligible amount;
- source identity is `refund_id`, never payment + amount;
- unknown result keeps reserved refund funding blocked;
- confirmed failure releases once;
- confirmed success explicitly records asset reduction and any revenue reversal/cost.

## Merchant balance semantics

Canonical API/UI fields:

```text
pending_settlement = merchant_pending_liability
available          = merchant_available_liability
reserved           = merchant_risk_reserved_liability
blocked_payouts    = merchant_payout_blocked_liability
blocked_refunds    = merchant_refund_blocked_liability
blocked            = blocked_payouts + blocked_refunds
withdrawable       = max amount currently eligible for a new payout
total_merchant_funds = pending_settlement + available + reserved + blocked
```

`withdrawable <= available`.

When no provider/liquidity execution restriction applies, `withdrawable == available`.

The public contract must never map `withdrawable` into the field named `available`, which was a legacy semantic defect.

Provider routing does not change merchant ownership. Provider-specific funding attribution belongs to provider assets/settlement metadata, not to merchant-facing balance buckets.

## Ledger source identity

Every ledger transaction has stable:

```text
source_type
source_id
posting_type
```

Examples:

```text
payment/<payment_id>/settlement_paid
payment/<payment_id>/settlement_release
payout/<payout_id>/reserve
payout/<payout_id>/completed
payout/<payout_id>/release_failure
refund/<refund_id>/reserve
refund/<refund_id>/completed
refund/<refund_id>/release_failure
```

Critical posting scopes are database-unique. Amount is never a dedupe identity.

## Controlled posting boundary

Browser/dashboard code cannot write ledger tables or account balances directly.

A trusted PostgreSQL function/service boundary must atomically:

1. claim source idempotency;
2. resolve/create deterministic accounts;
3. validate positive amounts and currency/environment scope;
4. verify debits equal credits;
5. enforce non-negative merchant liability bucket policy;
6. insert immutable ledger transaction and entries;
7. update account balance caches;
8. apply the associated canonical financial state transition;
9. insert required outbox/job rows;
10. commit or roll back everything.

## Platform economics

Platform revenue is explicit, not the unexplained residual of provider balance minus merchant balances.

Provider costs are explicit expenses. Reporting can derive platform economics from explicit revenue/cost postings rather than interpreting unexplained balance differences as profit.

## Reconciliation

Internal reconciliation verifies:

```text
domain source <-> ledger transaction <-> ledger entries <-> cached balance
```

External reconciliation separately verifies:

```text
provider evidence <-> ProviderAttempt/ProviderEvent <-> domain state <-> provider settlement asset
```

A check that never reads external provider/bank evidence is not called bank reconciliation.

## Required fail-first tests

1. unbalanced posting is rejected atomically;
2. zero/negative entry is rejected;
3. concurrent creation of one account identity produces one row;
4. duplicate/concurrent paid event creates one settlement posting;
5. settlement release preserves total merchant funds;
6. two concurrent payout reservations cannot overspend available balance;
7. payout unknown result leaves funds blocked;
8. payout definitive failure releases exactly once;
9. payout success consumes block exactly once;
10. `available` and `withdrawable` remain distinct semantics;
11. `blocked` is not mislabeled as risk reserve;
12. cached balances equal ledger recomputation after concurrent postings;
13. provider routing changes do not rewrite merchant ownership;
14. with reserve disabled, payment postings cannot create reserved balance.

## Deferred activation decisions

These require separate approved contracts and do not block the core schema:

- whether risk reserve survives at all;
- settlement/compensation delay policy;
- provider fee finalization timing;
- refund fee policy;
- treasury/bank accounts beyond provider settlement assets;
- exceptional providers requiring segregated merchant/provider funding;
- wallet/top-up accounting.