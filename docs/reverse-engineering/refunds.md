# Legacy Refund / Estorno Audit

Status: Core execution/state-machine audit complete; retained-provider refund contracts remain part of the provider deep-dive

Legacy reference: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Scope

This audit answers the high-risk questions needed before SwiftPay V2 can define a refund contract:

- whether production exposes a generic refund execution path;
- which provider clients can actually request a refund;
- how refund states arrive from providers;
- how full and partial refunds mutate `Payment`;
- how refund events reach the ledger and merchant webhook;
- what identity is used for deduplication;
- whether repeated partial refunds are representable;
- whether a refund request can enter an indeterminate state;
- whether Sandbox behavior matches production.

This document does not claim that every retained provider's external refund API has been fully documented. Provider-specific client/webhook contracts remain a follow-up gate.

## Executive conclusion

The legacy implementation has **refund accounting and webhook reaction**, but it does not expose a coherent generic production refund-execution domain.

The observable architecture is approximately:

```text
provider refund/status event
        -> provider webhook endpoint
        -> AcquirerWebhookData
        -> PaymentProcessingService
        -> Payment status mutation
        -> PaymentCompletedMessage
        -> PaymentCompletedConsumer
        -> refund ledger posting
        -> merchant notification/webhook
```

There is no refund entity and no stable refund/event identity in the central processing contract.

A MagicPay HTTP refund method exists, but no production caller was found. Sandbox can simulate a full refund directly. These facts reinforce that refund execution is incomplete/inconsistent rather than a mature generic feature.

V2 must not preserve this model.

## Production refund execution boundary

### No generic refund method in `IAcquirerService`

The shared provider contract exposes payment creation/status and withdrawal behavior, but no generic `RefundAsync`/refund request operation.

This means the canonical provider layer cannot initiate refunds in a provider-independent way.

### Search result for production refund request methods

Repository search for `RefundAsync` did not reveal a production generic refund execution service. The concrete HTTP refund path found was MagicPay's client method:

```text
POST {baseUrl}/payment/{paymentId}/refund
```

implemented by `MagicPayClient.RefundPaymentAsync`.

Search for `RefundPaymentAsync` found the interface declaration and implementation, but no production caller. `MagicPayService`, which is the adapter exposed through `IAcquirerService`, does not invoke it.

Therefore, at the audited revision, the MagicPay refund HTTP operation appears to be a **dead/unexposed capability**, not the active SwiftPay refund execution path.

### Latent MagicPay unknown-result/retry risk

If that method were activated without redesign, it would inherit two risks:

1. the method contains no explicit refund idempotency key;
2. MagicPay is among the provider clients previously identified behind the shared method-agnostic HTTP resilience policy.

A timeout/5xx on `POST /payment/{id}/refund` could therefore become an ambiguous external result and/or an automatic retry unless MagicPay independently guarantees idempotency for that endpoint.

This is recorded as a **latent risk**, not proof that production currently executes duplicate MagicPay refunds, because no active caller was found.

## Central webhook contract

`AcquirerWebhookData` identifies the payment using combinations of:

- `AcquirerType`;
- `AcquirerPaymentId`;
- optional SwiftPay/external payment ID;
- optional Pix `TxId`.

For refund behavior it carries:

- target `PaymentStatus`;
- optional `RefundedAmount`.

It does **not** carry:

- a SwiftPay refund ID;
- a provider refund ID;
- a provider webhook event ID;
- a stable source-event key;
- a distinction between incremental refund amount and cumulative refunded total;
- a refund attempt/request identity.

The central processor therefore identifies the **payment**, not the **refund event**.

## Refund state transitions

`PaymentProcessingService.GetValidSourceStatuses()` currently accepts:

```text
target Refunded          <- source Completed only
target PartiallyRefunded <- source Completed only
target Processing        <- source Completed only
```

Refund processing uses a compare-and-set style lock:

```text
valid source status -> Confirming -> target status
```

