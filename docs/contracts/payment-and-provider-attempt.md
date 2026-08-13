# SwiftPay V2 — Payment, ProviderAttempt and Create Idempotency Contract

Status: Phase 1 foundational contract; ready for fail-first schema/application tests

Date: 2026-08-13

## Purpose

Define the canonical Pix payment lifecycle independently from provider transport details.

This contract is intentionally shaped by the legacy failure modes already audited:

- request retries can create duplicate provider charges;
- transport timeout is not proof of provider failure;
- mutable payment state is not provider-event identity;
- provider webhooks can be duplicated or out of order;
- one logical SwiftPay payment must not become several provider charges accidentally;
- refund state must not corrupt the payment collection state machine.

## Core objects

SwiftPay V2 separates three identities that legacy code partially conflates:

```text
Payment
    merchant-facing logical money-collection resource

ProviderAttempt
    one concrete attempt to create/recover a charge at one provider account

RequestIdempotency
    one merchant HTTP/business operation retry identity
```

A fourth object, `ProviderEvent`, represents authenticated external evidence and is specified at the provider/webhook boundary.

## Payment is the canonical merchant resource

A Payment represents one merchant intent to collect one BRL amount.

Minimum immutable/snapshot fields at creation:

```text
id
merchant_id
environment
amount_cents
currency = BRL
external_id?                 # merchant business reference
source                       # api | checkout | payment_link | quick_pix
source_resource_id?          # checkout/link when applicable
description?
customer reference/snapshot as approved
pricing_rule/version
merchant_fee_cents
merchant_net_cents
provider route policy/version
created_at
```

Provider-specific secrets, raw provider credentials and provider cost details are not merchant-visible fields.

## Canonical collection status

Initial internal Payment collection states:

```text
creating
pending
paid
expired
failed
cancelled
```

Meanings:

### `creating`

The SwiftPay Payment exists, but the system does not yet have sufficient external evidence to say that a usable provider charge was created or definitively rejected.

This includes the important case where a provider create request has an ambiguous result.

### `pending`

A concrete Pix charge is known to exist and is awaiting payment.

SwiftPay has enough durable provider identity/charge data to expose the QR/copy-paste payload or recover it deterministically.

### `paid`

Authenticated provider evidence proves that the Pix was paid.

`paid` is absorbing for the collection lifecycle. Refunds do not move the collection state backward; they are separate resources/financial events.

### `expired`

The known charge expired without observed payment.

`expired` is not allowed to override later authoritative provider proof. A later authenticated provider `paid` event may transition:

```text
expired -> paid
```

because external money truth outranks a local expiration assumption.

### `failed`

SwiftPay has definitive evidence that payment creation/collection cannot proceed and that the active provider attempt cannot later become a successful charge without a new explicit attempt.

A timeout, connection reset, provider 5xx or lost response is **not** sufficient evidence for `failed` unless the retained provider contract explicitly proves otherwise.

### `cancelled`

An explicit cancellation occurred under a supported contract before payment completion.

First release does not require merchant self-service Pix cancellation merely because the state exists.

## Allowed collection transitions

Minimum allowed graph:

```text
creating
  -> pending
  -> paid
  -> expired        # recovered provider charge already expired
  -> failed         # only definitive failure
  -> cancelled      # only explicit supported cancellation

pending
  -> paid
  -> expired
  -> cancelled      # only when provider/business contract supports it

expired
  -> paid           # late authoritative provider proof

paid
  -> paid           # duplicate event is absorbed, no new financial effect

failed
  -> failed

cancelled
  -> cancelled
  -> paid           # only if provider later proves external money movement occurred
```

Forbidden examples:

```text
paid -> pending
paid -> expired
paid -> failed
expired -> pending because of a stale event
failed -> creating by background retry
```

A new provider attempt after a definitive failure is an explicit application operation/policy decision, not an implicit status rewind.

## Refund projection

Refunds are first-class resources and do not own the payment collection state.

Internal Payment stores/derives at least:

```text
refunded_amount_cents
```

Merchant-facing compatibility status may be projected as:

