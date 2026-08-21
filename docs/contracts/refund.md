# SwiftPay V2 — Refund Contract

Status: Phase 1 foundational contract; provider-specific execution evidence and commercial fee policy remain required

Date: 2026-08-13

## Purpose

Make refunds first-class resources instead of mutating Payment through `PartiallyRefunded`/`Refunded` states that cannot represent repeated movements.

## Core rule

Payment collection truth remains independent from refund execution.

A paid Payment stays canonically `paid`. Refund state and cumulative refunded amount are derived from Refund resources and successful refund financial postings.

Merchant compatibility projection may display `partially_refunded` or `refunded`, but those are projections, not the collection state machine.

## Refund resource

Minimum fields:

```text
id
payment_id
merchant_id
environment
amount_cents
currency = BRL
external_id?
idempotency_key/request link
state
provider routing/execution reference
fee-policy snapshot/version
created_at
completed_at?
failed_at?
```

Every refund has its own identity. Amount is never a refund identity.

## States

```text
requested
processing
execution_unknown
completed
failed
cancelled
```

### requested

Refund exists durably and has passed initial eligibility/idempotency checks. Required merchant funding may already be reserved according to the approved fee/funding policy.

### processing

One provider refund execution is claimed or provider has acknowledged processing.

### execution_unknown

SwiftPay may have issued the refund request but cannot prove whether the provider accepted/executed it.

Any reserved refund funding remains blocked.

### completed

Authoritative provider/reconciliation evidence proves this specific refund movement succeeded. Cumulative refunded amount and ledger effects apply exactly once.

### failed

Authoritative evidence proves this refund did not execute and cannot later resolve as the same successful external refund. Reserved funding is released exactly once.

### cancelled

Local cancellation before external execution, if supported by product policy. Reserved funding is released exactly once.

## Allowed transitions

```text
requested -> processing
requested -> cancelled
requested -> failed      # only definitive pre-execution rejection

processing -> completed
processing -> failed
processing -> execution_unknown

execution_unknown -> completed
execution_unknown -> failed
execution_unknown -> execution_unknown

completed -> completed
failed -> failed
cancelled -> cancelled
```

A second partial refund creates a second Refund resource. It does not require rewinding or reusing the first Refund.

## Refundable amount

Before a new refund is created, SwiftPay atomically computes/validates:

```text
completed_refunds
+ active_reserved_refunds
+ new_refund_amount
<= payment.refundable_limit
```

`payment.refundable_limit` is normally the original eligible payment amount unless the commercial/product contract defines a narrower basis.

This check and creation/reservation occur in one PostgreSQL transaction so concurrent refunds cannot exceed the eligible amount.

## Request idempotency

Merchant/API refund creation uses first-class operation idempotency.

Same merchant/environment/payment/idempotency key + same canonical request returns the same Refund.

Same key + different request returns deterministic conflict.

`external_id` is a merchant business reference, not the safety primitive.

## Provider execution identity

A provider refund operation has a stable SwiftPay execution/reference identity. Provider capability must prove:

```text
full vs partial support
stable provider refund/object reference
provider/client reference support
duplicate protection/recovery
status/query semantics
webhook/event identity
amount semantics
```

Provider status `refunded` alone is not enough to enable programmatic refund execution.

## Amount normalization

Provider webhook/query amount must be normalized explicitly as one of:

```text
event_delta
cumulative_total
not_supplied
```

Core never assumes a field named `refunded_amount` is a per-event delta.

For `cumulative_total`, SwiftPay derives the newly proven delta against durable provider/payment refund state and rejects regressions/inconsistent totals.

For partial refund completion, a positive exact amount for that Refund must be proven before posting.

## Unknown-result rule

Timeout, connection reset, lost response, ambiguous provider failure or crash after possible transmission becomes:

```text
Refund -> execution_unknown
```

No blind second refund POST is issued.

Reserved merchant refund funding stays blocked until the same external operation is recovered as completed or definitively failed.

## Financial policy snapshot

Refund economics are immutable per Refund and must explicitly answer:

```text
Is SwiftPay payment fee refundable?
Who funds any non-refundable platform fee?
Is provider fee/cost refundable?
When is provider cost authoritative?
What merchant balance is required/reserved before execution?
```

No implementation infers these answers from residual balances.

The exact posting template is defined after the fee policy is approved, but every result must remain balanced under `ledger-and-balance.md`.

## Provider-initiated refund evidence

A provider may notify SwiftPay of a refund that was not initiated through the local API.

SwiftPay then creates/claims a Refund resource from stable provider/source identity before applying financial effects.

It must not mutate only `Payment.RefundedAmount`.

If merchant funding is insufficient under the approved accounting policy, the event cannot be discarded or converted into fabricated available balance. The contract must represent the resulting merchant liability/debt/operational exception explicitly before such a provider is enabled.

## Cumulative projection

Canonical payment read model computes:

```text
refunded_amount_cents = SUM(completed Refund.amount_cents)
```

Projection:

```text
0                         -> paid
0 < refunded < limit      -> partially_refunded
refunded == limit         -> refunded
```

Two distinct same-value refunds remain visible and auditable as two resources/events.

## Provider events

Each accepted refund event has stable ProviderEvent identity/fingerprint independent from Refund amount.

One ProviderEvent may apply to exactly one normalized refund transition/evidence action in its approved scope.

Duplicate event redelivery creates no duplicate Refund posting.

Out-of-order events are recorded but cannot move a completed Refund backward.

## Merchant webhooks

Refund merchant events use the same durable webhook event/delivery subsystem as payments/payouts.

Examples:

```text
refund.requested
refund.processing
refund.completed
refund.failed
```

Payload includes stable SwiftPay refund ID and payment ID so merchants can deduplicate each refund independently.

## Sandbox

Sandbox supports the same first-class Refund resource and state-transition functions without calling real providers.

It must support at least:

- full refund simulation;
- partial refund simulation;
- two distinct equal-amount partial refunds;
- partial followed by final refund;
- duplicate simulated provider event;
- unknown/recovery simulation where useful for contract testing.

Simulation is structurally forbidden for Production resources/environment.

## Required fail-first tests

1. first partial refund completes without changing canonical Payment collection state from paid;
2. second partial refund after first is allowed when cumulative amount remains eligible;
3. partial followed by final refund reaches full cumulative amount;
4. two distinct equal-value partial refunds both post because their Refund/source IDs differ;
5. duplicate refund event posts once;
6. cumulative provider total is not accidentally added as a delta twice;
7. concurrent refunds cannot exceed refundable amount;
8. same idempotency key + same request returns same Refund;
9. same key + different amount conflicts;
10. timeout after possible provider execution becomes `execution_unknown`;
11. unknown result cannot trigger blind second refund POST;
12. unknown reserved funding remains blocked;
13. recovered completed refund applies exactly once;
14. recovered definitive failure releases reservation exactly once;
15. stale failed event after completed cannot reverse the refund;
16. provider event without stable ID uses only the provider-approved deterministic fingerprint;
17. public refund response never exposes provider secrets/internal routing;
18. Sandbox partial-refund sequence has parity with production state/ledger functions and cannot affect Production.