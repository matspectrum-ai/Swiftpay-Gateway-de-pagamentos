# Legacy Database Idempotency and Financial Constraint Audit

Status: core financial/source-identity constraint audit complete

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Purpose

This audit distinguishes financial/idempotency behavior protected by PostgreSQL from behavior protected only by application reads/state checks.

V2 rule:

> If concurrent execution can create or move money twice, application-level `if` checks are not sufficient protection.

## Account identity and creation

### Merchant provider-bucket uniqueness

The current EF model defines a unique index across:

```text
MerchantId + AccountType + Environment + MerchantAcquirerId
```

filtered to merchant-owned accounts.

For merchant accounts whose `MerchantAcquirerId` is **non-null**, this is useful protection against duplicate provider-bucket current-balance rows.

### Nullable legacy-bucket gap

`MerchantAcquirerId` is nullable. Under ordinary PostgreSQL unique-index semantics, multiple rows containing `NULL` in the nullable indexed position do not conflict with each other.

Therefore the same index does **not** by itself prove uniqueness for legacy merchant account rows shaped like:

```text
MerchantId = X
Type = MerchantAvailable
Environment = Production
MerchantAcquirerId = NULL
```

The current model also keeps a non-unique legacy index on:

```text
MerchantId + Type + Environment
```

so there is no separate unique constraint observed for that null-bucket identity.

### Acquirer account identity gap

The inspected current EF model does not expose an equivalent unique index over:

```text
AcquirerId + AccountType + Environment
```

for `AcquirerSettlement` / `AcquirerPayoutsOut` account identity.

This is a source-model finding, not a claim about an unseen manually modified production database. Exact live index definitions can be captured at cutover if required.

### Read-then-insert race

`LedgerRepository.GetOrCreateAccountAsync` performs a query and, if no account is found, inserts a new `Account` row.

That is a classic SELECT -> INSERT race unless the database identity constraint closes it.

The same repository demonstrates a stronger pattern for `MerchantBalance`: it uses:

```sql
INSERT ... ON CONFLICT ("MerchantId", "Environment") DO NOTHING
```

and then reads the canonical row.

V2 should use deterministic database account creation rather than relying on read-before-insert.

Possible techniques include:

- non-null explicit owner dimensions;
- partial unique indexes for each account owner class;
- `NULLS NOT DISTINCT` where deliberately appropriate and supported;
- `INSERT ... ON CONFLICT` / controlled SQL functions.

The exact chart-of-accounts schema should make every live account identity unambiguous.

## Atomic balance update concept

The legacy repository does have an important strength: it updates mutable `Account.Balance` with SQL deltas inside the same database transaction that persists ledger transactions/entries.

That prevents a successful ledger write from being committed separately from its corresponding balance-cache delta inside this repository boundary.

However, the SQL update is:

```text
Balance = Balance + delta
WHERE Id = account_id
```

and does not itself enforce a conditional non-negative spendable balance such as:

```text
WHERE Balance >= required_amount
```

This is why merchant payout reservation still has a concurrency overspend risk despite atomic deltas.

## Merchant payout completion

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

This protects completion posting for one concrete merchant `Payout` ID at the database layer.

### Historical evidence that the constraint was necessary

The migration that introduced this unique index did not merely create the index.

Before creating it, the migration searched for duplicate `SettlementOut` ledger transactions for the same payout, retained one posting, reversed the duplicate account-balance effects, reversed duplicate `MerchantBalance.LifetimePayouts` impact, removed duplicate ledger entries and removed the duplicate ledger transactions.

This is strong evidence that duplicate financial completion postings had already existed in legacy data before the database uniqueness was enforced.

The lesson for V2 is not merely theoretical:

> source-level financial uniqueness must exist before concurrency/retry behavior reaches production, not after duplicated money movement needs repair.

Legacy code additionally catches the payout-completion unique-race. Database uniqueness plus graceful conflict handling is a strong pattern to preserve.

## Platform payout ledger postings

The current EF model defines unique constraints for selected platform-payout completion postings, including:

```text
PlatformPayoutItemId + PlatformPayOut operation
```

and parent-without-item `PlatformPayOut` postings.