```text
collection_status = paid, refunded_amount = 0
    -> paid

collection_status = paid, 0 < refunded_amount < amount
    -> partially_refunded

collection_status = paid, refunded_amount == refundable/original amount
    -> refunded
```

The canonical collection state remains `paid`.

This removes the legacy defect where moving Payment into `PartiallyRefunded` prevents later partial/final refund transitions.

## ProviderAttempt

A ProviderAttempt represents exactly one externally executable provider charge-creation attempt.

Minimum fields:

```text
id
payment_id
provider_id
provider_account_id
operation = create_pix_charge
attempt_number
state
client_reference             # stable SwiftPay reference sent to provider when possible
request_fingerprint
provider_payment_id?
provider_txid?
provider_status_raw?
qr_payload/copy_paste?        # sensitive classification to be defined
expires_at?
started_at?
finished_at?
last_error_class?
last_error_code?
recovery_required_at?
created_at
updated_at
```

Raw secrets are never persisted in the attempt.

Raw provider request/response evidence, if retained, must be separately protected/redacted and must not become the merchant response model.

## ProviderAttempt execution state

Initial states:

```text
prepared
executing
succeeded
definitively_failed
execution_unknown
```

### `prepared`

The attempt exists durably and has not yet acquired the network-execution claim.

### `executing`

A worker/request handler has atomically claimed the attempt and may issue the provider monetary/create request.

The claim must include a lease/execution token or equivalent concurrency control so two workers cannot both own the same execution.

### `succeeded`

Provider charge existence is proven and stable provider identity/charge data has been persisted.

Payment can become `pending` or `paid`, depending on the evidence.

### `definitively_failed`

There is explicit evidence that this provider attempt did not create a charge and cannot later resolve as the same successful execution.

Only this state permits routing policy to consider a different ProviderAttempt automatically.

### `execution_unknown`

SwiftPay issued or may have issued the provider request, but cannot prove whether the provider accepted it.

Examples:

- timeout after request transmission;
- connection reset after request transmission;
- process crash after provider acceptance but before local persistence;
- provider 5xx where provider contract does not guarantee no side effect.

`execution_unknown` is not failure.

No second provider charge attempt is created while the first attempt remains unknown unless the provider contract offers a proven idempotent replay primitive that resolves to the same external operation.

## External-call claim rule

Before a provider create request is sent, SwiftPay must atomically claim the attempt.

Conceptually:

```text
prepared
  -- CAS/lease --> executing
```

Only the owner of the current execution token may issue the network request.

If the process crashes while `executing`, lease recovery does **not** blindly send the POST again. The operation first becomes/re-enters recovery assessment and uses provider idempotency/query/webhook evidence.

## Provider client reference

Every retained provider must be given the strongest stable SwiftPay-controlled reference it supports.

Preferred reference:

```text
provider_client_reference = provider_attempt.id
```

or a deterministic encoded equivalent within provider format limits.

Provider retention for create-Pix requires answering:

1. Can SwiftPay send a stable external/client reference?
2. Can the provider dedupe creation by that reference?
3. Can SwiftPay query/recover by that reference after timeout?
4. Does the provider expose a stable provider payment ID/TxId?
5. Which of those identities are unique per provider account vs globally?

A provider without safe unknown-result recovery may still be usable only if its risk is explicitly accepted; it cannot silently use retry-on-timeout.

## At most one unresolved create attempt per Payment

Database policy must prevent multiple simultaneously executable/ambiguous create attempts for the same Payment.

Conceptual invariant:

```text
for one payment:
count(provider_attempt where state in (prepared, executing, execution_unknown)) <= 1
```

A new attempt can be created after `definitively_failed` only when routing/fallback policy explicitly allows it.

First-release default should be deterministic routing with no speculative provider fan-out.

## RequestIdempotency

Money-creating public operations use a first-class idempotency record.

Minimum fields:

```text
id
merchant_id
environment
operation                    # create_payment, create_payout, ...
idempotency_key
request_hash
state                        # in_progress | completed | failed
resource_type
resource_id?
http_status_snapshot?
response_snapshot?
created_at
completed_at?
expires_at/retention policy
```

