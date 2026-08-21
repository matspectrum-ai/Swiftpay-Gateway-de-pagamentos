# SwiftPay V2 — Native Pix Provider Adapter Contract

Status: Phase 1 foundational contract; provider-specific conformance evidence still required

Date: 2026-08-13

## Objective

Define the stable SwiftPay boundary for native Pix providers without pretending every PSP has the same capabilities.

The core owns Payment state, ProviderAttempt state, request idempotency, ProviderEvent identity, ledger semantics, merchant balances and the public API. An adapter owns only provider translation, execution, recovery and event normalization.

## Capability-first model

Capabilities are declared per provider account and per operation:

```text
create_pix_charge
query_pix_charge
recover_pix_charge
pix_charge_webhook
create_pix_payout
query_pix_payout
recover_pix_payout
pix_payout_webhook
create_refund
query_refund
recover_refund
refund_webhook
```

A provider may be enabled for Pix-in while disabled for Pix-out or refund. Unsupported operations are not fake no-op methods.

Each provider account records tested characteristics:

```text
client_reference_support
create_idempotency_level
query_recovery_support
webhook_event_identity
amount_unit
expiration_semantics
customer_requirements
payout_requirements
refund_requirements
```

## Create idempotency levels

```text
native_strong
  the provider guarantees the same stable reference resolves to one external operation

query_recoverable
  create cannot be replayed safely, but SwiftPay can determine whether the original operation exists

none
  safe replay and deterministic recovery are not proven
```

`none` cannot silently enable retry-on-timeout.

## Monetary boundary

Core always sends integer BRL cents. The adapter converts to provider-specific units deterministically and never exposes provider units to domain code.

Floating-point money conversion is forbidden.

## Customer requirements

Every adapter declares which customer fields are truly required. Routing selects only compatible providers.

If required data is absent, SwiftPay returns a structured requirement/configuration failure or selects another explicitly compatible provider.

Adapters never invent customer identity/contact fields to satisfy provider validation.

## Stable client reference

Preferred reference for an external operation is the SwiftPay `provider_attempt_id`, or a deterministic encoded form when provider format restrictions require it.

Provider documentation must state:

- which provider field receives the reference;
- format/length restrictions;
- uniqueness scope;
- whether it deduplicates requests;
- whether it can be queried after uncertainty;
- whether webhooks return it.

## Execution certainty

Provider operations return a normalized certainty class:

```text
success
definitive_rejection
pre_execution_failure
execution_unknown
configuration_error
unsupported
```

`execution_unknown` means the request may have executed externally and SwiftPay cannot yet prove the outcome.

Timeout, connection reset, lost response or ambiguous provider failure after possible transmission defaults to `execution_unknown` unless the provider-specific contract proves stronger semantics.

## Retry rule

Monetary POST operations do not inherit generic transport retries:

```text
create Pix charge -> no transparent retry
create Pix payout -> no transparent retry
create refund     -> no transparent retry
```

A provider-specific replay is allowed only when conformance evidence proves the provider's idempotency primitive resolves to the same external operation.

Status/recovery reads may use bounded read retry.

## Charge recovery

After `execution_unknown`, recovery uses strongest available evidence:

```text
1. query by stable SwiftPay/client reference
2. query by known provider payment ID/TxId
3. authenticated provider event
4. reconciliation evidence
5. manual operational evidence as last resort
```

Normalized recovery result:

```text
found_pending
found_paid
found_expired
proven_not_created
still_unknown
```

Only `proven_not_created` may authorize a new external create attempt under routing policy.

## Pix-out enablement

A provider is eligible for Pix-out only if it proves:

- stable request/payout identity;
- supported amount and Pix-key semantics;
- duplicate protection or deterministic recovery;
- status/recovery query;
- terminal event or deterministic polling evidence where available;
- correct ambiguous-result behavior;
- funding/fee mapping compatible with `ledger-and-balance.md`.

A provider that cannot safely recover an ambiguous payout result is disabled for Pix-out by default.

## Refund enablement

Programmatic refund requires proof of:

- an actual refund execution operation;
- full vs partial support;
- stable refund/client identity;
- cumulative refund limits;
- whether reported refund amount is event delta or cumulative total;
- deterministic recovery after uncertain execution;
- event/status mapping;
- fee/cost semantics required by the refund contract.

A provider status string containing `refunded` does not by itself prove a safe callable refund API.

## Provider events

Provider events are authenticated and normalized before domain application.

Normalized identity includes conceptually:

```text
provider_account_id
provider_event_id or approved deterministic fingerprint
provider_object_type
provider_object_id
provider_txid/reference when available
event_type
normalized_status
amount_cents? with documented semantics
occurred_at?
received_at
payload_hash
```

If refund amount can mean either event delta or cumulative total, the adapter must declare the exact meaning. Core never guesses.

## Identity scope

Each adapter documents the uniqueness scope of provider identifiers. Database constraints use that scope instead of assuming provider IDs are globally unique.

## Routing

Routing filters provider accounts before ranking:

```text
enabled in environment
operation capability enabled
customer requirements satisfied
amount limits satisfied
operation-specific requirements satisfied
required recovery/idempotency safety level satisfied
```

First release uses deterministic single-provider selection. No speculative parallel create or payout fan-out.

Fallback to another provider is allowed only after the previous attempt is `definitively_failed` or recovery proves the prior external operation was not created.

## Conformance tests

Every retained provider operation must pass common tests plus provider-specific fixtures.

Pix-in minimum:

1. exact money-unit conversion;
2. required customer fields fail explicitly;
3. no synthetic identity is generated;
4. successful create returns stable external identity and usable Pix data;
5. explicit rejection maps to definitive rejection;
6. ambiguous transport result maps to `execution_unknown`;
7. create POST is not invisibly retried;
8. supported recovery works from stable identity/reference;
9. duplicate paid event normalizes to one source identity;
10. invalid event authentication cannot mutate the domain;
11. stale status cannot move canonical Payment backward.

Pix-out minimum:

12. one execution claim cannot produce duplicate payout calls;
13. ambiguous result remains unknown and merchant funds stay blocked;
14. recovery resolves without blind second payout;
15. provider fee/funding data maps to the accounting contract.

Refund minimum:

16. declared full/partial support matches real behavior;
17. distinct same-amount refunds remain distinct by source identity;
18. cumulative-vs-delta semantics are explicitly tested;
19. ambiguous result does not trigger blind duplicate refund;
20. final refund can follow prior partial-refund evidence.

## Architecture consequence

```text
SwiftPay Payment Core
        |
PaymentOrchestrator
        |
Capability-aware NativeProviderRouter
        |
Thin provider adapters
```

A future Hyperswitch integration, if justified, must sit behind this boundary and cannot redefine Payment, Ledger, RequestIdempotency or merchant API semantics.