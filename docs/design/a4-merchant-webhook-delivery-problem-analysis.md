# SwiftPay V2 — A4 Merchant Webhook Delivery Runtime — Problem Analysis

Date: 2026-08-15
Status: FROZEN PROBLEM ANALYSIS
Next artifact: `docs/specs/merchant-webhook-delivery-runtime-v0.yaml`

## Problem statement

A3 now creates the canonical `payment.paid` merchant-webhook outbox event transactionally with the paid Payment and ledger posting. The repository already persists webhook endpoints, logical events, endpoint deliveries and a `merchant_webhook_delivery` durable job, but no trusted runtime performs the HTTP delivery.

A4 must turn that durable state into an at-least-once, signed, retryable HTTP delivery path without weakening financial exactly-once guarantees, exposing signing secrets, creating an SSRF primitive, or allowing two independent retry schedulers to compete for one delivery.

## Existing canonical state

### Durable job scheduler

`app.jobs` already provides:

- `pending | leased | completed | dead` lifecycle;
- `attempt_count`, `max_attempts`, `available_at`;
- worker owner/token/expiry lease evidence;
- `FOR UPDATE SKIP LOCKED` generic claiming;
- fenced completion/reschedule;
- stable job dedupe identity.

The existing merchant webhook fanout creates one job per delivery:

```text
kind          = merchant_webhook_delivery
resource_type = webhook_delivery
resource_id   = <delivery id>
dedupe_key    = merchant-webhook-delivery:<delivery id>:send
payload       = { webhook_delivery_id: <delivery id> }
payload_version = 1
max_attempts  = 8
```

### Webhook persistence

`app.webhook_deliveries` separately persists:

- `pending | leased | succeeded | exhausted | disabled`;
- `attempt_count`;
- `next_attempt_at`;
- delivery lease token/expiry;
- last HTTP status/error class;
- first/last attempt timestamps;
- success timestamp.

`app.webhook_endpoints` stores the endpoint URL, lifecycle, event subscriptions, current encrypted signing secret/version and one previous encrypted signing secret/version with overlap expiry.

`app.webhook_events` stores canonical event identity, event type, resource/source identity, exact public resource payload snapshot and occurrence time.

### Trusted runtime boundary

`swiftpay_worker` is a capability role without direct table DML. The worker process currently has readiness plus A3 paid-evidence composition, but no job loop and no webhook transport.

## Primary design hazards

### 1. Two independent lease/retry state machines

Calling generic `claim_jobs` and separately claiming `webhook_deliveries` would create two ownership systems. They could drift after crashes, stale leases or partial bookkeeping.

A4 therefore needs a **single composed database claim/resolve boundary** for merchant webhook delivery. The composed claim must validate and update the canonical Job and WebhookDelivery together and use one fencing token/lease interval for both.

The runtime must not implement a second in-memory queue or an HTTP-client retry loop.

### 2. At-least-once HTTP cannot be made exactly-once by local bookkeeping

A worker may successfully transmit a request and crash before persisting success. A later worker can legitimately retry. No PostgreSQL transaction can atomically commit a remote merchant HTTP effect.

A4 therefore does **not** promise exactly-once network delivery. It promises:

- one durable logical `WebhookEvent`;
- one durable `WebhookDelivery` identity per event/endpoint;
- stable `X-SwiftPay-Delivery` identity across retries;
- at-least-once delivery attempts;
- fenced local state transitions;
- no duplicate financial/domain effect inside SwiftPay.

Merchant receivers can deduplicate on the stable event/delivery identity.

### 3. Meaning of `attempt_count`

It is impossible to prove that bytes reached the remote socket and atomically increment PostgreSQL in the same transaction. A4 therefore freezes `WebhookDelivery.attempt_count` as the number of **durable dispatch claims handed to the transport path**, incremented before the network call under a valid lease. It is not a forensic count of packets received by the merchant.

This definition is conservative after crashes: a claimed dispatch that crashes before transport can count as an attempt, but no unrecorded nested retry may occur.