Database uniqueness:

```text
UNIQUE (merchant_id, environment, operation, idempotency_key)
```

## Canonical request hash

Idempotency compares a canonical representation of fields that define the operation.

For create Payment this includes at least:

```text
amount
currency
source
external_id
customer fields/reference that affect execution
Pix expiration
callback/webhook selection when part of create semantics
metadata only if contract declares it operation-defining
```

Serialization order, irrelevant whitespace and transport-only headers must not change the hash.

The exact canonicalization function is versioned/tested.

## Idempotency behavior

### First request

Inside one PostgreSQL transaction:

```text
claim RequestIdempotency
create Payment(status=creating)
create ProviderAttempt(state=prepared)
link idempotency -> Payment
COMMIT
```

No provider call occurs before this durable identity exists.

### Same key + same request

Never create a second Payment or ProviderAttempt.

Behavior depends on the original operation state:

```text
completed -> replay the approved creation response snapshot/reference
in_progress -> return the same Payment/operation state; do not re-execute blindly
failed -> replay the same deterministic terminal operation failure unless retry policy explicitly defines otherwise
```

### Same key + different request

Return deterministic conflict:

```text
idempotency_key_reused
```

No new resource/side effect.

## Create-Pix synchronous happy path

SwiftPay may keep the merchant-friendly synchronous create experience without sacrificing durability.

Recommended flow:

```text
HTTP create
  |
  | DB TX
  |-- idempotency claim
  |-- Payment creating
  |-- ProviderAttempt prepared
  | COMMIT
  |
  | atomic attempt claim -> executing
  |
  | provider create call
  |
  | success
  | DB TX
  |-- attempt succeeded + provider identity/QR
  |-- Payment pending (or paid if provider evidence says paid)
  |-- creation response snapshot
  |-- required outbox/event rows
  | COMMIT
  |
  -> HTTP 201
```

The external call is outside the DB transaction, but is surrounded by durable pre-call identity and explicit post-call recovery state.

## Ambiguous create result

If the network outcome is ambiguous:

```text
ProviderAttempt -> execution_unknown
Payment         -> creating
```

The API returns/replays the same logical operation, not a new provider call.

The exact public HTTP status belongs to the public API contract; a `202`-style “creation/recovery in progress” response is preferable to telling clients a definitive failure when SwiftPay does not know.

Recovery sources, in order of strength, may include:

1. provider query by stable SwiftPay/client reference;
2. provider query by known provider ID/TxId;
3. authenticated provider webhook;
4. provider reconciliation/API/support evidence;
5. manual operational recovery as last resort.

## Crash after provider success

Critical scenario:

```text
provider creates Pix
-> SwiftPay process dies before local success persistence
```

On lease recovery:

- do not automatically issue a new create request;
- mark/interpret the attempt as potentially unknown;
- query/recover the provider operation by stable reference;
- if provider existence is proven, persist the same attempt as `succeeded` and Payment as `pending/paid`;
- only issue a new attempt after provider-specific proof that no prior charge exists.

## Provider webhook transition rule

Authenticated provider events are external evidence, not commands to assign arbitrary status strings.

Processing:

```text
persist/claim ProviderEvent identity
normalize event
locate exact ProviderAttempt/Payment by scoped provider identity
validate allowed transition
apply Payment transition + required ledger posting + outbox in one DB transaction
mark event applied/absorbed
```

Duplicate event:

```text
same source event -> no second transition/posting
```

Stale event:

```text
absorbed/recorded -> cannot move canonical truth backward
```

## Late payment after expiration

If SwiftPay has marked a Payment expired but the provider later proves actual Pix settlement:

```text
expired -> paid
```

Payment completion and ledger settlement occur exactly once using source identity.

A stale provider `pending`/`expired` event received after `paid` is recorded but cannot reverse payment/ledger truth.

## QR/Pix payload ownership

QR/copy-paste/TxId are evidence/output of a concrete ProviderAttempt, even when exposed through the Payment API.

