# Legacy SwiftPay — Public Gateway API, Authentication and Merchant Webhooks

Status: Core public gateway surface audited. Cashout models, internal API and full middleware/test inventory remain in progress.

Legacy source: `SwiftPay-Prod/swiftpay---Prod`

## Scope reviewed

Line-oriented or contract-oriented review completed for:

- `EndpointsGroups/AuthGroup.cs`
- `Endpoints/Auth/Token/TokenEndpoint.cs`
- `Endpoints/Auth/Token/TokenModels.cs`
- `Services/Internal/TokenService.cs`
- `Models/Database/Primary/MerchantApiCredential.cs`
- `Middlewares/CredentialValidationMiddleware.cs`
- `Filters/MerchantRateLimitPreProcessor.cs`
- `Services/Internal/RateLimitService.cs`
- `EndpointsGroups/TransactionsGroup.cs`
- `Endpoints/Transactions/Create/*`
- `Endpoints/Transactions/Get/*`
- `Endpoints/Transactions/List/*`
- `Endpoints/Transactions/ResendWebhook/*`
- `Mappers/TransactionMapper.cs`
- `Endpoints/Balance/Get/*`
- `Mappers/BalanceMapper.cs`
- `Services/WebhookService.cs`
- `Services/CashoutWebhookService.cs`
- `Consumers/SendWebhookConsumer.cs`
- `Extensions/HttpClientResilienceExtensions.cs`
- `Extensions/WebApplicationExtensions.cs`

## Public API shape relevant to Pix-first V2

The legacy payment API already exposes a compact gateway surface that is worth preserving where compatibility is valuable:

```text
POST /v1/auth/token
POST /v1/transactions
GET  /v1/transactions
GET  /v1/transactions/{id}
POST /v1/transactions/{id}/resend-webhook
GET  /v1/balance
```

Cashout endpoints exist separately and require a dedicated contract audit before V2 payout spec approval.

The V2 can keep these routes while replacing their implementation entirely.

---

# Authentication contract

## POST /v1/auth/token

Base group:

```text
/v1/auth
```

Endpoint:

```text
POST /v1/auth/token
```

Request:

```json
{
  "grantType": "client_credentials",
  "publicKey": "...",
  "secretKey": "..."
}
```

`grantType` only accepts `client_credentials`.

Response data:

```json
{
  "accessToken": "...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "environment": "Production"
}
```

Exact `expiresIn` is configuration-driven.

## Credential model

Legacy `MerchantApiCredential` stores:

- credential ID;
- merchant ID;
- optional display name;
- public `ClientId`;
- `ClientSecretHash`;
- environment;
- status (`Active | Inactive | Revoked`);
- `SecretVersion`;
- optional `AllowedIpRange`.

The secret itself is not present in the model; token authentication compares a SHA-256 hash of the supplied secret with the persisted hash.

Because API secrets are expected to be high-entropy generated credentials, a non-reversible verifier is conceptually correct. V2 should still define secret generation entropy and use constant-time comparison where applicable.

## Token issuance checks

Before issuing a Bearer token, legacy verifies:

1. public key exists;
2. API credential is active;
3. merchant is active;
4. per-credential token generation rate limit;
5. supplied secret hash matches;
6. request IP matches the optional allowlist.

### IP allowlist nuance

The field is named `AllowedIpRange`, but the token endpoint implementation supports only:

- comma-separated exact IP strings; or
- `*`.

No CIDR/range parsing is performed in the reviewed method.

V2 should either:

- call this an IP allowlist and support exact addresses only; or
- implement actual CIDR semantics with tests.

Do not preserve a misleading “range” name with exact-string behavior.

## JWT claims

Legacy access token contains:

- merchant ID as `NameIdentifier`;
- `credential_id`;
- `environment`;
- `secret_version`;
- JWT `jti`;
- JWT `iat`.

JWT is signed with HMAC-SHA256 and validates issuer, audience and lifetime with zero clock skew.

## Immediate credential revocation behavior

A separate `CredentialValidationMiddleware` executes on authenticated non-internal requests.

It re-reads the current credential and checks:

- credential still exists;
- credential still active;
- current `SecretVersion` equals token claim;
- merchant still active.

Therefore:

```text
credential revoked
or
secret regenerated (SecretVersion increments)
    -> previously-issued JWT becomes unusable on the next request
```

This is a useful behavior and should be preserved conceptually in V2 even if the token implementation changes.

## V2 API authentication direction

Preserve the external `client_credentials` contract unless migration analysis proves there is strong value in breaking it.

Possible V2 implementation:

