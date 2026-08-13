# Legacy SwiftPay — Cashout / Pix-out Audit

Status: Core public contract, creation/reservation, approval/cancel, processing consumer and provider execution boundary audited. Provider-specific payout clients/webhooks remain part of the retained-provider audit.

Legacy source: `SwiftPay-Prod/swiftpay---Prod`

## Scope reviewed

- `EndpointsGroups/CashoutGroup.cs`
- `Endpoints/Cashouts/Create/*`
- `Endpoints/Cashouts/Get/*`
- `Endpoints/Cashouts/Cancel/*`
- cashout list/create/get/approve/reject/cancel/simulate paths in `CashoutService.cs`
- `Consumers/ProcessCashoutConsumer.cs`
- `Services/WithdrawService.cs`
- `Utils/FeeCalculator.cs` payout calculations
- provider registration/resilience in `ServiceCollectionExtensions.cs` and `HttpClientResilienceExtensions.cs`
- MassTransit consumer registration and shared RabbitMQ extension
- payout ledger behavior documented in `financial-ledger.md`

## Public cashout routes

Base:

```text
/v1/cashouts
```

Observed public capabilities:

```text
POST /v1/cashouts
GET  /v1/cashouts
GET  /v1/cashouts/{id}
POST /v1/cashouts/{id}/cancel
POST .../simulate          # sandbox simulation surface exists
```

The group uses the same merchant POST rate-limit preprocessor as transactions.

## Create request

Legacy public request:

```text
amount
payoutAccountId?       # saved payout destination
pixKeyType?            # inline destination alternative
pixKey?                # inline destination alternative
externalId?
callbackUrl?
```

Rules:

- amount > 0 and <= R$ 1,000,000.00;
- either payout account OR inline Pix key/type;
- cannot provide both payout account and inline Pix key;
- Pix key types: CPF, CNPJ, Email, Phone, Random;
- external ID max 100;
- callback URL must be absolute HTTP/HTTPS.

Response includes:

```text
id
externalId
amount
fee
netAmount
currency=BRL
status
environment
pix key type/key/E2E
requested/processed/completed timestamps
failure reason
created timestamp
```

Public mappers mask Pix keys in read/list flows where applicable.

## Public external ID is not idempotency

As documented in `financial-ledger.md`, `ExternalId` is stored but the reviewed creation path does not use it as a DB-enforced uniqueness/idempotency gate.

V2 must separate:

```text
external_id      = merchant business reference
idempotency_key  = operation retry identity
```

Payout reservation must require a stable, database-enforced operation identity.

## Creation state machine

Legacy creates/reserves financial state before external execution.

### Manual approval

```text
create
 -> Payout.Pending
 -> funds Available -> Blocked
 -> wait for admin approval
 -> approve
 -> Payout.Processing
 -> publish ProcessCashout message
```

### Automatic approval

```text
create
 -> reserve funds
 -> immediately Payout.Processing
 -> publish ProcessCashout message
```

This high-level ordering is correct: funds are blocked before provider Pix-out execution.

## Cancellation/rejection boundary

Merchant cancellation and admin rejection are allowed only when:

```text
Payout.Status == Pending
```

They then reverse the reservation:

```text
MerchantBlocked   DEBIT amount
MerchantAvailable CREDIT amount
```

Once payout status is `Processing`, ordinary merchant cancel/reject is no longer allowed.

This boundary is valuable and should be preserved: after external execution may have started, local cancellation cannot safely assume the provider transfer did not happen.

## Provider processing path

`ProcessCashoutConsumer` loads the payout and requires:

```text
status == Processing
environment != Sandbox
valid Pix destination
valid MerchantAcquirer / Acquirer
```

It computes provider transfer amount using:

```text
payout.NetAmount
payout.AcquirerFee
Acquirer.PayoutFeeHandling
```

and calls:

```text
WithdrawService.ProcessWithdrawAsync(...)
```

Provider result maps to:

```text
Completed
Processing
Cancelled
Failed
```

A terminal result first attempts a database compare-and-set lock:

```text
Processing -> Confirming
```

before terminal local processing.

This conditional state transition is a good concurrency primitive.

## Critical unknown-result flaw

