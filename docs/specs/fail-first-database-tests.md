# SwiftPay V2 — Fail-First Database Test Specification

Status: Phase 1 test contract; must exist before Phase 2 financial migrations

## Objective

Turn the reconstruction contracts into executable database expectations before implementation.

The tests in this document are not optional examples. Each invariant must become an automated test before or with the migration/function that satisfies it.

## Test strategy

Use three layers:

1. **Schema/constraint tests** — prove PostgreSQL rejects impossible rows/races.
2. **Transactional command tests** — prove trusted DB/application commands are atomic and concurrency-safe.
3. **End-to-end integration tests** — prove the API/worker cannot bypass the same invariants.

Tests run against an isolated local/test PostgreSQL compatible with the Supabase project migrations.

No financial test mocks PostgreSQL semantics when the behavior under test is uniqueness, locking, transaction isolation or constraints.

## Naming

Recommended suites:

```text
db/merchant_kyc
 db/api_credentials
 db/request_idempotency
 db/payments
 db/provider_attempts
 db/provider_events
 db/ledger
 db/payouts
 db/refunds
 db/jobs
 db/merchant_webhooks
 db/environment_isolation
```

Each test name states the invariant rather than the implementation.

---

# 1. Merchant/KYC

### KYC-001 — active merchant with pending KYC cannot create Production Pix

Given:

```text
merchant.lifecycle_status = active
kyc_case.status = under_review
```

When the trusted create-Pix authorization/command runs for Production,
then it fails with the canonical KYC capability error and creates no Payment/idempotency/provider attempt rows.

### KYC-002 — approved KYC enables Production capability

Given active merchant + approved current KYC + enabled Pix policy,
create-Pix authorization can proceed.

### KYC-003 — suspension wins over KYC approval

Approved KYC + suspended merchant cannot create new Production payment/payout/refund operations.

Existing provider events/reconciliation for old resources remain processable.

### KYC-004 — foreign document cannot attach

Merchant A cannot attach a `kyc_document` owned by Merchant B to A's case even with the UUID.

### KYC-005 — submitted document is immutable

After document status is submitted/accepted, update/delete through generic paths fails. Replacement creates a new `(case,purpose,version)` row.

### KYC-006 — duplicate document version rejected

Two rows with the same case + purpose + version violate uniqueness.

### KYC-007 — final approval cannot bypass unresolved review request

Approval fails while a required review item remains open/rejected without an accepted superseding response.

---

# 2. API credentials

### CRED-001 — public key globally unique

Duplicate `public_key` insert fails.

### CRED-002 — plaintext secret not persisted

Credential persistence contains verifier only; database read paths contain no plaintext secret column/value.

### CRED-003 — revocation/version invalidation

After revoke or secret-version rotation, an older issued token fails the server-side credential/version check.

### CRED-004 — environment fixed

Sandbox credential cannot authorize Production resource creation.

### CRED-005 — challenge consumed exactly once

Two concurrent confirmations of one step-up challenge result in exactly one successful sensitive action.

---

# 3. Request idempotency

### IDEM-001 — concurrent identical create yields one operation

Run two concurrent transactions using the same:

```text
merchant
environment
operation=create_payment
idempotency_key
request_hash
```

Expected:

```text
1 request_idempotency row
1 Payment
1 initial ProviderAttempt
both callers resolve to the same resource
```

### IDEM-002 — same key different request conflicts

Same key with a different request hash returns `idempotency_key_reused` and creates no second resource.

### IDEM-003 — merchant scope independent

Merchant A and B may use the same opaque key without collision/leakage.

### IDEM-004 — environment scope independent

Same merchant/key in Sandbox and Production are distinct operations.

### IDEM-005 — external_id is not idempotency

Two different idempotency keys with the same non-unique `external_id` follow the explicit external-ID business policy; the idempotency layer itself does not conflate them.

---

# 4. Payment constraints

### PAY-001 — positive amount only

`amount_cents <= 0` rejected.

### PAY-002 — BRL-only initial release

Non-BRL canonical Payment rejected.

### PAY-003 — fee equation

Insert/update violating:

```text
merchant_fee_cents + merchant_net_cents = amount_cents
```

is rejected.

### PAY-004 — refunded total bounded

`refunded_amount_cents < 0` or `> amount_cents` rejected.