This prevents concurrent processing of the same eligible transition, but the allowed source-state model is incorrect for multiple refund events.

## Critical flaw: repeated partial refunds cannot be represented

For a first partial refund:

```text
Completed
   -> PartiallyRefunded
```

After that transition, another `PartiallyRefunded` webhook is not eligible because the only accepted source state is `Completed`.

Therefore the legacy central processor cannot correctly represent:

```text
Completed
  -> partial refund A
  -> partial refund B
```

It also cannot naturally represent:

```text
Completed
  -> partial refund
  -> final full refund
```

The later webhook is resolved against a payment that exists but is no longer in an eligible source status, so the central service reports it as already processed/current-state behavior rather than as another legitimate refund movement.

This is a state-model defect, not a desirable idempotency property.

## Critical Bankizi refund-request dead-end

Bankizi exposes a provider status `RequestedRefund`, mapped by SwiftPay to `PaymentStatus.Processing`.

The central processor allows:

```text
Completed -> Processing
```

and labels that transition as:

```text
payment.refund_requested
```

However a subsequent Bankizi terminal refund event maps to `Refunded` or `PartiallyRefunded`, whose accepted source state is **only `Completed`**, not `Processing`.

Thus the natural provider sequence:

```text
Completed
  -> RequestedRefund / Processing
  -> Refunded
```

can be stranded at `Processing`.

The same incompatibility applies to a terminal partial-refund event following `RequestedRefund`.

V2 must model refund request/attempt state independently from the payment's settled/partially-refunded aggregate state.

## Payment aggregate mutation

### Full refund

For `PaymentStatus.Refunded`, the central service:

- sets payment status to `Refunded`;
- sets `RefundedAt = UtcNow`;
- sets `RefundedAmount = webhook refunded amount ?? original payment amount`.

The downstream ledger call nevertheless performs the full-refund financial reversal based on the original payment amount and financial snapshot, not a separately identified refund movement.

### Partial refund

For `PaymentStatus.PartiallyRefunded`, the service performs:

```text
Payment.RefundedAmount += webhookData.RefundedAmount ?? 0
```

This assumes the provider field is the **delta for this specific refund event**.

That assumption is not encoded in the provider-neutral contract and is not safe to infer from names such as:

- `amountRefunded`;
- `refunded_amount`;
- `refundedAmount`.

Those names may represent a cumulative amount depending on the provider contract.

V2 must normalize provider data into an explicit semantic field such as:

```text
refund.amount_delta
```

or derive the delta from a documented cumulative provider total using durable prior state.

## Partial-refund ledger identity weakness

The previously audited legacy ledger deduplicates a partial refund using a combination equivalent to:

```text
PaymentId + PixPartialRefund + refunded amount
```

This is insufficient event identity.

Two legitimate partial refunds of the same amount are distinct financial events, for example:

```text
refund A = R$ 10,00
refund B = R$ 10,00
```

They must not collapse into one posting.

The central payment-state bug currently blocks repeated partial refunds even before this ledger weakness becomes fully visible, but V2 must fix both layers.

## Provider observations

### Bankizi

The webhook model explicitly contains:

- `RequestedRefund`;
- `Refunded`;
- `PartiallyRefunded`;
- `amountRefunded`;
- `endToEndIdRefunded`;
- `refundedAt`.

The endpoint forwards `amountRefunded` to `AcquirerWebhookData` but does **not** propagate `endToEndIdRefunded` as a distinct refund identity.

The model documentation describes `amountRefunded` only as "valor reembolsado", not whether it is event-delta or cumulative total. That semantic remains unresolved and must be verified against the retained provider contract.

The `RequestedRefund -> Processing -> terminal refund` incompatibility described above is confirmed by the local status mapping and central state machine.

### Accithus

The transaction webhook model carries:

- transaction `id`;
- `tx_id`;
- status;
- `refunded_amount`;
- timestamps.

Status normalization recognizes:

- `refunded`;
- `partially_refunded`.

The webhook forwards `refunded_amount`, but there is no distinct refund-event/refund-operation ID in the central contract.

### IHub Banking

The IHub webhook path has an explicit `cashin.refunded` event and code documentation states that IHub supports only total refund in this integration.

It maps the event to `PaymentStatus.Refunded` and forwards the webhook amount as `RefundedAmount`.

No partial-refund operation is represented in the inspected IHub path, and no distinct refund event ID is propagated to the central processor.

### HunterPay

The transaction model carries `refundedAmount`, and the webhook/event normalization recognizes a refunded transaction state/event.

Again, the central processing call identifies the payment and amount rather than a unique refund movement.

### HeartPay

The status converter recognizes both:

- `refunded`;
- `partially_refunded`.

However the inspected `HeartPayWebhookEndpoint` does **not** populate `AcquirerWebhookData.RefundedAmount`.

A full refund can fall back to the original payment amount in central processing, but a partial refund reaches the consumer without a positive refund amount. `PaymentCompletedConsumer.ProcessPartiallyRefundedAsync` explicitly logs and returns when the amount is `<= 0`, so no partial-refund ledger reversal is posted through that path.

Provider-specific refund event classification still requires retained-provider deep verification, but the missing normalized partial-refund amount is already a concrete integration gap.

## Downstream ledger and notifications

After the payment status mutation, `PaymentProcessingService` publishes a `PaymentCompletedMessage` even for refund states.

`PaymentCompletedConsumer` dispatches:

### Full refund

```text
RecordPaymentRefundedAsync(...)
```

then merchant refund notification and merchant webhook/event handling.

### Partial refund

It requires `message.RefundedAmount > 0`, then calls:

```text
RecordPaymentPartiallyRefundedAsync(...)
```

and emits the partial-refund notification/webhook path.

The existing merchant-webhook findings still apply:

- weak legacy signature secret derived from public entity ID;
- non-durable logical delivery identity;
- nested retry layers.

V2 refund events must use the same durable webhook-event/delivery model required for other merchant events.

## Sandbox behavior

Public Sandbox transaction simulation accepts:

```text
POST /v1/transactions/{transactionId}/simulate
```

with action `refund`.

`SandboxService.SimulatePaymentRefundAsync`:

- requires `Completed`;
- directly changes the payment to `Refunded`;
- records the full ledger reversal;
- publishes `payment.refunded` when a callback exists;
- notifies realtime UI.

Sandbox does **not** simulate partial refunds in the inspected contract.

This produces an important parity mismatch:

- Sandbox exposes a merchant-triggerable full refund simulation;
- no equivalent generic production refund-execution API/service was found.

V2 Sandbox must exercise the same refund state machine and idempotency contract as production while replacing only the external PSP execution.

## Required V2 domain model

Do not model refunds as a mutable amount/status attached only to `payments`.

Use a first-class refund resource/event, conceptually:

```text
refunds
- id
- merchant_id
- payment_id
- environment
- amount
- currency
- status
- idempotency_key
- provider_id
- provider_refund_id
- provider_request_reference
- requested_at
- completed_at
- failed_at
- failure_code
- failure_message
- created_at
```

and provider/source-event identity such as:

```text
provider_events
- provider
- provider_event_id
- event_type
- provider_object_id
- payload_hash/raw reference
- received_at
- processed_at
```

Exact schema remains a Phase 1 decision.

## Required V2 refund state semantics

Candidate refund state machine:

```text
requested
   -> processing
      -> completed
      -> failed              # only explicit/definitive provider failure
      -> execution_unknown   # timeout/lost response/ambiguous outcome
```

A payment aggregate should derive refund state from its refund records, for example:

```text
refunded_total = SUM(completed refund amounts)
```

Then payment presentation can derive:

```text
refunded_total == 0                  -> not refunded
0 < refunded_total < payment.amount  -> partially refunded
refunded_total == payment.amount     -> fully refunded
```