### Actual error semantics

`WithdrawService.ProcessWithdrawAsync` wraps the entire provider execution in `try/catch`.

Any exception, including an HTTP/network timeout or connection failure, becomes:

```text
Success = false
Status  = Failed
Error   = "Erro interno ao processar saque."
```

The exception is not propagated as an indeterminate external result.

`ProcessCashoutConsumer` then handles `Failed` by:

1. marking payout failed;
2. reversing `MerchantBlocked -> MerchantAvailable`;
3. notifying merchant;
4. potentially sending failed merchant webhook.

### Why this is unsafe for money movement

For an external POST:

```text
SwiftPay sends Pix-out request
 -> provider commits transfer
 -> network response is lost / timeout occurs
```

SwiftPay observes only an exception. The current abstraction maps it to definitive failure even though the external operation may have succeeded.

The merchant funds are then returned to available balance.

A new payout can spend those funds again while the first provider transfer may already be in flight/completed.

### Classification

This is a **confirmed semantic flaw in unknown-result handling** in the reviewed execution boundary.

Whether a specific provider makes the scenario harmless depends on that provider's idempotency/correlation/recovery contract. The generic SwiftPay layer itself does not preserve an indeterminate state.

## V2 required state

External money movement needs an internal state equivalent to:

```text
execution_unknown
recovery_required
```

Exact public naming can differ.

When provider outcome is unknown:

- merchant funds remain blocked;
- payout is not marked failed;
- automatic retry is forbidden unless provider idempotency guarantees are proven;
- system queries provider by stable client/provider reference when possible;
- provider webhook can resolve the outcome;
- reconciliation/manual operations can resolve terminal status;
- a timeout alone never releases funds.

Required fail-first scenario:

```text
Given available 10000 and payout 8000
When provider accepts the Pix-out but SwiftPay times out before reading response
Then payout becomes recovery-required/unknown
And available remains 2000
And blocked remains 8000
And no second transfer is automatically created
When later provider status/webhook confirms success
Then the same payout settles exactly once
```

## Automatic HTTP retry risk on payout POSTs

The shared `AddAcquirerHttpClient` resilience policy applies retries based on status/exception, not HTTP method.

It retries:

- provider 5xx;
- `HttpRequestException`;
- timeout rejection.

with up to 3 retry attempts after the initial transport execution.

Current provider client registration uses this shared policy for 10 provider clients:

- ActivePayments
- Bankizi
- IHubBanking
- Rapdyn
- Coldfy
- Pluggou
- HunterPay
- HeartPay
- Accithus
- MagicPay

AkkadPag and FlevoPay are registered with plain typed `HttpClient` in the reviewed configuration.

Because the resilience handler is generic, a retryable failed response/exception on a provider Pix-out POST can cause another HTTP POST execution.

### Risk condition

This is safe only when the provider recognizes a stable idempotency/correlation key and guarantees duplicate requests cannot cause duplicate transfers.

Some legacy adapters do send stable payout-derived references, but provider-by-provider idempotency guarantees have not yet been established for all retained providers.

## V2 rule for external monetary POSTs

Do not put generic transport retry under:

- Pix-out;
- refund;
- any operation that can irreversibly move money;
- Pix create when duplicate creation has business impact,

unless that exact provider operation has a documented and tested idempotency guarantee.

Preferred pattern:

```text
persist stable operation id
 -> make one external attempt
 -> known terminal response: apply
 -> processing response: wait webhook/poll
 -> timeout/network ambiguity: UNKNOWN, keep funds reserved
 -> retry only through provider-specific recovery/idempotency policy
```

## Provider `Processing` is not failure

A provider can legitimately accept a payout asynchronously and return `Processing`.

Legacy `ProcessCashoutConsumer` handles generic `Processing` by preserving blocked funds and saving provider transaction identity.

This behavior is correct.

However one provider adapter already identified (`AkkadPagService`) maps its own `Processing` result inconsistently by setting `Success=false` even though status is processing-like. The consumer switches on status rather than `Success`, limiting impact there, but V2 provider contracts should avoid contradictory result fields entirely.

Candidate V2 result:

```text
accepted_processing
completed
rejected
cancelled
unknown
```