### 4. Signing secret cryptography is incomplete

The schema intentionally stores `secret_ciphertext`, not plaintext, but no ciphertext format/decryption-key contract exists yet.

A4 must freeze:

- one authenticated-encryption representation;
- one worker-only encryption-key environment variable;
- validation and failure behavior;
- no plaintext secret in database/logs/errors;
- delivery secret-version snapshot so retries do not silently change signing identity after endpoint rotation.

Endpoint creation/rotation APIs remain outside A4, but the delivery runtime must be able to consume correctly encrypted endpoint secrets.

### 5. Secret rotation and in-flight deliveries

A delivery created before endpoint secret rotation needs deterministic signing identity. Reading “whatever secret is current” on every retry would change signatures for the same durable delivery.

A4 therefore needs `webhook_deliveries.signing_secret_version`, snapshotted from the endpoint when fanout creates the delivery.

At dispatch time the database boundary may return:

- current ciphertext when the snapshot version equals current version;
- previous ciphertext only when the snapshot version equals `previous_secret_version` and the overlap has not expired;
- no usable secret otherwise, producing a terminal configuration failure without HTTP.

### 6. SSRF / DNS rebinding

Webhook URLs are merchant-controlled network destinations. A naive `fetch(url)` becomes a server-side request forgery primitive.

Production delivery must:

- permit only absolute HTTPS URLs;
- reject credentials in URLs;
- reject loopback, private, link-local, multicast, unspecified and other non-public IP ranges;
- resolve DNS at send time;
- reject a hostname if any selected/resolved target is prohibited;
- pin the validated destination for the request so DNS cannot change after validation;
- preserve original Host/SNI identity;
- never automatically follow redirects.

The deterministic CI endpoint may use loopback only through an injected **test-only endpoint policy/transport dependency**, never through a production environment flag that weakens SSRF policy.

### 7. Payload/signature byte stability

The merchant contract requires HMAC over the exact transmitted bytes. A3 stores a public Payment resource snapshot, while the merchant-webhook contract requires an event envelope.

A4 should construct the envelope from durable event fields:

```json
{
  "id": "<webhook_event_id>",
  "object": "event",
  "type": "payment.paid",
  "createdAt": "<occurred_at ISO-8601>",
  "data": { "...": "durable public resource snapshot" }
}
```

The body serializer must be deterministic for retries. Signature calculation must consume the exact byte buffer sent by the HTTP transport, not a separately reconstructed object.

### 8. HTTP classification must be explicit

A4 cannot treat every non-2xx the same or inherit transport/framework retry behavior.

The spec must freeze:

- approved success range;
- redirect policy;
- retryable network/HTTP classes;
- terminal HTTP classes;
- bounded `Retry-After` handling;
- maximum attempts;
- exact versioned backoff/jitter policy;
- terminal mapping to both delivery and job state.

### 9. Endpoint disable race

An endpoint can be disabled after an event was fanned out. A claimed delivery must re-read endpoint status from durable state. If disabled at claim time, no HTTP occurs and the delivery becomes `disabled`; its job completes rather than retries forever.

A disable immediately after claim can still race with one already-owned dispatch. This is an accepted at-least-once boundary; disable prevents subsequent claims, not an already-issued network syscall.

### 10. A4 must have no financial authority

Webhook delivery consumes public snapshots only. It must not update Payment, ProviderEvent, ledger accounts/entries/balances, payout/refund state or provider execution state.

A compromised merchant endpoint must never be able to influence financial state through HTTP response content.

## Proposed composed database boundary

A4 should introduce two worker-only routines rather than expose webhook tables directly.

### `app.claim_merchant_webhook_deliveries(text, integer, integer)`

Responsibilities:

1. select only due `merchant_webhook_delivery` jobs;
2. require `resource_type = webhook_delivery`, payload version 1 and resource/payload identity consistency;
3. join exactly one WebhookDelivery, WebhookEvent and WebhookEndpoint;
4. use `FOR UPDATE SKIP LOCKED`;
5. generate one lease token;
6. atomically mark Job and Delivery leased with the same token/expiry;
7. increment both dispatch attempt counters exactly once;
8. snapshot/return only the data required by the worker transport, including encrypted signing-secret material;
9. return endpoint disabled state without performing network work.