```text
api_credentials
- id
- merchant_id
- public_key unique
- secret_verifier
- environment
- status
- secret_version
- ip_allowlist
- created_at
- revoked_at
```

A small server-side gateway can exchange public/secret credentials for a short-lived signed access token.

Supabase Auth is for dashboard users, not merchant machine credentials.

---

# Rate limiting

## Legacy transaction-group behavior

`/v1/transactions` registers `MerchantRateLimitPreProcessor`.

The preprocessor:

- is disabled in Development;
- applies only to authenticated requests;
- applies only to HTTP `POST`;
- emits minute/hour/day rate-limit headers;
- returns HTTP 429 when exceeded.

Therefore GET transaction/list requests are not counted by this preprocessor.

## Legacy rate-limit storage

`RateLimitService` uses process-local static `ConcurrentDictionary` counters.

Scopes:

```text
merchant + minute
merchant + hour
merchant + day
credential + auth-token-hour
```

Merchant limits are loaded from platform/merchant settings and cached in process memory for five minutes.

### Consequences

Counters:

- reset on process restart;
- are not globally coordinated across multiple API replicas;
- depend on the process handling the request.

Thus the configured limit is a per-process approximation under horizontal scaling.

## V2 direction

Do not add Redis automatically merely to copy legacy rate limiting.

Choose one of:

- edge/API-gateway managed rate limiting;
- Postgres-backed atomic quota for low/moderate scale;
- dedicated distributed limiter only when scale justifies it.

The behavior and headers can remain compatible while implementation becomes globally coherent.

---

# POST /v1/transactions

## Legacy request

The current request is generic across Pix, card and boleto.

Shared fields include:

- `method`;
- `amount` in cents;
- `currency` (`BRL` only);
- `description`;
- `externalId`;
- `customerId`;
- `callbackUrl`;
- `metadata`.

Pix-specific fields:

- `pixExpirationMinutes`;
- `customerName`;
- `customerDocument`;
- `customerEmail`;
- `customerPhone`.

Legacy Pix expiration validation is 5–1440 minutes.

Card and boleto fields exist in the same request model but are intentionally out of V2 first-release scope.

## Legacy create response

The canonical merchant response contains:

- SwiftPay transaction ID;
- external ID;
- method;
- gross amount;
- merchant-visible fee;
- merchant net amount;
- currency;
- canonical status;
- description;
- environment;
- expiration;
- creation/completion timestamps;
- optional customer/order IDs;
- Pix object.

Pix object:

```text
txId
qrCode
copyAndPaste
expiresAt
```

Provider implementation details such as provider name, provider credential, provider fee and provider-specific payment ID are not exposed by this mapper.

This is a good provider-invisibility boundary.

## External ID vs idempotency

Legacy `PixTransactionService` checks duplicate `ExternalId` for the merchant before creation when an external ID is supplied.

However:

- `ExternalId` is optional;
- no generic `Idempotency-Key` header contract was observed in the reviewed public creation endpoint;
- a retry without external ID can create a second local/provider charge;
- a provider timeout after an unknown external result needs stronger recovery than a pre-query alone.

## V2 direction

Separate two concepts:

```text
external_id       = merchant business reference, optional
idempotency_key   = operation retry identity, required/recommended and DB-enforced
```

For create Pix:

- same merchant/environment/idempotency key + same canonical request -> return original operation result;
- same key + different canonical request -> conflict;
- provider call receives stable SwiftPay reference/idempotency identity where supported;
- timeout/unknown provider result enters recoverable state instead of blindly creating another charge.

Do not rely solely on merchant `externalId` as the distributed-operation idempotency mechanism.

---

# GET /v1/transactions/{id}

Legacy query:

- requires authenticated merchant;
- scopes by payment ID + merchant;
- hides `SuppressMerchantVisibility` records;
- loads Pix/Boleto/customer detail.

Merchant detail includes:

- amount/fee/net/status;
- failure reason;
- metadata;
- callback URL;
- customer info;
- Pix txid/end-to-end/payer data;
- lifecycle timestamps.

## Provider invisibility

The mapper does not expose internal provider name/configuration/provider fee/provider payment IDs.

Preserve this.

## Synthetic customer-data cleanup

Legacy mapper can detect technical fallback contact data and hide fallback email/phone from merchant output.

This exists because provider creation logic can synthesize contact/identity inputs.

V2 should remove the upstream synthetic-data behavior rather than preserve downstream hiding machinery.

## Legacy Wayne protocol behavior

The mapper contains special `WayneProtocol` behavior that can:

- map an internally `Completed` transaction to externally `Pending`;
- override merchant-visible fee and net values using internal constants.