with errors separated from financial outcome.

## Terminal provider webhook behavior

The separate cashout webhook path only processes terminal statuses.

It uses conditional locking and protects settled payouts:

- if `SettlementOut` already exists, a late failed/cancelled/rejected webhook is treated as stale;
- payout remains completed rather than releasing merchant funds.

This is a useful invariant.

V2 should implement provider terminal transition + financial posting in one controlled database function/transaction.

## Sandbox model incompatibility

Legacy `CashoutService.CreateAsync` starts with:

```text
ValidateWithdrawalEnvironment(environment)
```

and rejects `Sandbox` with `sandbox_withdrawal_not_allowed`.

`CreateInternalAsync` has the same rejection.

But `SimulateAsync` requires:

```text
environment == Sandbox
```

and an existing payout record.

Therefore the reviewed normal public/internal create paths cannot produce the Sandbox payout that the simulation path expects.

This is a **confirmed reachability mismatch between creation and simulation contracts**. Existing seeded/test records may make the simulator usable in development, but the normal merchant lifecycle is inconsistent.

## V2 sandbox direction

Choose one coherent model:

### Preferred

Allow sandbox payout creation against a simulated provider/account and make it financially isolated from production.

Then:

```text
POST sandbox cashout
 -> block sandbox balance
 -> return Processing/Pending
 -> explicit simulator/test action or deterministic simulation
 -> complete/fail sandbox ledger
```

or deliberately remove payout simulation from the first V2 if payout itself is production-only.

Do not ship an endpoint that requires a state the documented creation path cannot create.

## Broker behavior

The reviewed MassTransit registration adds `ProcessCashoutConsumer` through generic endpoint configuration.

No explicit consumer retry/redelivery policy is present in the reviewed `MassTransitExtensions`/shared `RabbitMQExtensions`.

More importantly, provider exceptions are normally swallowed and converted to `WithdrawStatus.Failed`, so they do not reach MassTransit as an exception that could be retried/recovered by the broker.

V2 external-recovery behavior must be explicit rather than delegated accidentally to queue redelivery.

## V2 payout state-machine direction

Candidate internal states:

```text
requested             # funds reserved; manual approval may be pending
processing            # approved and eligible for external execution
provider_processing   # provider acknowledged asynchronously
execution_unknown     # request may have executed; do not release funds
completed
failed                 # definitive non-execution/failure
rejected               # admin/provider definitive rejection
cancelled              # only before external execution unless provider confirms cancellation
```

The external/public projection can be smaller, but internal financial states must distinguish definitive failure from unknown outcome.

## V2 creation transaction requirement

Payout creation must be one DB operation that atomically:

1. checks `(merchant, environment, idempotency_key)`;
2. validates destination reference snapshot;
3. calculates/snapshots fees/provider route;
4. conditionally debits available balance;
5. credits blocked balance;
6. creates payout;
7. inserts ledger transaction/entries;
8. commits.

No external provider call occurs before this commit.

## V2 provider-execution requirement

Execution uses the already-created payout ID as a stable external correlation/idempotency value wherever provider supports it.

Provider adapter capability metadata must declare:

- Pix-out supported;
- accepted key types;
- request amount unit;
- client idempotency support and exact key/header/body field;
- query/recovery by client reference;
- webhook support/authentication;
- async processing support;
- timeout semantics.

## Compatibility recommendation

The public `/v1/cashouts` shape is small enough to preserve for migration.

Preserve where practical:

- route family;
- cents;
- payout account or inline Pix key destination;
- `externalId` as business reference;
- callback URL concept;
- core amount/fee/net/status timestamps.

Add/clarify:

- explicit `Idempotency-Key`;
- deterministic error envelope;
- canonical status semantics for unknown/provider-processing;
- durable signed merchant webhook endpoint configuration rather than per-payout public-ID secret.

## Remaining payout audit

- full Get/List response models and error pagination envelope;
- all provider-specific payout client request/response contracts for retained providers;
- provider webhook correlation/status mapping for retained providers;
- provider idempotency guarantees;
- platform payout path;
- admin approval/rejection endpoint authorization/audit details;
- payout-account KYC/verification lifecycle;
- public OpenAPI compatibility.