# Retained Provider Deep Audit — AkkadPag and FlevoPay

Status: active retained-provider reverse engineering

Date: 2026-08-13
Legacy source: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Scope

The initial SwiftPay V2 runtime supports exactly two processors:

- AkkadPag
- FlevoPay

This document records source-proven protocol facts and the V2 behavior that must replace unsafe or ambiguous legacy semantics. It is not permission to enable an operation that has not passed provider conformance tests.

## Common V2 rules

Both adapters are thin server-side integrations behind the canonical SwiftPay provider boundary.

For both:

- canonical SwiftPay amounts are integer centavos;
- provider credentials never leave trusted server storage;
- no synthetic customer name/document/email/phone is generated to satisfy a PSP;
- create/payment/payout POST transport ambiguity becomes `execution_unknown`, not definitive failure;
- monetary POSTs are not blindly retried;
- read-only status/recovery calls may use bounded safe retry;
- provider raw statuses are evidence, not canonical state by themselves;
- an unknown raw status never silently defaults to `pending`, `processing`, success or failure;
- duplicate/out-of-order provider evidence cannot create a second canonical financial posting;
- unsupported capabilities fail locally before external I/O.

## AkkadPag

### Authentication and endpoints

The audited client uses HTTP Basic authentication:

```text
Authorization: Basic base64(publicKey:secretKey)
```

Observed operations:

```text
POST transactions
GET  transactions/{paymentId}
POST transfers
GET  transfers/{transferId}
GET  company/details
```

Pix-out additionally sends:

```text
x-withdrawal-key: <withdrawalKey>
```

The withdrawal key is an authorization credential. No provider-side idempotency guarantee is inferred from it.

### Pix-in request shape

Audited request fields:

```text
amount                # long, integer centavos
payment_method        # PIX
items[]
  title
  unit_price          # centavos
  quantity
  tangible
  external_ref?
customer
  name
  email
  phone
  document
    number
    type
postback_url?
utm?
```

Response evidence includes:

```text
id
amount
currency
status
pix.copy_paste
pix.end_to_end
pix.expires_at
paid_at
created_at
updated_at
```

### Pix-out request shape

Observed request:

```text
amount
pix_key
pix_key_type
document?
postback_url?
```

Response evidence includes:

```text
id
status
amount
net_amount
fee
method
pix_key
pix_key_type
created_at
updated_at
```

### Status mappings found in legacy

Payment:

```text
WAITING_PAYMENT -> pending
PENDING         -> pending
APPROVED        -> paid/completed
PAID            -> paid/completed
REFUSED         -> failed
CANCELLED       -> cancelled
REFUNDED        -> refunded evidence
IN_PROTEST      -> disputed
CHARGEBACK      -> disputed
unknown         -> pending     # DO NOT PRESERVE
```

Payout:

```text
PENDING_ANALYSIS -> processing
PROCESSING       -> processing
COMPLETED        -> completed
REFUSED          -> failed
CANCELLED        -> cancelled
unknown          -> processing # DO NOT PRESERVE
```

V2 must return a structured `unrecognized_provider_status` evidence state for unknown values. Unknown evidence cannot independently move canonical Payment/Payout state.

### Webhooks

Transaction webhook carries:

```text
event
transaction.id
transaction.status
transaction.amount
transaction.currency
transaction.payment_method
transaction.pix.copy_paste
transaction.pix.end_to_end
transaction.pix.expires_at
transaction.payer
transaction.paid_at
transaction.refund_at
sent_at
```

Withdrawal webhook carries:

```text
event
withdrawal.id
withdrawal.status
withdrawal.amount
withdrawal.net_amount
withdrawal.pix_key
withdrawal.pix_key_type
withdrawal.end_to_end
withdrawal.receiver
withdrawal.paid_at
sent_at
```

The audited `AkkadPagGroup` is anonymous and does **not** attach `AcquirerWebhookAuthPreProcessor`, unlike FlevoPay and most other provider groups. Therefore the legacy application boundary is not acceptable as the V2 authentication contract.

V2 must prove a provider-supported secret/signature/token mechanism and reject unauthenticated evidence before it can create `ProviderEvent`. If the provider cannot supply a trustworthy webhook authentication mechanism, webhook data is treated as a recovery hint requiring authoritative status lookup before financial transition.

### Transport ambiguity

`AkkadPagClient.SendAsync` catches every exception and returns `Success=false`. That collapses timeout/connection reset/lost response into the same result as a known provider rejection.

V2 separates:

```text
provider 4xx / explicit reject -> definitive failure when contract proves it
known success response         -> succeeded
transport timeout/reset        -> execution_unknown
ambiguous provider 5xx         -> execution_unknown unless contract proves non-execution
```

Funds are never released and a second monetary request is never sent merely because the first HTTP response was lost.

### AkkadPag V1 capability state

