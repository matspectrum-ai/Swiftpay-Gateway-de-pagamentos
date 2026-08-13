# Legacy Platform Payout / Provider Sweep Audit

Status: core execution audit complete; V2 feature deferred pending fund-flow contract

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Scope

This audit covers the legacy administrator-initiated withdrawal of SwiftPay/platform funds from provider/acquirer balances into a configured platform Pix destination.

Reviewed paths include:

- `PlatformPayout` / `PlatformPayoutItem` state models;
- admin `CreatePlatformPayoutEndpoint`;
- `ProcessPlatformPayoutConsumer` fan-out;
- `ProcessPlatformPayoutItemConsumer` provider execution;
- `WithdrawService.ProcessPlatformWithdrawAsync`;
- `PlatformPayoutWebhookService`;
- previously audited ledger posting methods and platform-withdrawable calculations.

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

Each item stores the provider, gross amount, provider fee, net amount and provider transaction/Pix identifiers.

There is no explicit item state for `executing`, `execution_unknown`, `recovery_required` or equivalent.

## Creation and distribution

The admin create endpoint starts a Serializable PostgreSQL transaction, loads active withdrawal-capable providers and computes manual or smart distribution across providers.

The distribution depends on `CalculationService.GetTotalAvailableForWithdrawalByAcquirerAsync`.

The previously audited calculation uses:

```text
provider gross balance - MerchantAvailable
```

for platform-withdrawable availability, while legacy platform profit subtracts:

```text
MerchantAvailable + MerchantBlocked + MerchantReserved
```

Therefore platform-payout eligibility inherits the unresolved difference between economic profit and computed platform-withdrawable funds. V2 must not retain this formula until fund ownership is explicitly approved.

## Critical dual-write at creation

The create endpoint does not reserve platform funds in the same transaction that creates the payout.

Observed ordering:

```text
BEGIN SERIALIZABLE
  create PlatformPayout
  create PlatformPayoutItems
COMMIT

RecordPlatformWithdrawalRequestedAsync(...)
publish ProcessPlatformPayout
```

The platform ledger request posting therefore occurs after the payout rows are already committed.

If ledger reservation fails, the endpoint deletes the payout/items. If message publication later fails, it attempts a compensating ledger failure posting and then deletes the payout/items when compensation succeeds.

This is not equivalent to one atomic financial transaction. It also means ledger evidence can reference a business operation whose domain rows are subsequently deleted after compensation.

V2 requirement if platform payout is ever implemented:

```text
platform payout request
+ platform-fund reservation
+ payout items
+ durable execution jobs/outbox
```

must be created in one PostgreSQL transaction.

## Non-durable fan-out

`ProcessPlatformPayoutConsumer` loads all `Processing` items and publishes one `ProcessPlatformPayoutItem` message per item.

There is no transactional outbox between parent state and these publishes. A partial publication failure can therefore enqueue only a subset of items. A later parent retry can publish the still-Processing items again.

Transport delivery itself must also be assumed at-least-once unless an exact stronger guarantee is proven.

## Critical execution concurrency flaw

The item consumer does **not** claim a unique execution state before invoking the PSP.

Observed order:

```text
load item where Status = Processing
verify Status == Processing
call ProcessPlatformWithdrawAsync(...)
    -> provider WithdrawAsync(...)
only after provider response:
    CAS Processing -> Completed/Failed/Cancelled
```

Consequently two concurrent deliveries for the same item can both:

1. read `Processing`;
2. pass the status check;
3. call the provider Pix-out endpoint;
4. only then race on the local CAS.

The CAS protects the local terminal transition, but it occurs too late to protect the external monetary side effect.

If the retained provider does not guarantee idempotency for the stable item ID, this can execute the same platform transfer twice.

### V2 requirement

A monetary execution job needs a database claim before the network call, conceptually:

```text
reserved
  -> executing (CAS + lease / execution token)
       -> completed
       -> provider_processing
       -> execution_unknown
       -> definitively_failed
```

Only the owner of the current execution lease/token may issue the monetary POST.

Provider idempotency keys are still required where supported; the local execution claim is not a substitute for provider idempotency after network ambiguity.

## Critical unknown-result flaw

`WithdrawService.ProcessPlatformWithdrawAsync` catches any exception and maps it to:

```text
Status = Failed
```

This includes transport conditions that do not prove the PSP rejected the transfer, such as a timeout or connection loss after the provider accepted the Pix-out.

The item consumer then handles `Failed` as a definitive financial failure and calls `RecordPlatformWithdrawalFailedAsync`, releasing/reversing the platform blocked amount.

This is the same class of defect found in merchant Pix-out, now applied to platform-owned withdrawals.

V2 must distinguish:

```text
explicit provider rejection -> failed
ambiguous transport/result  -> execution_unknown
```

Unknown execution keeps the funds reserved until provider query/webhook/reconciliation resolves the outcome.

## Critical completed -> processing rollback

When the provider returns `Completed`, the item consumer performs a local CAS:

```text
Processing -> Completed
```

and then posts the completion to the ledger.

If the ledger completion fails, the code rolls the item back:

```text
Completed -> Processing
```

and clears `CompletedAt`.

The external Pix-out may already be irreversibly completed at this point.

Returning the domain item to `Processing` makes the already-executed transfer eligible for another processing message/provider call.