This routine is the only scheduler used by the A4 runtime.

### `app.resolve_merchant_webhook_delivery(...)`

Responsibilities:

- require current matching Job + Delivery lease token;
- `success`: Delivery -> succeeded, Job -> completed;
- `retry`: both -> pending with the same due time and cleared lease;
- attempt ceiling reached: Delivery -> exhausted, Job -> dead;
- terminal/configuration failure: Delivery -> exhausted, Job -> dead;
- disabled: Delivery -> disabled, Job -> completed;
- persist bounded HTTP/error evidence;
- reject stale/foreign lease completion;
- never modify financial/domain tables.

The application computes the retry delay from the frozen policy and passes the bounded delay to the resolve routine; the database remains authoritative for attempt ceiling and state transition.

## Proposed cryptographic boundary

Ciphertext representation:

```text
aes-256-gcm-v1$<nonce-12-byte-base64url>$<ciphertext-base64url>$<tag-16-byte-base64url>
```

Worker key environment variable:

```text
SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY
```

The variable is base64url for exactly 32 bytes. AES-256-GCM authentication failure is a terminal configuration error. Plaintext exists only transiently in worker memory and is never returned from the database, logged or embedded in durable job payloads.

## Proposed signing boundary

HTTP method: `POST`.

Headers:

```text
Content-Type: application/json; charset=utf-8
User-Agent: SwiftPay-Webhooks/1
X-SwiftPay-Event: <event UUID>
X-SwiftPay-Delivery: <delivery UUID>
X-SwiftPay-Timestamp: <Unix epoch seconds>
X-SwiftPay-Signature: v1=<lowercase hex HMAC-SHA256>
```

Signature input:

```text
v1\n<timestamp>\n<event-id>\n<delivery-id>\n<exact-body-bytes>
```

HMAC key: decrypted endpoint signing secret.

The timestamp is generated per dispatch attempt. Retries keep event/delivery/body identity but receive a fresh timestamp/signature.

## Proposed retry classification

Success:

```text
HTTP 200..299
```

Retryable:

```text
network error
timeout
HTTP 408
HTTP 425
HTTP 429
HTTP 500..599
```

Terminal without retry:

```text
HTTP 300..399   -> redirect_disallowed
HTTP 400..499 excluding 408/425/429 -> merchant_rejected
invalid/blocked URL -> endpoint_policy
secret decrypt/version unavailable -> signing_configuration
unsupported event/job payload version -> validation
```

The transport never follows redirects.

Maximum durable dispatch attempts remains the existing job policy: 8.

A4 freezes a bounded versioned backoff in YAML, including deterministic jitter so tests and independent workers derive the same delay.

## Explicitly deferred

A4 V0 does not include:

- merchant endpoint create/update/rotate HTTP API/UI;
- manual redelivery API/UI;
- provider webhook ingress;
- live AkkadPag/FlevoPay HTTP calls;
- settlement release from pending to available;
- arbitrary event ordering guarantees;
- response-body persistence;
- dedicated broker infrastructure.

## Required RED gates before implementation

1. schema/ACL test for delivery signing-secret version snapshot and composed routines;
2. behavior RED for synchronized Job + Delivery claim/resolve and stale-token fencing;
3. behavior RED for success/retry/exhausted/disabled transitions;
4. application RED for AES-GCM decrypt validation and secret non-leakage;
5. application RED for exact body serialization/signature vectors;
6. application RED for retry classification and deterministic backoff;
7. application RED for strict SSRF URL/IP/DNS policy;
8. runtime RED for worker composition and zero hidden transport retries;
9. real-runtime RED with two workers and a deterministic local merchant endpoint;
10. acceptance proof that Payment/Ledger state does not change during delivery processing.

No production HTTP delivery implementation may begin before the YAML specification freezes these boundaries.