This is deliberate divergence between canonical internal payment state and merchant-visible state.

V2 initial decision: **do not port** this behavior unless the business owner separately proves it is required and defines its legal/accounting rationale. A payment gateway should default to one canonical merchant-visible financial truth.

---

# GET /v1/transactions

Legacy supports filters for:

- method;
- status;
- external ID;
- customer ID;
- start date;
- end date.

Results are paginated and ordered newest-first.

V2 Pix-only can drop the payment-method filter initially while retaining status/external/date pagination compatibility.

---

# GET /v1/balance

## Internal balance object

Legacy `MerchantBalanceInfo` distinguishes:

- `Available` — economic available after compensation locks across buckets;
- `WithdrawNowAvailable` — immediately withdrawable amount in the current selected provider bucket;
- `RequiresFullWithdrawalNow`;
- `Pending`;
- `Reserved` — `MerchantReserved` account;
- `Blocked` — payout-in-processing `MerchantBlocked` account;
- total and historical KPIs.

## Public mapper mismatch

The payment API `BalanceMapper` deliberately maps:

```text
availableNow = balanceInfo.WithdrawNowAvailable

response.balance.available             = availableNow
response.balance.withdrawNowAvailable  = availableNow
response.balance.pending               = balanceInfo.Pending
response.balance.reserved              = balanceInfo.Reserved
response.balance.total                 = availableNow + pending + reserved
```

It does **not** expose `balanceInfo.Blocked`.

It also does **not** use `balanceInfo.Available` for the public `Available` field.

### Documentation mismatch

The public `Reserved` field is documented as “saques em processamento”.

But the mapper assigns `balanceInfo.Reserved`, which is the `MerchantReserved` financial-reserve account.

Actual payout-in-processing funds are `balanceInfo.Blocked` and are omitted from the public response.

Therefore at least three concepts are conflated/misnamed in the public contract:

- economic available;
- immediately withdrawable;
- financial reserve vs payout block.

## V2 direction

Use explicit semantics internally and in the new canonical API:

```text
available
withdrawable
pending_settlement
reserved              # only if risk reserve exists
blocked                # payout reserved/in progress
total_merchant_funds
```

If backward compatibility requires preserving the old response, provide a compatibility projection while making the canonical V2 fields unambiguous.

---

# Outbound merchant payment webhooks

## Legacy architecture

Payment events are published to a queue and consumed by `SendWebhookConsumer`, which calls `WebhookService`.

`WebhookService`:

1. loads payment + Pix;
2. skips suppressed/internal protocol events;
3. sets payment callback status to pending;
4. generates a delivery UUID in memory;
5. builds JSON payload;
6. signs payload;
7. performs retries;
8. stores aggregate callback status/attempt count/error back on `Payment`.

## Legacy headers

```text
X-SwiftPay-Signature
X-SwiftPay-Event
X-SwiftPay-Delivery
X-SwiftPay-Attempt
```

The header names are reasonable and can remain compatible.

## Confirmed cryptographic weakness

Payment webhook signature is generated as:

```text
HMAC-SHA256(payload, payment.Id.ToString())
```

The transaction/payment ID is:

- exposed to the merchant through the API;
- present in the webhook payload;
- not secret entropy.

Therefore the HMAC key is publicly knowable by the intended receiver and potentially by any party that learns the transaction ID. It cannot provide cryptographic authenticity as a secret-key MAC.

### V2 requirement

Each merchant webhook endpoint must have a cryptographically random secret independent of payment IDs.

Properties:

- generated from a CSPRNG;
- shown once or retrievable only through an explicit secret-rotation flow;
- stored as encrypted secret/verifier according to signing needs;
- rotatable;
- endpoint-scoped or merchant-scoped by explicit contract;
- never included in payloads/URLs/logs.

Recommended signature message includes at least:

```text
timestamp + "." + raw_request_body
```

with a replay window and versioned signature header.

## Durability gap

The legacy delivery ID is generated in memory inside the service. There is no dedicated persisted `webhook_delivery` row before first send in the reviewed path.

Only aggregate callback state is stored on `Payment`:

- status;
- attempts;
- last attempt time;
- last error.

### Failure scenario

```text
merchant receives HTTP webhook successfully
 -> local DB persistence/update fails afterward
 -> consumer throws/redelivers
 -> service generates a NEW delivery ID
 -> same business event may be delivered again as a distinct delivery
```

Duplicate webhook delivery is always possible in distributed systems, so receivers must be idempotent. But the sender should preserve one durable event/delivery identity across retries to make deduplication reliable.