```text
Pix In:  retained, production activation requires conformance proof
Pix Out: retained, production activation requires payout idempotency/recovery proof
Refund:  disabled until exact endpoint/identity/recovery contract is proven
```

## FlevoPay

### Authentication and endpoints

The audited client sends:

```text
X-API-Key: <secretKey>
```

Observed operations:

```text
POST transaction
GET  query?action=get_transaction&id={transactionId}
GET  seller
```

No Pix-out client operation exists in the audited legacy adapter.

### Pix-in request shape

Observed request:

```text
amount                # long, integer centavos
description?
reference?
postback_url?
source = api_externa
customer
  name?
  email?
  document?
  phone?
```

Response evidence:

```text
status
transaction_id
id
qr_code
qr_code_base64
amount
expires_at
```

Status query response:

```text
id
external_id
status
amount
created_at
updated_at
```

The adapter must persist both SwiftPay's stable `ProviderAttempt.client_reference` and every provider identifier returned by FlevoPay. Recovery lookup order must be specified by conformance evidence; it must not guess which identifier the provider accepts after an ambiguous create.

### Status mappings found in legacy

```text
pending      -> pending
processing   -> processing
approved     -> paid/completed
under_review -> processing
failed       -> failed
refunded     -> refunded evidence
chargeback   -> disputed
unknown      -> pending  # DO NOT PRESERVE
```

V2 treats an unknown FlevoPay status as unrecognized provider evidence and schedules/requires recovery rather than silently projecting `pending`.

### Webhook evidence

Observed transaction webhook fields:

```text
transaction_id
external_id
status
amount
payment_method
customer
pix_code
raw_status
webhook_type
timestamp
recurring_id
```

The legacy endpoint maps the provider status and calls the shared payment processing service, returning HTTP 200 even on internal exceptions.

The FlevoPay group does attach `AcquirerWebhookAuthPreProcessor`. That establishes only that legacy application authentication existed; the retained V2 audit still has to prove the exact provider credential/header/signature mechanism and replay semantics.

The inspected Flevo webhook body does not expose a clearly guaranteed first-class event ID. V2 provider-event identity therefore requires either:

1. a provider-documented event identity proven by conformance evidence; or
2. a versioned deterministic fingerprint scoped by provider account/environment and stable resource/event fields plus payload hash.

### Transport ambiguity

Like AkkadPag, the Flevo client catches every exception and returns `Success=false`. V2 must not interpret that as proof the provider did not create the Pix.

After ambiguous create:

```text
ProviderAttempt -> execution_unknown
no second create
recover by authoritative query/webhook evidence
```

### FlevoPay V1 capability state

```text
Pix In:  retained, production activation requires create/recovery/webhook conformance proof
Pix Out: unsupported; router rejects locally before HTTP
Refund:  disabled until exact endpoint/identity/recovery contract is proven
```

## Router contract for the two-provider release

```text
create Pix
  -> route only among provider accounts whose provider is AkkadPag or FlevoPay
  -> require supports_pix_in=true and conformance-enabled status

create payout
  -> route only to AkkadPag
  -> require supports_pix_out=true and conformance-enabled status

refund
  -> reject as provider capability unavailable until an exact retained-provider refund contract is enabled
```

No generic fallback to a legacy/deferred provider exists.

## Required retained-provider conformance tests

AkkadPag and FlevoPay Pix-in:

- credentials/header construction;
- amount remains integer centavos;
- exact required customer fields;
- no fabricated identity/contact data;
- deterministic client reference persistence;
- success response normalization;
- provider 4xx classification;
- ambiguous 5xx classification;
- timeout/connection-reset -> `execution_unknown`;
- recovery without blind second create;
- known raw status table;
- unknown raw status -> `unrecognized_provider_status`;
- authenticated webhook acceptance;
- invalid/missing auth rejection;
- duplicate webhook/event idempotency;
- out-of-order webhook safety;
- provider DTO fields never leak into public API.

Additional AkkadPag Pix-out:

- `withdrawalKey` handling;
- stable payout client/source identity;
- `PENDING_ANALYSIS`/`PROCESSING` remain non-terminal;
- no release of blocked funds on transport ambiguity;
- authoritative query/webhook resolves unknown result exactly once;
- provider-side replay/idempotency evidence before any automatic retry is allowed.

Additional FlevoPay:

- `supports_pix_out=false` is enforced by router and creates zero provider-side traffic.

## Open evidence gates

Before live activation, obtain current provider documentation/sandbox evidence for:

- exact base URLs and environment behavior;
- webhook authentication/replay protection for both providers;
- AkkadPag create/payout provider idempotency guarantees, if any;
- authoritative recovery identifiers and status-query guarantees;
- refund support/contract, if any;
- rate limits and provider-specific safe GET retry behavior;
- current status enumerations and any statuses absent from the legacy source.