This is a direct duplicate-transfer hazard.

The provider webhook path contains the same rollback pattern: a completed webhook first marks the item completed; if the ledger post fails, the item is changed back to `Processing`.

### V2 invariant

External financial truth must never be erased because an internal ledger follow-up failed.

If the provider has confirmed completion but internal accounting fails, use a recovery state such as:

```text
provider_completed_accounting_pending
```

The correct recovery is to repair/idempotently finish the missing internal posting, not execute the provider transfer again.

## Failed/cancelled -> processing rollback

Failed and cancelled paths also mark the item terminal and then post a ledger reversal. If that ledger reversal fails, the item is rolled back to `Processing`.

This again conflates:

- provider execution state;
- internal accounting state.

V2 must represent them independently enough that an accounting-repair problem cannot cause a new monetary execution.

## Webhook internal-error misclassification

`PlatformPayoutWebhookService.TryProcessWebhookAsync` wraps terminal processing in a general `catch`.

If internal webhook processing throws, the catch calls `HandleItemFailedAsync` with an internal-error message.

An internal database/application failure therefore can be converted into a provider-style financial failure and trigger a ledger reversal.

V2 rule:

> Internal processing failure is not evidence of provider failure.

Webhook parse/auth/application errors should result in retry/recovery/alerting while preserving the last externally proven provider state.

## Webhook lookup constraints

The webhook service only searches platform payout items currently in `Processing` and identifies them by provider/type plus one of provider payout ID, EndToEnd ID or provider transaction ID.

This is reasonable for duplicate-terminal suppression, but because completion/accounting failure itself can move an externally completed item back to `Processing`, the lookup boundary does not solve the state-model problem.

V2 provider events require stable source-event/provider-reference idempotency independent from mutable payout execution state.

## Parent aggregation semantics

When no item remains `Processing`, the parent becomes:

- `Completed` if all completed;
- `Failed` if all failed;
- `Cancelled` if all cancelled;
- `PartiallyCompleted` for a mixed terminal set.

This cannot express a mixed state containing an unresolved external result because no `execution_unknown` state exists.

If V2 later retains multi-provider platform sweeps, the parent should aggregate child truth without forcing unresolved items into failed/completed semantics.

## Admin request idempotency

The audited create endpoint does not expose/require a stable request idempotency key.

A client/operator retry that creates a second request receives a new `PlatformPayout` ID. Ledger idempotency tied to each new payout ID does not protect against duplicate business requests.

Any future V2 platform-payout request requires first-class request idempotency in addition to per-item provider idempotency.

## Legacy ledger posting summary

Previously audited platform-payout ledger behavior:

Request:

```text
PlatformBlocked CREDIT amount
```

Complete item:

```text
PlatformBlocked    DEBIT amount
PlatformPayoutsOut CREDIT (amount - provider_fee)
AcquirerPayoutsOut CREDIT amount
```

Failure/cancellation:

```text
PlatformBlocked DEBIT amount
```

The accounting concept can be reconsidered only after the target fund-flow defines explicit SwiftPay-owned revenue/funds at each provider.

## V2 disposition

`DEFER` from the initial Pix-first release.

Merchant Wallet/Pix-out is a product requirement. An administrative mechanism for SwiftPay to sweep its own funds from provider balances is not required to prove the first seller-facing vertical slice.

Do not implement platform payout until all of the following are approved:

1. explicit legal/economic ownership of provider-held funds;
2. chart of accounts with explicit platform-owned revenue/liquidity;
3. platform-withdrawable calculation that cannot include merchant liabilities;
4. retained-provider Pix-out/idempotency behavior;
5. execution-claim/lease contract;
6. `execution_unknown` recovery contract;
7. external provider reconciliation;
8. request-level idempotency;
9. operator authorization/step-up/audit controls.

## If implemented later: target execution model

```text
requested
    |
    | atomic DB transaction
    v
reserved + execution_job
    |
    | worker claims exact item
    v
executing
    |\
    | \ provider accepted / async
    |  -> provider_processing
    |
    | explicit completed
    -> provider_completed
           |
           | atomic/idempotent accounting
           v
       completed

ambiguous timeout
    -> execution_unknown
         -> query/webhook/reconciliation
              -> provider_completed
              -> definitively_failed
```

A provider-completed operation can never transition back to a provider-executable state.

## Required fail-first tests if feature is activated

1. Duplicate concurrent worker delivery issues at most one external execution claim.
2. Provider timeout after acceptance keeps funds reserved and enters `execution_unknown`.
3. Provider-completed + ledger transient failure does not execute Pix-out again.
4. Duplicate completed webhooks create exactly one completion posting.
5. Mixed provider result with unknown child does not finalize parent as definitively failed/completed.
6. Two identical admin requests with same idempotency key create one platform payout.
7. Platform withdrawal availability never consumes MerchantAvailable, MerchantBlocked, MerchantReserved or other merchant-owned liabilities.
8. Broker/worker outage after request cannot lose the execution job because reservation and outbox/job are atomic.

## Reconstruction implication

The legacy platform-payout feature is materially more complex and riskier than the seller-facing need justifies for V2 launch.

Deferring it reduces scope and removes a class of multi-provider monetary fan-out from the first release. If the business later requires provider sweeps, V2 can add the feature on top of the already-safe payout/outbox/reconciliation primitives instead of porting the legacy implementation.