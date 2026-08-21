# Legacy Platform Payout / Provider Sweep Audit

Status: core end-to-end audit complete; V2 feature deferred pending fund-flow contract

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Scope

This audit covers the legacy administrator/platform withdrawal of SwiftPay funds from provider/acquirer balances into a configured platform Pix destination.

Reviewed paths include:

- `PlatformPayout` / `PlatformPayoutItem`;
- manual and automatic platform payout creation;
- platform payout destination management;
- smart/manual provider distribution;
- platform ledger request/completion/failure postings;
- `ProcessPlatformPayoutConsumer` fan-out;
- `ProcessPlatformPayoutItemConsumer` provider execution;
- `WithdrawService.ProcessPlatformWithdrawAsync`;
- `PlatformPayoutWebhookService`;
- platform-withdrawable calculation;
- simulated platform payout behavior;
- relevant ledger idempotency indexes.

This audit does not prove the legal/accounting ownership of provider-held funds. That fund-flow is a required V2 business/accounting decision.

## Legacy model

One `PlatformPayout` can contain multiple provider-specific `PlatformPayoutItem` rows.

Parent states:

```text
Processing
Completed
PartiallyCompleted
Failed
Cancelled
```

Item states:

```text
Processing
Completed
Failed
Cancelled
```

Each item stores provider, gross amount, provider fee, net amount and provider transaction/Pix identifiers.

There is no explicit item state for `executing`, `execution_unknown`, `accounting_recovery_required` or equivalent.

## Destination account security

Creating a platform payout destination is restricted to the legacy `God` role. Creating a new destination automatically deactivates every currently active destination and makes the submitted Pix key active.

The audited create endpoint validates non-empty Pix key, holder name/document and enum key type, but no step-up challenge, dual approval/quorum or PSP/account-ownership verification was observed in that path.

This is a treasury-critical mutation, not ordinary CRUD.

If platform payout is later implemented in V2, destination create/change/activation must use strong privileged authorization, recent step-up authentication and append-only audit. A quorum/approval policy should be available where the risk model requires it.

## Creation and distribution

The manual admin endpoint starts a Serializable PostgreSQL transaction, loads active withdrawal-capable providers and computes manual or smart distribution across them.

Observed ordering:

```text
BEGIN SERIALIZABLE
  calculate provider/platform availability
  create PlatformPayout
  create PlatformPayoutItems
COMMIT

RecordPlatformWithdrawalRequestedAsync(...)
publish ProcessPlatformPayout
```

The payout rows, financial reservation and async execution task are therefore three separate effects.

If ledger reservation fails, the already-committed payout/items are deleted. If message publication later fails, code attempts a compensating ledger failure posting and then deletes the payout/items when compensation succeeds.

This is not equivalent to one atomic financial transaction and can leave recovery complexity/evidence spanning separate commits.

V2 requirement if platform payout is ever implemented:

```text
platform payout request
+ platform-owned-funds reservation
+ provider legs
+ durable execution jobs/outbox
```

must commit in one PostgreSQL transaction.

## Critical platform availability / double-reservation defect

`RecordPlatformWithdrawalRequestedAsync` only posts:

```text
PlatformBlocked CREDIT amount
```

It does not debit or otherwise reduce a canonical platform-available account.

Meanwhile provider-level platform availability is calculated as:

```text
gross_balance = AcquirerSettlement - AcquirerPayoutsOut
available_for_withdrawal = gross_balance - MerchantAvailable
```

The calculation does not subtract:

- `MerchantBlocked`;
- `MerchantReserved`;
- `PlatformBlocked`;
- processing `PlatformPayoutItem` amounts.

`GetPlatformBalanceInfoAsync` then reports:

```text
Available = calculated availability
Blocked   = PlatformBlocked
Total     = Available + Blocked
```

Because `Available` does not decrease when `PlatformBlocked` increases, a newly requested platform payout leaves the same money selectable for another payout until an item actually completes and increases `AcquirerPayoutsOut`.

This enables double reservation under concurrent or repeated platform-withdrawal requests.

The endpoint's `Serializable` transaction does not solve this because:

1. the PlatformBlocked ledger posting occurs after the transaction has committed; and
2. the availability formula does not consume PlatformBlocked anyway.

## Critical merchant-liability availability defect

The same platform-withdrawable formula subtracts only `MerchantAvailable`.

The legacy platform-profit model, however, considers a broader merchant liability composition including:

```text
MerchantAvailable + MerchantBlocked + MerchantReserved
```

Therefore platform-withdrawable funds can include amounts the broader financial model itself treats as merchant blocked/reserved liabilities.

V2 must never define SwiftPay-owned/treasury-withdrawable money as an unexplained residual. Platform-owned revenue/liquidity requires explicit accounts and external provider settlement reconciliation.