### PAY-005 — monetary snapshot immutable

After creation, ordinary update cannot modify gross amount, fee/net snapshot, pricing version or rounding policy.

### PAY-006 — paid state cannot move backwards

Attempted `paid -> pending|expired|failed` through canonical transition command is rejected/absorbed without mutation.

### PAY-007 — late authoritative payment accepted

`expired -> paid` succeeds exactly once when the source ProviderEvent is authoritative.

---

# 5. ProviderAttempt

### ATT-001 — attempt number unique per Payment

Duplicate `(payment_id, attempt_number)` rejected.

### ATT-002 — only one unresolved create attempt

Concurrent inserts/updates cannot produce two attempts for one Payment in any unresolved set:

```text
prepared | executing | execution_unknown
```

### ATT-003 — execution claim single owner

Two workers concurrently claiming one prepared attempt result in one valid execution token/owner.

### ATT-004 — stale owner cannot complete

A worker with an obsolete execution token cannot persist success/failure for an attempt reclaimed by another recovery path.

### ATT-005 — timeout does not become definitive failure

Ambiguous provider result transitions attempt to `execution_unknown`; Payment remains same logical resource and no fallback attempt is auto-created.

### ATT-006 — succeeded provider identity stable

Once succeeded, provider payment identity/QR evidence cannot silently be replaced by another attempt.

---

# 6. ProviderEvent

### EVT-001 — duplicate provider event applies once

Two inserts/processing calls with the same scoped provider event identity/fingerprint result in one applied event effect.

### EVT-002 — duplicate paid event posts ledger once

Repeated `paid` evidence creates exactly one payment-settlement posting source.

### EVT-003 — event scope includes provider account/environment

A matching textual provider event ID from another provider account/environment does not collide unless the provider contract guarantees global uniqueness.

### EVT-004 — stale event cannot rewind canonical state

Pending/expired evidence arriving after paid is recorded as absorbed/stale but creates no reverse state/ledger mutation.

---

# 7. Ledger/accounting

### LEDGER-001 — deterministic account identity

Concurrent account creation for the same logical owner/environment/type produces one account, including account identities that would previously contain nullable owner/provider dimensions.

### LEDGER-002 — entries positive

Zero/negative entry amount rejected.

### LEDGER-003 — valid direction only

Only debit/credit accepted.

### LEDGER-004 — balanced posting only

Trusted posting function rejects a transaction whose debit total differs from credit total.

### LEDGER-005 — source posting exactly once

Duplicate:

```text
environment + source_type + source_id + posting_type
```

cannot create a second ledger transaction.

### LEDGER-006 — account cache atomic

If entry insertion/posting fails, cached account balances do not change. If posting commits, entries and caches change in the same transaction.

### LEDGER-007 — cache rebuild parity

Recomputing account balance from ledger entries equals cached balance for every canonical account.

### LEDGER-008 — normal flows cannot create negative merchant available

Concurrent debit/reservation commands cannot drive Available below zero.

### LEDGER-009 — payment settlement template

One paid Payment posts exactly the approved merchant liability/revenue/provider funding entries and balances to zero debit-credit delta.

### LEDGER-010 — reserve disabled means no reserve posting

With reserve capability off, settlement creates no MerchantReserved balance and public reserved remains zero.

---

# 8. Payout reservation/execution

### PAYOUT-001 — concurrent reservation cannot overspend

Given MerchantAvailable = 10000,
run two concurrent payout reservations of 8000.

Expected:

```text
exactly one succeeds
Available = 2000
BlockedPayout = 8000
one Payout resource
one reservation posting
```

No negative balance.

### PAYOUT-002 — reservation atomic with resource/idempotency

Failure at any point rolls back payout resource, blocked funds, idempotency claim and outbox/job together.

### PAYOUT-003 — unknown result retains blocked funds

Provider timeout after possible transmission transitions to unknown/recovery and does not release blocked funds.

### PAYOUT-004 — terminal success settles once

Provider confirmation/webhook/reconciliation race yields one completed payout posting.

### PAYOUT-005 — definitive failure releases once

Only explicit definitive provider failure releases Blocked -> Available, exactly once.

### PAYOUT-006 — cancel only before external execution boundary