## V2 durable model

Candidate:

```text
webhook_endpoints
- id
- merchant_id
- url
- secret_ciphertext/ref
- status
- event_filters
- secret_version

webhook_events
- id                  # stable business event ID
- merchant_id
- type
- source_type
- source_id
- payload_snapshot
- occurred_at

webhook_deliveries
- id                  # stable delivery ID
- event_id
- endpoint_id
- attempt_count
- next_attempt_at
- status
- last_status_code
- last_error_class
- delivered_at
```

The event and delivery must be persisted before network execution.

## Retry-count mismatch in legacy

`WebhookService` has its own loop:

```text
MaxRetries = 3
outer delays: 2s, 4s
```

The named `webhooks` HttpClient separately configures:

```text
MaxRetryAttempts = 3
exponential delay starting at 2s
10-second timeout strategy
circuit breaker
```

In .NET resilience semantics, `MaxRetryAttempts = 3` means the initial transport execution plus up to three retries.

Therefore one outer “attempt” can execute up to four HTTP transports for retryable failure, and three outer attempts can produce up to roughly twelve HTTP executions before circuit-breaker effects.

Yet persisted `CallbackAttempts` reports only the outer attempt count.

### V2 requirement

Use one durable retry mechanism. One recorded attempt should correspond to one actual delivery execution/response.

Do not stack invisible transport retries underneath application-level durable retry accounting for non-idempotent webhook POST delivery.

---

# Outbound payout webhooks

`CashoutWebhookService` repeats the same architecture and the same signature weakness:

```text
HMAC-SHA256(payload, payout.Id.ToString())
```

Payout ID is also not secret.

Payout webhooks should use the same V2 endpoint/event/delivery subsystem as payment webhooks rather than another parallel implementation.

The payload currently masks the Pix key, which is a useful privacy behavior to preserve.

---

# Security/compatibility decisions supported by this audit

## Preserve concept/contract where practical

- `/v1/auth/token` client-credentials flow;
- merchant API credentials distinct from dashboard auth;
- credential status + secret version immediate token invalidation;
- optional IP allowlist;
- `/v1/transactions` and transaction query routes;
- provider invisibility in responses;
- external merchant transaction reference;
- merchant callback/event concept;
- rate-limit response headers if compatibility requires them.

## Redesign

- explicit request idempotency separate from external reference;
- globally coherent rate limiting;
- Pix-only transaction request;
- balance field semantics;
- durable merchant webhook endpoints/events/deliveries;
- cryptographically secret webhook signing;
- one retry layer with observable attempts;
- explicit webhook replay protection.

## Remove from initial V2

- card fields;
- boleto fields;
- Wayne merchant-visible state/fee overrides unless separately approved;
- synthetic customer-data masking machinery after synthetic identity creation is removed.

## Required V2 contract tests

### API credentials

- valid client credentials -> token;
- wrong secret -> 401;
- revoked credential -> existing token rejected;
- regenerated credential -> old token rejected by secret-version mismatch;
- inactive merchant -> token/request rejected;
- environment cannot be crossed by token;
- IP allowlist fail closed.

### Create Pix

- amount is integer cents and > 0;
- only BRL accepted initially;
- same idempotency key + same request -> same operation/result;
- same idempotency key + different request -> conflict;
- retry after provider unknown result cannot create second Pix without reconciliation;
- provider-specific required customer fields fail explicitly;
- provider data does not leak in public response.

### Balance

- economic available, withdrawable, reserved and blocked cannot be silently conflated;
- total equals documented components;
- payout reservation immediately removes funds from withdrawable amount;
- compensation/reserve semantics, if retained, have explicit fields.

### Outbound webhooks

- signature cannot be forged from public transaction/payout IDs;
- exact raw body verifies against endpoint secret;
- timestamp outside replay window rejected by reference verifier;
- retry reuses stable event/delivery identity;
- HTTP failure creates next durable attempt, not nested hidden attempts;
- success followed by local worker crash does not create a new business event ID;
- secret rotation supports deterministic overlap/cutover policy;
- payout/payment events use the same delivery engine.

## Remaining public/API audit

Before the compatibility ADR is closed:

1. cashout request/response/list/status contracts;
2. sandbox simulate contract;
3. full transaction list models/pagination envelope;
4. BaseResponse/error envelope;
5. internal API auth and whether any external consumers depend on it;
6. API credential creation/regeneration/revocation endpoints in management API;
7. public OpenAPI specification parity;
8. tests that encode current external behavior;
9. callback/event types produced by completion/refund/expiry flows;
10. CORS/network/proxy behavior relevant to public API.