A historical migration introduced these indexes with a creation-time cutoff so older rows would not block deployment. The current EF model expresses filters without that cutoff.

This means source history contains a schema-evolution nuance: the exact index predicate actually present in production should be read from PostgreSQL if platform-payout migration/cutover ever depends on old rows. V2 platform payout is currently deferred, so this is not a blocker for first-release schema design.

Even where the platform-payout ledger posting is unique, provider execution remains unsafe under duplicate/concurrent delivery as documented separately.

The distinction is critical:

> Ledger uniqueness after a provider POST cannot prevent the provider POST itself from happening twice.

## Payment ledger gap

`LedgerTransaction.PaymentId` has a normal index, but no equivalent database uniqueness was observed for payment source postings such as:

```text
PaymentId + payment_pending
PaymentId + payment_completed
PaymentId + full_refund
```

Legacy payment/refund idempotency therefore relies heavily on service queries such as “does a transaction already exist?” before insertion.

Those checks may reduce ordinary duplicates but are not equivalent to a unique source key under concurrent execution.

## Ledger source-identity limitation

The current `LedgerTransaction` model can associate a posting with:

- `PaymentId`;
- `PayoutId`;
- `PlatformPayoutId`;
- `PlatformPayoutItemId`;
- `Operation`;
- `Status`;
- `Amount`.

It has no first-class:

- `RefundId`;
- `ProviderEventId`;
- provider execution ID;
- merchant idempotency key;
- generic `SourceType + SourceId`.

That prevents the ledger from expressing a general rule such as:

> this exact externally authenticated source event has already produced this exact posting.

V2 must make source identity a first-class financial concept.

## Partial refund identity gap

The audited partial-refund path uses payment/operation/amount-oriented deduplication because there is no durable refund/source-event ID in the ledger model.

This can conflate two distinct partial refunds of the same amount.

V2 requires a separate refund resource/source identity and a unique posting key. Partial refund amount is financial data, never event identity.

## Payment create idempotency gap

Legacy Pix creation checks `ExternalId` with an application query before creating the Payment.

No current-model unique index was observed for:

```text
merchant_id + environment + payment.external_id
```

Therefore concurrent requests with the same merchant reference can both pass a pre-insert existence check.

Also, `ExternalId` is optional and is not a dedicated HTTP operation idempotency contract.

V2 needs a first-class create-operation idempotency model, conceptually:

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

A merchant business reference such as `external_id` remains a separate contract.

## Payout request idempotency gap

Legacy merchant payouts contain an `ExternalId`, but no unique `(merchant, environment, external_id)` payout constraint was observed in the current model.

The strong `SettlementOut` ledger constraint protects completion of a specific Payout ID. It does not prevent two separate payout rows/reservations from being created for the same retried merchant request.

V2 payout reservation must acquire request idempotency and reserve money atomically.

## Provider payment identity gap

The current Payment model contains provider/acquirer payment identifiers, but no current-model unique index for provider payment identity was observed.

The provider webhook state-lock path performs conditional updates using provider identifiers and valid source states.

Without explicit scoped uniqueness, duplicate/corrupt canonical rows can make a provider reference ambiguous.

V2 should scope provider identifiers explicitly, for example:

```text
UNIQUE(provider_account_id, provider_payment_id)
```

when that provider contract guarantees the stated scope.

Do not assume provider IDs are globally unique across accounts/environments unless documented.

## Pix TxId identity gap

No database uniqueness/index for Pix `TxId` was observed in the inspected current model.

Some webhook fallback logic searches Pix records by TxId and selects a result before attempting the payment state CAS.

If provider scope permits duplicated TxIds across accounts/environments, or corrupted data creates duplicates, lookup becomes ambiguous.

V2 needs an explicit provider-attempt/Pix identity model and the correct uniqueness scope for every retained provider.

## Provider webhook source-event gap

No first-class durable provider webhook/event table was found in the audited payment-processing boundary containing a stable key such as:

```text
provider_account_id + provider_event_id
```

Webhook idempotency is primarily inferred from mutable Payment/Payout state transitions.

Consequences include:

- no durable record of every accepted provider event;
- no stable event identity independent from current aggregate state;
- difficult ordering/replay diagnostics;
- refund events cannot be distinguished robustly when payloads reuse amount/status;
- an event whose downstream publication failed can later look “already processed” without restoring the lost effect.

V2 should persist normalized provider/source events before or atomically with canonical state transitions when a stable provider event ID exists.

When a provider has no event ID, define a documented deterministic dedupe fingerprint from authenticated immutable fields and retain the raw request hash/evidence.

## Ledger structural constraints

`LedgerEntry` contains transaction ID, account ID, Credit/Debit type, amount, timestamp and description.

The inspected EF model does not expose generic database CHECK constraints proving, for example:

```text
entry.amount > 0
spendable merchant balance >= 0
sum(debits) == sum(credits) for every ledger transaction
```

Some balancing behavior is established by application/repository posting templates rather than a generic database invariant.

Not every double-entry invariant is practical as a row-level CHECK. V2 should enforce balanced posting inside controlled PostgreSQL functions/transactions, test those functions directly and deny ordinary application roles direct ledger mutation.

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

Account-specific negative-balance rules belong in the controlled posting function because accounting accounts do not all share the same debit/credit semantics.

## A useful legacy outbox precedent: EmailIntent

The latest legacy model contains a stronger durability pattern for email intents:

- unique `DedupeKey`;
- request/envelope hashes;
- explicit state;
- materialization/publish attempt counts;
- recovery timestamps;
- lease tokens/concurrency tokens;
- recovery indexes;
- terminal-summary consistency CHECKs.

This is noteworthy because the primary payment/RabbitMQ boundary lacks a comparable transactional outbox.

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

Unique for posting types that may happen only once per source.

Examples:

```text
(payment_id, payment_pending)
(payment_id, payment_completed)
(refund_id, refund_completed)
(payout_id, payout_reserved)
(payout_id, payout_completed)
(provider_event_id, provider_event_application)
```

Partial refunds never use amount as unique identity.

## V2 concurrency contracts

Required fail-first tests include:

1. Two concurrent account creations for the same canonical account identity produce exactly one account row.
2. Two concurrent Pix creates with one idempotency key create exactly one payment/provider attempt.
3. Two concurrent requests with the same unique merchant `external_id` cannot create duplicate business references if that optional uniqueness is enabled.
4. Duplicate provider-completed event creates one canonical transition and one ledger posting.
5. Duplicate partial-refund event creates one refund application.
6. Two distinct same-amount partial refunds both succeed when they have distinct refund/source IDs.
7. Concurrent payout reservations cannot overspend merchant available balance.
8. Duplicate payout request idempotency key creates one payout/reservation.
9. Duplicate worker execution cannot acquire the same monetary execution lease concurrently.
10. Every canonical financial transition and required posting/outbox record commits atomically.
11. Direct writes that bypass controlled financial functions are denied by privileges/application architecture.
12. Source uniqueness exists before production data can accumulate duplicate financial postings; no post-hoc repair is part of the normal design.

## Constraint migration implication

Do not mechanically port the legacy constraint set.

Preserve strong ideas:

- integer cents;
- explicit account identities;
- database uniqueness for one-time financial postings;
- foreign-key relationships;
- atomic SQL balance deltas within a posting transaction;
- dedupe/lease patterns demonstrated by EmailIntent.

Strengthen missing areas:

- deterministic DB account creation;
- correct nullable-account uniqueness semantics;
- acquirer/platform account identity constraints;
- merchant request idempotency;
- provider event identity;
- provider transaction identity;
- payment/refund source posting uniqueness;
- payout request uniqueness;
- atomic conditional balance reservation;
- financial amount checks;
- controlled ledger posting boundary.

## Phase implication

The major financial source-event/database-constraint risk is understood well enough to define V2 contracts and schema tests.

A full migration-by-migration historical archaeology is not required before starting V2 schema design unless a specific compatibility/cutover question depends on an older schema state.

The known payout dedupe repair is sufficient evidence that V2 should treat database source identity as a launch invariant, not a later hardening task. Exact live PostgreSQL index definitions remain cutover evidence where an old-row compatibility question depends on them.