This supports any valid sequence of multiple partial refunds without abusing the payment status as refund-attempt state.

## Non-negotiable V2 contracts

1. Every refund request has a SwiftPay refund ID.
2. Every merchant-initiated refund create request has a stable idempotency key.
3. Provider refund IDs/event IDs are persisted when available.
4. Financial posting idempotency keys identify the refund/source event, never only `payment + amount`.
5. Multiple legitimate same-value partial refunds are representable.
6. Cumulative provider refunded totals are never treated as event deltas without explicit normalization.
7. Refund sum cannot exceed the eligible refundable amount.
8. Concurrent refund requests are serialized/validated transactionally against remaining refundable amount.
9. A provider timeout/connection reset after monetary submission becomes `execution_unknown`, not automatic definitive failure.
10. No automatic retry of a monetary refund POST is allowed unless provider idempotency is documented and the exact same stable key is reused.
11. Ledger reversal occurs once for a confirmed refund source event.
12. Sandbox uses the same domain state machine and ledger contract as production.
13. Merchant webhook refund events use durable event/delivery identity and a real secret.
14. Payment-level refunded totals are derived/reconciled from canonical completed refunds rather than trusted as an independently mutable financial source of truth.

## Fail-first tests required before implementation

At minimum:

### Repeated partial refunds

```text
payment = 10000
refund A = 2500
refund B = 2500

expect:
- two distinct refund resources
- two distinct ledger source events
- refunded total = 5000
- payment presented as partially refunded
```

### Same-amount idempotency distinction

Two requests with **different** idempotency keys for 1000 each may both succeed when refundable balance permits.

Replaying either original idempotency key must return/reuse the same refund and must not post again.

### Final refund after partial

```text
payment = 10000
completed partial refund = 3000
new refund = 7000

expect refunded total = 10000
expect fully refunded presentation
```

### Concurrent over-refund

```text
remaining refundable = 5000
concurrent refund A = 4000
concurrent refund B = 4000
```

Exactly one may reserve/execute if both cannot fit. The sum of accepted refund reservations/completions must never exceed 5000.

### Unknown external result

Provider accepts request but client times out before response.

Expect:

- refund remains `execution_unknown`/recovery-required;
- no second monetary POST unless provider idempotency proves it safe;
- no ledger reversal until external success is established;
- recovery via provider query/webhook/reconciliation.

### Duplicate provider webhook

The same provider refund event delivered N times posts exactly once.

### Cumulative provider amount

If a provider reports cumulative refunded total, normalization computes only the new delta and never double-posts prior refunds.

## Open provider questions

For every provider retained in V2, verify explicitly:

1. Does it support refund at all?
2. Full only or partial?
3. Refund request endpoint and monetary unit?
4. Stable provider idempotency key support?
5. Stable refund operation ID?
6. Stable webhook event ID?
7. Is `refunded_amount` event delta or cumulative total?
8. Does it expose refund-specific EndToEndId/reference?
9. Status/query endpoint for recovery after unknown result?
10. Webhook authentication/signature contract?
11. Can multiple partial refunds occur?
12. Are fees returned, retained or recalculated on refund?
13. Can provider fees differ between full and partial refund?
14. What is the provider's behavior after timeout/5xx?

These questions move into the retained-provider deep audit rather than blocking the conclusion that the current generic refund model must be replaced.

## Decision impact

The legacy refund implementation should be classified **REPLACE**, not ported.

Reusable knowledge:

- financial reversal concepts already extracted from the ledger audit;
- merchant-facing refund event semantics;
- selected provider status vocabulary;
- requirement to support full/partial refund where provider capability exists.

Do not reuse:

- payment-status-as-refund-attempt model;
- amount-based partial-refund idempotency;
- mutable aggregate amount as event identity;
- silent treatment of later legitimate refund events as already processed;
- Sandbox-only refund execution semantics;
- unverified automatic POST retry behavior.