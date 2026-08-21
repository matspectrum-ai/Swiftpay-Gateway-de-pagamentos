# SwiftPay V2 — Payout / Pix-out Contract

Status: Phase 1 foundational contract; ready for fail-first domain/database tests

Date: 2026-08-13

## Purpose

Define merchant payout lifecycle so local failure, provider failure and unknown external execution are never conflated.

## Canonical resource

A `Payout` is one merchant request to move previously available SwiftPay funds to one approved Pix destination.

Minimum immutable/snapshot fields at request:

```text
id
merchant_id
environment
currency = BRL
amount_cents
merchant_fee_cents
recipient_amount_cents
external_id?
destination snapshot/reference
provider routing policy/version
created_at
```

Provider execution identity lives in a separate payout ProviderAttempt/execution record or equivalent operation-scoped object.

## States

```text
requested
processing
execution_unknown
completed
failed
rejected
cancelled
```

### requested

Funds are already reserved from merchant available balance into payout-blocked liability. The payout has not yet begun an external provider operation.

This state may await admin approval when approval policy requires it.

### processing

One provider execution has a valid execution claim and/or the provider has acknowledged an in-progress payout.

Merchant cancellation is no longer allowed once external execution may have started.

### execution_unknown

SwiftPay cannot prove whether the provider executed the transfer.

Funds remain blocked. This state is recoverable by provider query, authenticated webhook, reconciliation or controlled operations.

### completed

Authoritative external evidence proves the payout succeeded. Blocked funds are consumed exactly once through the payout completion posting.

### failed

Authoritative evidence proves the payout did not execute and cannot later resolve as the same successful operation. Reserved funds are released exactly once.

### rejected

An approval/business-policy rejection occurred before external execution. Funds are released exactly once.

### cancelled

Merchant/system cancellation occurred before external execution. Funds are released exactly once.

## Allowed transitions

```text
requested -> processing
requested -> rejected
requested -> cancelled

processing -> completed
processing -> failed
processing -> execution_unknown

execution_unknown -> completed
execution_unknown -> failed
execution_unknown -> execution_unknown

completed -> completed
failed -> failed
rejected -> rejected
cancelled -> cancelled
```

Forbidden:

```text
processing -> cancelled by ordinary merchant action
execution_unknown -> requested
execution_unknown -> failed only because a retry timer expired
completed -> failed
failed -> processing by automatic retry
```

A new payout after terminal failure is a new merchant operation/idempotency identity, not a rewind of the old payout.

## Request idempotency and reservation

Create payout uses first-class request idempotency from `payment-and-provider-attempt.md`.

Inside one PostgreSQL transaction:

```text
claim request idempotency
validate merchant/KYC/payout capability
validate destination
calculate immutable fee snapshot
atomically require available >= reserved amount
create Payout(requested)
post available -> payout_blocked
create required outbox/job
COMMIT
```

Two concurrent payout requests cannot overspend merchant available balance.

`external_id` remains a business reference and does not replace `Idempotency-Key`.

## Approval

Approval policy is a snapshot/decision external to provider execution.

When manual approval is enabled:

```text
requested -> approved execution claim -> processing
```

When approval is not required, the durable execution job may claim the requested payout automatically.

Rejection is legal only before external execution ownership is acquired.

## Provider execution claim

Before monetary POST:

```text
claim one payout execution/provider attempt
```

with a lease/execution token.

Two workers cannot own the same monetary execution concurrently.

Lease expiry after possible transmission does not authorize another POST. The execution becomes/re-enters recovery assessment.

## Outcome classification

Provider adapter returns certainty semantics:

```text
success/completed
provider_processing
definitive_rejection_or_failure
pre_execution_failure
execution_unknown
```

Mapping:

```text
success              -> completed
provider_processing  -> processing
explicit final fail  -> failed
ambiguous transport  -> execution_unknown
```

Generic exception != definitive failure.

## Unknown-result rule

For timeout, reset, lost response, worker crash after possible transmission or ambiguous provider failure:

```text
Payout -> execution_unknown
merchant payout-blocked funds remain unchanged
no second payout POST is automatically created
```

Recovery uses the same stable provider/client reference.

Only provider-specific proof that no external payout exists may authorize a new explicit provider attempt under an approved recovery policy.

## Provider idempotency requirement

Pix-out provider enablement requires stable request identity and deterministic duplicate protection/recovery as defined in `native-pix-provider-adapter.md`.

Sending a header/reference in legacy code is evidence of intent, not proof the PSP honors it. Conformance tests must prove behavior.

## Terminal financial postings

Reservation and terminal postings follow `ledger-and-balance.md`.

Definitive failure/rejection/cancel before external success releases blocked funds exactly once.

Unknown result does not release.

Completed payout consumes payout-blocked liability and records provider asset outflow, provider cost and merchant payout-fee revenue explicitly.

## Destination

Payout destination is either an approved saved payout account or a validated inline Pix destination if product policy allows it.

The execution stores an immutable destination snapshot sufficient for audit even if the saved payout account is later edited/deleted.

Sensitive destination values are masked in ordinary read/list responses where appropriate.

## Merchant-facing semantics

Public status must not claim `failed` while SwiftPay only knows `execution_unknown`.

A recovery/processing status may be exposed as a normalized `processing` plus a machine-readable reason, or as an explicit public `pending_confirmation`; exact HTTP/public naming belongs to the API contract.

The critical property is truthfulness: unknown is not failure.

## Webhook/event output

Merchant payout events use durable webhook event/delivery infrastructure.

Relevant canonical events can include:

```text
payout.requested
payout.processing
payout.completed
payout.failed
payout.cancelled
payout.rejected
```

`execution_unknown` is primarily an operational state; exposure as a merchant event is an explicit API/product decision.

## Sandbox

Sandbox payout simulation must be structurally impossible in Production.

Simulation never invokes a real provider and must exercise the same state/ledger transition functions as production evidence would, with a sandbox-only source identity.

The legacy mismatch where Sandbox simulation existed without a coherent sandbox create path is not preserved.

## Required fail-first tests

1. duplicate create idempotency key creates one payout and one reservation;
2. same key with different request conflicts;
3. two concurrent reservations against insufficient combined balance allow exactly one;
4. cancellation/rejection before execution releases exactly once;
5. processing payout cannot be merchant-cancelled;
6. two workers cannot claim one payout execution;
7. timeout after possible provider acceptance becomes `execution_unknown`;
8. unknown result keeps blocked balance unchanged;
9. lease expiry cannot cause blind second provider POST;
10. provider webhook/query can resolve unknown -> completed exactly once;
11. provider proof of non-execution can resolve unknown -> failed and release exactly once;
12. stale failure after completed is absorbed and cannot release funds;
13. duplicate completed evidence creates one ledger completion posting;
14. provider credentials/fees/IDs do not leak into public payout response unless explicitly normalized;
15. Sandbox simulation cannot execute against Production environment.