## Admin request idempotency

The manual create request has no first-class idempotency key or stable caller request ID.

Two equivalent administrative submissions therefore create two independent payouts with different IDs.

V2 treasury payout creation requires request-level idempotency plus database uniqueness; per-ledger-row dedupe cannot protect against duplicate business requests.

## Non-durable fan-out

`ProcessPlatformPayoutConsumer` loads all `Processing` child items and publishes one `ProcessPlatformPayoutItem` message per item.

There is no transactional outbox around this fan-out. A broker failure part-way through the loop can enqueue only a subset of provider legs. A later retry can republish still-Processing items.

V2 should create one durable execution job per provider leg inside the same reservation transaction and claim jobs atomically from PostgreSQL/outbox.

## Critical execution concurrency flaw

The item consumer does not claim a unique execution state before invoking the PSP.

Observed order:

```text
load item where Status = Processing
verify Status == Processing
call ProcessPlatformWithdrawAsync(...)
    -> provider WithdrawAsync(...)
only after provider response:
    CAS Processing -> Completed/Failed/Cancelled
```

Two concurrent deliveries can both read `Processing`, both issue the provider Pix-out and only then race on the local CAS.

The CAS protects the local terminal transition too late to protect the external monetary side effect.

If the provider does not guarantee idempotency for the stable item ID, the same transfer can execute twice.

V2 requires a database execution claim/lease before the network call:

```text
reserved
  -> executing
       -> provider_processing
       -> provider_confirmed
       -> execution_unknown
       -> definitively_failed
```

Only the holder of the current execution claim may issue the provider monetary POST. Provider idempotency remains required where supported because local leasing alone cannot resolve an ambiguous network result.

## Critical unknown-result flaw

`WithdrawService.ProcessPlatformWithdrawAsync` catches general exceptions and maps them to definitive `WithdrawStatus.Failed`.

This includes transport outcomes that do not prove rejection, such as timeout/connection loss after the PSP accepted the Pix-out.

The item consumer then treats the result as final failure and reverses/debits `PlatformBlocked`.

The generic provider HTTP resilience layer also introduces monetary POST retry risk for providers using that shared client configuration.

V2 invariant:

```text
transport ambiguity != definitive provider failure
```

Ambiguous execution enters `execution_unknown/recovery_required`, keeps funds reserved and resolves through provider query, webhook and external reconciliation. The POST is never blindly retried unless the provider's idempotency contract is proven and tested.

## Critical provider-completed -> Processing rollback

When the provider returns `Completed`, the item consumer first performs:

```text
Processing -> Completed
```

and only then posts completion to the ledger.

If the ledger posting fails, code changes the item back to:

```text
Completed -> Processing
```

although the external Pix-out may already be irreversible.

That makes an already executed transfer eligible for another worker/manual provider call.

The provider webhook completion path contains the same rollback pattern.

V2 must preserve externally proven truth. If the provider confirms completion but internal accounting fails, use a state such as:

```text
provider_confirmed + accounting_recovery_required
```

and recover the missing idempotent ledger posting. Never make the provider monetary POST executable again.

Failed/cancelled paths have a related problem: local accounting reversal failure can also roll the item back to `Processing`, conflating provider truth with accounting-repair state.

## Webhook internal-error misclassification

`PlatformPayoutWebhookService.TryProcessWebhookAsync` wraps terminal handling in a broad catch.

If internal webhook processing throws, the catch invokes the financial failure handler, which can mark the item failed and reverse blocked accounting.

An internal application/database exception is not evidence that the PSP rejected the transfer.

V2 webhook processing must preserve the last externally proven provider state and schedule local recovery/alerting separately.

## Provider deactivation can orphan in-flight webhook resolution

The platform payout webhook lookup requires the related provider/acquirer to still be `IsActive`.

If a provider is disabled after an outbound transfer was submitted but before its terminal webhook arrives, that webhook can fail to find the in-flight item.

Provider enabled/disabled state controls *new* routing. It must not control resolution of historical/in-flight financial operations.

V2 uses immutable provider identity/reference snapshots on the operation and continues accepting authenticated terminal events for already-created operations even after the provider is disabled for new traffic.

## Parent aggregation semantics

Once no item remains `Processing`, the parent becomes:

- all completed -> `Completed`;
- all failed -> `Failed`;
- all cancelled -> `Cancelled`;
- mixed -> `PartiallyCompleted`.

This aggregate idea is reasonable, but the item model is too coarse to represent a mixed set containing an unresolved external result or an accounting-recovery item.

If multi-provider sweeps are later retained, parent state must be derived from richer child truth without forcing unknown operations into failed/completed semantics.

## Ledger posting summary

Request:

```text
PlatformBlocked CREDIT amount
```

Completed provider leg:

```text
PlatformBlocked    DEBIT amount
PlatformPayoutsOut CREDIT (amount - provider_fee)
AcquirerPayoutsOut CREDIT amount
```

Failure/cancellation:

```text
PlatformBlocked DEBIT amount
```

A legacy migration adds filtered unique indexes for `PlatformPayOut` completion postings by `PlatformPayoutItemId` (and a parent/no-item form) after a historical cutoff date. This is stronger than application-only completion dedupe.

It does not solve:

- duplicate creation requests;
- external provider execution identity;
- request/failure source-event uniqueness as a universal contract;
- the double-reservation availability defect.

V2 applies stable source-key/idempotency constraints to every monetary transition.

## Automatic platform cashout

Automatic platform cashout uses essentially the same distribution, availability, payout-row, ledger-block and RabbitMQ execution pattern.

It inherits:

- double-reservation/platform availability defect;
- merchant-liability inclusion risk;
- split domain/ledger/job commits;
- unknown provider-result handling;
- external execution concurrency;
- monetary POST retry risk;
- provider-confirmed/accounting rollback problem.

Automatic treasury withdrawal must not be copied until the manual treasury contract is proven safe and separately approved.

## Critical Production simulation defect

The administrative endpoint:

```text
POST platform-payouts/simulated
```

is not constrained to Sandbox in the audited endpoint.

It uses the current environment, creates the parent and provider items immediately as `Completed`, and then posts requested/completed platform withdrawal ledger movements without performing an external provider Pix-out.

In Production this can create accounting records that claim platform/provider funds were withdrawn even though no external transfer occurred. Because completion increases `AcquirerPayoutsOut`, it also changes the modeled provider balance.

The endpoint checks authenticated admin identity but does not contain the `God`-role restriction observed on platform payout destination creation.

V2 invariant:

> simulated financial transitions are structurally impossible in Production.

Sandbox separation must be enforced in trusted backend/database contracts and covered by fail-first tests; a frontend label or hidden button is not a control.

## V2 disposition

**DEFER from the initial Pix-first release.**

Merchant Wallet/Pix-out is a seller product requirement. An administrative mechanism for SwiftPay to sweep its own funds from providers is not required to prove the first vertical slice.

Do not implement platform payout until all of the following are approved:

1. explicit legal/economic ownership of provider-held funds;
2. explicit platform-owned ledger accounts and chart of accounts;
3. platform-withdrawable calculation that cannot include merchant liabilities or already-reserved treasury funds;
4. retained-provider Pix-out/idempotency/recovery behavior;
5. execution claim/lease contract;
6. `execution_unknown` contract;
7. external provider settlement reconciliation;
8. request-level idempotency;
9. destination security/step-up/audit policy;
10. strict Sandbox/Production simulation boundary.

## If implemented later: target execution model

```text
request + idempotency key
        |
        | atomic PostgreSQL transaction
        v
reserve explicit platform-owned funds
create provider legs
create execution jobs
        |
        v
worker claims one leg
        |
        v
executing
  |        |            |
  |        |            -> explicit reject -> failed/accounted
  |        -> timeout/lost response -> execution_unknown
  |                                -> query/webhook/reconciliation
  -> provider_processing
  -> provider_confirmed
          |
          -> accounting complete
          -> accounting_recovery_required
```

A provider-confirmed operation can never transition back to a provider-executable state.

## Required fail-first tests if feature is activated

1. Two concurrent treasury requests cannot reserve the same cent twice.
2. `PlatformBlocked`/equivalent reservation reduces withdrawable funds atomically.
3. Merchant available/blocked/reserved liabilities can never be swept as platform-owned funds.
4. Duplicate concurrent worker delivery issues at most one local execution claim.
5. Provider timeout after acceptance keeps funds reserved and enters `execution_unknown`.
6. Provider-confirmed + ledger transient failure does not execute Pix-out again.
7. Duplicate terminal webhooks create exactly one accounting result.
8. Disabling a provider for new traffic does not prevent terminal resolution of an in-flight operation.
9. Two create requests with the same idempotency key return the same treasury payout.
10. Worker/broker outage after request cannot lose execution work because reservation and job/outbox are atomic.
11. Production rejects every simulated treasury financial transition at the trusted boundary.
12. Destination replacement requires the configured privileged step-up/approval policy and is fully audited.

## Reconstruction implication

The legacy platform-payout subsystem should not be ported into initial V2.

Deferring it removes a high-risk multi-provider treasury fan-out from launch while the seller-facing payment/wallet product is built. If the business later requires provider sweeps, it can be implemented on top of the same safe primitives already required by merchant payouts: explicit ownership, PostgreSQL reservation, durable outbox/jobs, provider capability contracts, execution leasing, `execution_unknown`, idempotent accounting and external reconciliation.