Pending/pre-execution payout can be cancelled; executing/unknown payout cannot be locally cancelled as if provider execution never occurred.

---

# 9. Refunds

### REF-001 — refund is first-class identity

Two separate refunds of 1000 cents on one Payment are both representable and have distinct source IDs.

### REF-002 — cumulative refundable amount concurrency

Concurrent refunds cannot reserve/confirm more than the remaining refundable principal.

### REF-003 — partial then partial

A paid Payment can receive partial refund A and B; aggregate becomes correct without state-machine dead-end.

### REF-004 — partial then final

Partial refund followed by remaining final refund reaches full refunded projection.

### REF-005 — unknown refund does not duplicate

Timeout/ambiguous result creates recovery state; no blind second provider refund request is issued.

### REF-006 — duplicate provider refund event posts once

Same provider refund/source identity cannot create a second reversal.

### REF-007 — proportional allocation has no cent drift

Many partial refunds followed by final refund allocate each refundable fee/economic component to the exact approved total.

---

# 10. Jobs/outbox

### JOB-001 — source state + job atomic

When canonical transaction commits, required outbox/job row exists in the same commit. Rollback removes both.

### JOB-002 — concurrent claims are exclusive

Multiple workers using the claim query never receive the same unexpired job lease.

### JOB-003 — expired lease reclaim

A crashed worker's expired lease can be reclaimed, incrementing durable attempt evidence without creating a duplicate logical business resource.

### JOB-004 — at-least-once job, exactly-once financial effect

The same job may execute after a crash, but unique source constraints prevent a second financial posting.

### JOB-005 — monetary POST job does not blind-retry unknown result

A provider execution job whose external result is ambiguous schedules recovery/query behavior, not another create/payout/refund POST.

---

# 11. Merchant webhooks

### WH-001 — domain transition + logical event atomic

Payment paid/ledger posting and required merchant webhook event/outbox commit atomically.

### WH-002 — duplicate source creates one event

Duplicate provider/domain source cannot create duplicate logical merchant event.

### WH-003 — delivery claims exclusive

Two workers cannot own the same active delivery lease.

### WH-004 — retry preserves event identity

Retry/manual redelivery preserves logical webhook event ID.

### WH-005 — one recorded attempt equals one HTTP execution

No nested HTTP retry can make unrecorded executions.

### WH-006 — signing secret independent from resource ID

No Payment/Payout/Refund public ID can verify as a webhook secret.

### WH-007 — environment/tenant isolation

Merchant A/Sandbox endpoint cannot receive Merchant B/Production event.

---

# 12. Sandbox isolation

### ENV-001 — Production simulation impossible

Any simulator command targeting Production fails even for administrator/operator roles.

### ENV-002 — Sandbox financial state separate

Sandbox paid/refund/payout postings never affect Production accounts/balances/analytics sources.

### ENV-003 — same simulator source applies once

Duplicate simulation event cannot double-post.

---

# 13. Reconciliation safety

### REC-001 — missing posting detected

A canonical financial source without its required ledger transaction appears as a discrepancy.

### REC-002 — cache mismatch detected

Tampered/test account cache that differs from entries is detected without automatic historical rewrite.

### REC-003 — correction append-only

Approved correction creates a new source/posting linked to discrepancy/evidence; it does not edit old ledger entries.

### REC-004 — repeated reconciliation does not duplicate correction

Same discrepancy/reconciliation rerun cannot generate duplicate compensating posting.

---

# Execution order

The first real migration/test work should proceed in this order:

```text
A. merchant + environment isolation
B. API credentials
C. request idempotency
D. Payment + ProviderAttempt + ProviderEvent
E. accounts + ledger posting
F. jobs/outbox
G. merchant webhooks
H. payout/refund reservations
I. reconciliation helpers
```

Do not implement provider network clients before A–G core invariants have executable coverage.

## Definition of Done for Phase 2 schema foundation

The schema foundation is not complete merely because migrations apply.

It is complete only when:

- migrations apply from empty database;
- all tests above that correspond to implemented scope pass;
- concurrency tests are run repeatedly and deterministically validate exactly-one outcomes;
- RLS/access tests fail closed for browser roles;
- financial posting tests prove balanced entries and source idempotency;
- teardown/recreate produces the same schema from repository files only;
- no manual dashboard/database mutation is required to make tests pass.
