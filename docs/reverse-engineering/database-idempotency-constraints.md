# Legacy Database Idempotency and Financial Constraint Audit

Status: core financial/source-identity constraint audit complete

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Purpose

This audit distinguishes financial/idempotency behavior protected by PostgreSQL from behavior protected only by application reads/state checks.

V2 rule:

> If concurrent execution can create or move money twice, application-level `if` checks are not sufficient protection.

## Strong legacy constraints worth learning from

### Merchant account uniqueness

The current model has a unique index across:

```text
MerchantId + AccountType + Environment + MerchantAcquirerId
```

for merchant-owned accounts.

This prevents duplicate current-balance account rows for the same merchant/provider bucket.

The legacy repository also updates `Account.Balance` with atomic SQL deltas in the same transaction that inserts ledger entries.

This is useful conceptually, although no database constraint was observed that prevents a debit from producing a negative merchant available balance.

### Merchant payout completion

The ledger has a partial unique index equivalent to:

```text
UNIQUE (PayoutId, Operation)
WHERE PayoutId IS NOT NULL
  AND Operation = 'SettlementOut'
```

named:

```text
IX_LedgerTransactions_PayoutId_SettlementOut_Unique
```

This protects merchant payout completion from duplicate settlement posting at the database layer.

Legacy code additionally catches the unique-race. This is a strong pattern to preserve.

### Platform payout ledger postings

The model also has unique constraints for platform-payout operations, including provider item + operation and parent-without-item + operation.

These make selected platform payout ledger postings database-idempotent even though, as documented separately, provider execution itself remains unsafe under duplicate/concurrent delivery.

The distinction is important:

> Ledger uniqueness after a provider POST cannot prevent the provider POST itself from happening twice.

## Payment ledger gap

`LedgerTransaction.PaymentId` has a normal index, but no equivalent database uniqueness was observed for a payment source operation such as:

```text
PaymentId + PixIn + Approved
PaymentId + PixRefund + stable_refund_id
```

Legacy payment/refund idempotency therefore relies heavily on service queries such as “does a transaction already exist?” before insertion.

Those checks may reduce ordinary duplicates but are not the same as a unique source key under concurrent execution.

## Partial refund identity gap

The ledger model contains:

- PaymentId;
- PayoutId;
- PlatformPayoutId;
- PlatformPayoutItemId;
- Operation;
- Status;
- Amount.

It has no first-class `RefundId`, `ProviderEventId` or generic `SourceEventId`.

The audited partial-refund path therefore uses payment/operation/amount-oriented deduplication.

V2 must create a separate refund/source identity and unique financial posting key.

## Payment create idempotency gap

Legacy Pix creation checks `ExternalId` with an application query before creating the Payment.

No current-model unique index was observed for:

```text
merchant_id + environment + payment.external_id
```

Therefore concurrent requests with the same merchant reference can both pass the pre-insert `AnyAsync` check.

Also, `ExternalId` is optional and is not a dedicated HTTP idempotency key contract.

V2 needs a first-class create-operation idempotency model, e.g.:

```text
merchant_id
environment
operation
idempotency_key
request_hash
resource_id
response_snapshot/status
```

with database uniqueness.

A merchant business reference such as `external_id` can remain separately unique/optional according to its contract.

## Payout request idempotency gap

Legacy merchant payouts accept an `ExternalId`, but no unique `(merchant, environment, external_id)` payout constraint was observed in the audited model and creation path.

The strong SettlementOut ledger constraint only protects completion of a specific Payout ID. It does not prevent two separate payout rows from being created for the same retried business request.

V2 payout reservation must acquire request idempotency and reserve money atomically.

## Provider payment identity gap

The current Payment model contains `AcquirerPaymentId`, but no current-model unique index for it was observed.

The provider webhook state-lock path performs a conditional `ExecuteUpdate` by `AcquirerPaymentId` and valid source state.

Without uniqueness, if two payment rows share the same provider payment ID, the update predicate can match more than one row. The subsequent lookup then selects one confirming row, leaving source identity ambiguous.

V2 should scope provider identifiers explicitly, for example:

```text
UNIQUE(provider_account_id, provider_payment_id)
```

when the provider contract guarantees that identity scope.

Do not assume provider IDs are globally unique across accounts/environments unless documented.

## Pix TxId identity gap

No database uniqueness/index for Pix `TxId` was observed in the inspected current model.

The webhook fallback path searches PaymentsPix by TxId and takes a first result before attempting the payment state CAS.

If the provider scope permits duplicated TxIds across accounts/environments, or data corruption creates duplicates, this lookup is ambiguous.

V2 needs an explicit Pix/provider identity model and the correct uniqueness scope for each retained provider.

## Provider webhook source-event gap

No first-class durable provider webhook/event table was found in the audited payment-processing boundary containing a stable key such as:

```text
provider_account_id + provider_event_id
```

Webhook idempotency is primarily inferred from mutable Payment/Payout state transitions.

This creates several limitations:

