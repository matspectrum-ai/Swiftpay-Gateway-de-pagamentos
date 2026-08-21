# Legacy Async Jobs, Messaging and Outbox Boundary

Status: core inventory complete; V2 async contract required before implementation

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Scope

This audit inventories the major RabbitMQ/MassTransit consumers and Hangfire recurring jobs and determines which asynchronous boundaries are fundamental to SwiftPay V2 versus legacy architectural breadth.

## Legacy topology

The legacy system declares 23 logical RabbitMQ queue names.

The management application registers 14 MassTransit consumers:

- notification created;
- merchant dashboard calculation;
- admin dashboard calculation;
- acquirer dashboard calculation;
- platform balance calculation;
- push notifications;
- bulk notifications;
- bank reconciliation;
- start-all reconciliation;
- platform-balance reconciliation;
- seller ranking;
- referral ranking;
- acquirer ranking;
- historical referral commissions.

The payment application registers 9 consumers:

- record pending ledger entry;
- payment-completed processing;
- process merchant cashout;
- send payment merchant webhook;
- send cashout merchant webhook;
- digital delivery;
- customer emails;
- process platform payout;
- process platform payout item.

This means much of the broker topology exists for dashboards, rankings, referrals, notifications and commerce features rather than the Pix-first financial spine.

## Hangfire / Valkey

Legacy management also runs Hangfire backed by Valkey/Redis with two workers.

Three recurring jobs are registered:

1. merchant automatic cashout — configured with `Cron.Minutely`;
2. platform automatic cashout — configured with `Cron.Minutely`;
3. production rankings — every five minutes.

The identifiers contain the word `hourly` for the automatic-cashout jobs, but the actual schedule is every minute.

A separate Hangfire/Valkey runtime is therefore maintained for a very small recurring-job set.

## Critical finding: database state and message publication are not atomic

The audited MassTransit publisher calls `IPublishEndpoint.Publish` directly. No MassTransit EF outbox / `UseBusOutbox` / `AddEntityFrameworkOutbox` configuration was found.

This creates dual-write windows between PostgreSQL and RabbitMQ.

### Provider payment webhook

The payment webhook path:

1. acquires a conditional state lock;
2. applies the terminal payment state;
3. saves the payment state to PostgreSQL;
4. publishes `PaymentCompleted`.

If step 4 fails, the database already contains the terminal payment state.

A later duplicate provider webhook cannot reacquire the original source state; it is treated as already processed and does not republish the missing completion event.

Consequently a payment can plausibly become `Completed` without the downstream ledger/financial/merchant-webhook work represented by `PaymentCompleted` ever running.

This is a critical state/event consistency flaw.

### Pix creation / pending ledger

Pix creation:

1. creates the external Pix charge;
2. persists Payment + PaymentPix;
3. publishes a separate `RecordLedgerPending` message.

If publication fails after persistence, the outer service returns an error even though both an external Pix charge and local Payment may already exist. The pending ledger posting is not guaranteed to exist atomically with the payment record.

V2 should not make creation of the canonical financial posting depend on a best-effort broker publish after the payment commit.

### Cashout execution

Cashout creation reserves merchant funds and commits payout/ledger state before publishing the process-cashout message.

That ordering correctly prevents an external transfer from running before reservation, but without an outbox a publication failure can strand the payout in a local processing state with funds blocked and no guaranteed worker task.

The V2 payout reservation transaction must create its execution task/outbox event in the same PostgreSQL transaction.

## V2 classification

### Must remain synchronous/transactional

These operations belong in the same trusted database transaction rather than separate broker consumers:

- canonical payment state transition plus required ledger posting;
- payout reservation plus blocked-balance posting;
- refund reservation/accounting transition where the contract requires it;
- source-event idempotency acquisition;
- creation of durable outbox/recovery records.

A financial state is not committed as complete if its mandatory ledger consequence is only an uncommitted future message.

### Must be durable asynchronous work

A small worker/outbox boundary is justified for:

- provider Pix-out execution after funds are reserved;
- provider refund execution if retained;
- ambiguous provider-result recovery/status polling;
- outgoing merchant webhook delivery/retries;
- email/notification delivery;
- external integrations/automations;
- scheduled/internal and provider reconciliation;
- conversion/analytics projections where eventual consistency is acceptable.

### Remove or defer from initial V2

Do not recreate dedicated broker consumers for:

- seller ranking;
- referral ranking;
- acquirer ranking;
- historical referral commissions;
- legacy dashboard-cache pipelines;
- bulk push-notification infrastructure;
- digital-product delivery unless that commerce capability is explicitly activated;
- platform-payout fan-out until the platform-payout product/fund-flow contract is approved.

## Recommended first-release topology

The audit does not justify RabbitMQ + MassTransit + Hangfire + Valkey for the first Pix-only release.

A smaller topology is sufficient:

```text
SwiftPay API
    |
    | same PostgreSQL transaction
    v
PostgreSQL
├── domain state
├── ledger
├── idempotency/source events
└── outbox/jobs
        |
        v
   SwiftPay Worker
   ├── provider execution/recovery
   ├── merchant webhooks
   ├── email/integrations
   └── reconciliation/scheduled work
```

PostgreSQL can initially be the durable queue coordination substrate. A worker can claim work atomically with `FOR UPDATE SKIP LOCKED` or equivalent database functions. A dedicated broker should be introduced only when measured throughput/topology requirements justify it.

## Minimal outbox contract

A first-release durable outbox/job model should record at least:

- id;
- event/job type;
- aggregate/source id;
- idempotency/source key;
- payload or immutable payload reference;
- state (`pending`, `processing`, `succeeded`, `retry_scheduled`, `dead_letter`);
- attempt count;
- `available_at`;
- lease/lock token and expiration;
- last error class/code;
- created/processed timestamps.

The domain transaction creates the outbox row before commit.

Worker requirements:

1. atomic claim;
2. bounded retry policy;
3. idempotent handler;
4. expired-lease recovery;
5. observability of pending/retrying/dead-letter work;
6. no implicit transport retry for monetary provider POSTs;
7. unknown-result state for ambiguous external monetary operations.

## Merchant webhook distinction

Merchant webhook delivery deserves first-class event/delivery records rather than being represented only by a generic outbox row.

The outbox may trigger delivery work, while `webhook_events` and `webhook_deliveries` preserve stable logical event identity, signed payload, attempt history and manual redelivery semantics.

## Scheduled work

Recurring work does not justify Hangfire by itself.

V2 can initially use one scheduling mechanism associated with the worker/PostgreSQL environment for:

- provider recovery;
- reconciliation;
- cleanup/retention;
- later automation schedules.

Automatic cashout is deferred until its product/risk contract is approved. Ranking is not a financial-core scheduler concern.

## V2 invariants

1. Every committed financial transition has its required ledger consequence in the same transaction.
2. Any required post-commit asynchronous action is durably recorded in the same transaction.
3. A broker/worker outage cannot silently lose a required financial side effect.
4. Duplicate worker execution is safe by contract and database uniqueness/idempotency.
5. Monetary provider POSTs are never blindly retried after ambiguous transport failure.
6. Eventual-consistency consumers cannot define the canonical financial truth.
7. Queue infrastructure is introduced for measured need, not inherited topology.

## Reconstruction implication

The V2 does need asynchronous execution, but it does not currently need the legacy asynchronous stack.

The first release can reduce four infrastructure concepts — RabbitMQ, MassTransit, Hangfire and Valkey-backed job scheduling — to one durable PostgreSQL outbox/job boundary plus a small worker, while making state/event consistency materially stronger.