They must not be fields that can silently migrate from one provider attempt to another without traceability.

Payment API projections may expose the active/succeeded attempt's normalized Pix data while keeping provider identity invisible.

## Failure taxonomy

Provider execution failures must be classified before they affect Payment state:

```text
validation/configuration failure before call
explicit provider rejection
provider unavailable before transmission when provable
ambiguous transport result
internal persistence failure
internal recovery failure
```

Internal application/DB failure is never evidence that the provider rejected a charge.

Raw provider strings are operational diagnostics, not canonical status semantics.

## Required database constraints

Initial schema target:

1. unique RequestIdempotency key scope;
2. positive Payment amount;
3. BRL-only check for initial release;
4. provider attempt belongs to one Payment/provider account;
5. provider attempt number unique per Payment;
6. at most one unresolved/executable create attempt per Payment;
7. scoped provider payment/reference uniqueness where provider contract guarantees it;
8. immutable Payment monetary/pricing snapshots after creation;
9. canonical state mutations only through trusted server/database functions where financial effects occur;
10. provider events have unique stable identity/fingerprint scope.

## Public API projection

Initial Pix create response can continue to expose familiar merchant fields:

```text
id
externalId
method = pix
amount
fee
netAmount
currency
status
description
environment
expiresAt
createdAt
customerId?
pix.txId?
pix.qrCode?
pix.copyAndPaste?
pix.expiresAt?
```

Do not expose:

- provider name/account;
- provider secret/config;
- provider cost;
- internal attempt lease/error diagnostics;
- provider routing policy internals.

If Payment is still `creating` because provider execution is unknown, the response must clearly communicate that no second create should be attempted with a different key merely to work around uncertainty.

## Required fail-first tests

### Request idempotency

1. Two concurrent identical requests with one idempotency key create one Payment and one initial ProviderAttempt.
2. Same key + same canonical request returns the same Payment/resource.
3. Same key + different request returns `idempotency_key_reused` and creates nothing new.
4. Client `external_id` does not substitute for request idempotency.

### Provider execution claim

5. Two concurrent workers/handlers cannot both transition the same attempt `prepared -> executing` with valid ownership.
6. A crashed execution lease does not cause blind provider POST retry.
7. A provider timeout transitions to `execution_unknown`, not `definitively_failed`.
8. While an attempt is `execution_unknown`, automatic fallback cannot create another provider charge.

### Recovery

9. Provider success + local crash is recovered into the same ProviderAttempt/Payment using stable provider/client identity.
10. Query proving no prior charge allows an explicitly approved subsequent attempt.
11. Provider webhook can resolve an unknown attempt without a second create call.

### Payment state

12. Duplicate paid webhook settles Payment/ledger exactly once.
13. `paid -> pending/expired/failed` is rejected/absorbed.
14. `expired -> paid` is accepted when authoritative provider evidence proves settlement.
15. Refund creation/application never rewinds collection state from `paid`.
16. Two equal-value distinct refunds remain distinguishable by refund/source ID.

### Scope/security

17. Merchant A idempotency key/resource cannot collide with or reveal Merchant B.
18. Sandbox and Production idempotency/provider identities cannot cross environments.
19. Provider ID uniqueness is enforced only in its documented provider-account scope.
20. Public Payment serialization does not leak provider routing/cost/secrets.

## Phase-2 schema implications

The first Supabase/PostgreSQL migration set should be able to represent at least:

```text
payments
provider_attempts
request_idempotency
provider_events
```

before implementing the create-Pix vertical slice.

The exact physical schema can evolve, but these semantic identities must not collapse into one table/status field.

## Open items that do not block this contract

- exact first retained provider;
- provider-specific client-reference field names;
- whether a second provider is enabled for deterministic fallback in release 1;
- exact public HTTP status used while create recovery is unresolved;
- exact retention window for idempotency response snapshots;
- final refund contract;
- exact chart of accounts/fee posting rules.

None of these justify reverting to blind retries, mutable-status dedupe or provider-identity ambiguity.