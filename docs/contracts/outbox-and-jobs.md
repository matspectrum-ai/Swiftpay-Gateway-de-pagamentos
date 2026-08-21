# SwiftPay V2 — Transactional Outbox and Durable Jobs

Status: Phase 1 foundational contract; ready for fail-first PostgreSQL tests

Date: 2026-08-13

## Purpose

Make required post-commit work durable without inheriting RabbitMQ, MassTransit, Hangfire or Valkey as first-release dependencies.

The baseline is PostgreSQL + a small SwiftPay worker.

## Atomic enqueue rule

When a canonical domain transition requires later work, the durable job is inserted in the same database transaction:

```text
BEGIN
  canonical state transition
  ledger posting when applicable
  durable job/outbox row
COMMIT
```

This pattern is forbidden for required effects:

```text
commit DB
then enqueue/publish
```

because a crash between those steps loses work.

## Delivery semantics

Worker delivery is at-least-once.

Business effects become effectively exactly-once through stable source identity and destination idempotency. A job retry must never be assumed harmless merely because the queue row is durable.

Monetary provider calls obey `payment-and-provider-attempt.md` and `native-pix-provider-adapter.md`; lease expiry never authorizes a blind second Pix/payout/refund POST.

## Durable job model

Minimum fields:

```text
id
kind
source_type
source_id
dedupe_key
payload_version
payload_json
state              # pending | leased | completed | dead
attempt_count
max_attempts
next_attempt_at
lease_token?
lease_expires_at?
last_started_at?
last_finished_at?
last_error_class?
last_error_code?
created_at
updated_at
completed_at?
```

Payloads contain versioned execution data or canonical resource references, never secrets or arbitrary ORM snapshots.

## Dedupe

A one-time logical effect has a unique durable key.

Examples:

```text
payment:<id>:settlement-release
provider-event:<id>:apply
payment:<id>:merchant-webhook:paid
payout:<id>:execute
refund:<id>:execute
webhook-delivery:<id>:run
```

Concurrent creation of the same logical job produces one durable job.

## Claim and lease

Workers claim due jobs atomically using PostgreSQL locking, conceptually:

```sql
SELECT id
FROM durable_jobs
WHERE state = 'pending'
  AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at
FOR UPDATE SKIP LOCKED
LIMIT :batch;
```

The same short transaction marks selected rows:

```text
state = leased
lease_token = random unique token
lease_expires_at = now + lease_duration
attempt_count += 1
last_started_at = now
```

Only the current `lease_token` can complete or reschedule that claim.

Two workers cannot simultaneously own one valid lease.

## Expired lease

An expired lease means only that local ownership was lost. It does not prove an external side effect failed.

Recovery is handler-specific:

```text
merchant webhook
  -> retry same durable delivery identity

provider Pix create/payout/refund
  -> recover ProviderAttempt/external outcome first; never blind replay

internal recomputation
  -> rerun when the operation contract is idempotent
```

## Completion

Only:

```text
leased + matching lease_token
```

may transition to `completed`.

If canonical state already proves the effect was applied, the handler may idempotently complete without applying it again.

## Failure classification

Handlers return structured failure classes:

```text
transient
rate_limited
configuration
validation
external_unknown
permanent
internal
```

Retryable work becomes `pending` with a bounded `next_attempt_at` backoff. The lease is cleared.

There is no invisible HTTP/framework retry underneath durable attempt accounting for side-effecting POSTs. One `attempt_count` increment corresponds to one handler execution claim.

When retries are exhausted or the failure is permanent, state becomes `dead`. Dead jobs remain visible with source identity and error evidence for explicit operational recovery.

## First vertical-slice job kinds

```text
provider_charge_execution
provider_charge_recovery
provider_event_application
settlement_release
merchant_webhook_delivery
reconciliation_check
```

Later additions can include payout/refund execution/recovery and integration deliveries.

Do not create one infrastructure product or queue per feature without measured need.

## Provider event intake

Provider webhook processing first authenticates the raw request, then durably claims source identity.

Preferred asynchronous pattern:

```text
BEGIN
  insert/claim ProviderEvent
  insert provider_event_application job
COMMIT
```

Duplicate provider events reuse the same source identity/job and cannot generate a second ledger effect.

If a provider requires synchronous acknowledgement only after application, the same source-idempotency rules still apply; durability cannot depend on in-memory handling.

## Merchant webhook deliveries

The merchant business event and delivery row exist before network sending.

A retry references the same `webhook_delivery_id`. Worker crash/redelivery cannot generate a new logical event merely because the previous local attempt did not finish its bookkeeping.

## Recurring work

First release does not require Hangfire.

A scheduler/tick may insert due jobs using deterministic schedule keys. Multiple replicas must be safe because insertion is database-idempotent.

Examples:

```text
reconciliation:<provider-account>:<window>
settlement-release:<payment>:<due-at>
```

## Ordering

Global FIFO is not assumed.

Per-resource correctness uses canonical state transitions, source idempotency and, where needed, row/advisory locks or version compare-and-set.

Unrelated merchants/payments do not require global serialization.

## Payload evolution

Every job kind has a payload schema version. A worker must explicitly support or reject/migrate the stored version. Deployments cannot assume all pending jobs were created by the newest binary.

## Security

Browser/dashboard roles cannot insert arbitrary job kinds, claim leases or mutate worker state directly.

Only trusted SwiftPay API/worker/database functions may create approved jobs and execute claims.

## Observability

Every execution is traceable by:

```text
job_id
kind
source identity
attempt number
lease/correlation identity
start/end timestamps
outcome/error class
next retry time
```

Operational metrics include due depth, oldest due age, lease expirations, retries, dead jobs and latency by kind.

## Fail-first tests

1. domain rollback also removes its required job;
2. committed domain transition always leaves required work durable;
3. two workers cannot claim the same job;
4. stale lease token cannot complete a newer lease;
5. expired lease can be reclaimed by exactly one worker;
6. concurrent duplicate enqueue with one dedupe key creates one logical job;
7. one handler claim increments attempt count once;
8. handler failure never loses the job;
9. dead state preserves source/error/attempt evidence;
10. two scheduler replicas create one logical recurring job;
11. retry after worker crash cannot duplicate an already-applied canonical financial effect;
12. merchant webhook retry reuses one delivery identity;
13. provider monetary execution lease expiry does not send a blind second POST;
14. provider-event redelivery cannot create a second financial posting;
15. unsupported payload version fails deterministically rather than being misread.

## Escalation rule

PostgreSQL outbox/jobs remains the baseline until measured evidence shows a need for dedicated broker/scheduler infrastructure, such as throughput ceiling, very high fan-out, cross-region stream topology or specialized retention/replay.

Even if a broker is introduced later, PostgreSQL transactional source identity/outbox remains the durability boundary.