- no durable record of every accepted provider event;
- no stable event identity independent from current aggregate state;
- difficult ordering/replay diagnostics;
- refund events cannot be distinguished robustly when provider payloads reuse amount/status;
- an event whose downstream publication failed may be classified as “already processed” on redelivery without restoring the lost side effect.

V2 should persist normalized provider/source events before or atomically with canonical state transitions when a stable provider event ID exists.

When a provider has no event ID, define a documented deterministic dedupe fingerprint from authenticated immutable fields and retain the raw request hash/evidence.

## Ledger structural constraints

`LedgerEntry` contains:

- transaction ID;
- account ID;
- Credit/Debit type;
- amount;
- timestamp/description.

The inspected EF model wires foreign keys but does not expose database check constraints proving, for example:

```text
entry.amount > 0
account.balance >= 0 for spendable merchant accounts
sum(debits) == sum(credits) for every ledger transaction
```

Some balancing/invariant behavior is established by application/repository posting templates rather than a generic database constraint.

Not every double-entry invariant is easy to express as a row-level CHECK; V2 can enforce balanced posting inside controlled SQL functions/procedures plus tests and disallow direct ledger mutation.

## Amount-domain constraints

Legacy entities use integer cents, which is correct, but financial positivity/non-negative semantics are often application validations rather than durable table constraints.

V2 should apply database checks where the invariant is universal, e.g.:

```text
payments.amount_cents > 0
refunds.amount_cents > 0
payouts.amount_cents > 0
ledger_entries.amount_cents > 0
fee basis points within approved bounds
attempt_count >= 0
```

Account-specific negative-balance rules belong in the controlled posting function because not every accounting account has identical debit/credit semantics.

## A useful legacy outbox precedent: EmailIntent

The latest legacy model already contains a much stronger durability pattern for email intents:

- unique `DedupeKey`;
- request/envelope hashes;
- explicit state;
- materialization/publish attempt counts;
- recovery timestamps;
- lease tokens/concurrency tokens;
- recovery indexes;
- terminal-summary consistency CHECKs.

This is noteworthy because the main payment/RabbitMQ boundary lacks a comparable transactional outbox.

V2 can generalize the good idea rather than preserve the broker topology:

```text
domain transaction
  + canonical financial state
  + ledger postings
  + durable outbox/job row with unique source key
COMMIT
```

A small worker then claims the durable task.

## V2 source identity model

Prefer explicit source identity at every financial boundary.

### Merchant requests

```text
merchant_id
environment
operation
idempotency_key
request_hash
resource_id
```

Unique:

```text
(merchant_id, environment, operation, idempotency_key)
```

### Provider events

```text
provider_account_id
provider_event_id or deterministic fingerprint
payload_hash
received_at
processing_state
```

Unique:

```text
(provider_account_id, provider_event_id)
```

or the explicitly approved fingerprint scope.

### Financial postings

Each ledger transaction should carry a stable source identity, conceptually:

```text
source_type
source_id
posting_type
```

Unique for posting types that can occur only once per source.

Examples:

```text
(payment_id, payment_pending)
(payment_id, payment_completed)
(refund_id, refund_completed)
(payout_id, payout_reserved)
(payout_id, payout_completed)
(provider_event_id, provider_event_application)  # where appropriate
```

Partial refunds never use amount as the unique identity.

## V2 concurrency contracts

Required fail-first tests include:

1. two concurrent Pix creates with one idempotency key create exactly one payment/provider attempt;
2. two concurrent requests with the same unique merchant `external_id` cannot create duplicate business references if that uniqueness is enabled;
3. duplicate provider-completed event creates one canonical transition and one ledger posting;
4. duplicate partial-refund event creates one refund application;
5. two distinct same-amount partial refunds both succeed when they have distinct refund/source IDs;
6. concurrent payout reservations cannot overspend merchant available balance;
7. duplicate payout request idempotency key creates one payout/reservation;
8. duplicate worker execution cannot acquire the same monetary execution lease concurrently;
9. every canonical financial transition and required posting/outbox record commits atomically;
10. direct writes that bypass controlled financial functions are denied by privileges/application architecture.

## Constraint migration implication

Do not mechanically port the legacy constraint set.

Preserve strong ideas:

- integer cents;
- unique merchant account identity;
- database uniqueness for one-time financial postings;
- foreign-key relationships;
- dedupe/lease patterns demonstrated by EmailIntent.

Strengthen missing areas:

- merchant request idempotency;
- provider event identity;
- provider transaction identity;
- payment/refund source posting uniqueness;
- payout request uniqueness;
- atomic balance reservation;
- financial amount checks;
- controlled ledger posting boundary.

## Phase implication

The major financial source-event/database-constraint risk is now understood well enough to define V2 contracts.

A full migration-by-migration historical archaeology is not required before starting V2 schema design unless a specific legacy compatibility question depends on an older schema state. The current production model and the known material migrations provide sufficient evidence for the target safety requirements.