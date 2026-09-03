# SwiftPay V2 — A28 MagicPay Provider Contract Evidence — Problem Analysis

Status: Contract evidence partially closed / implementation-safe subset only
Date: 2026-09-03 (America/Santarem)
Branch: `agent/a28-magicpay-provider-contract-evidence`

## Problem

SwiftPay V2 has canonical A25/A26/A27 hosted database/runtime evidence, while retained PSP Production authority remains zero under A5 fixture-only + A10 default-deny + A11 strict transport.

A MagicPay credential set was supplied out-of-repository together with provider documentation and, subsequently, an integration guide intended for API/LLM integrators. Credential values remain deliberately absent from Git history, docs, tests, screenshots and logs.

The supplied integration guide materially closes the previous documentation-access blocker. Its exact uploaded artifact SHA-256 is:

`b9b493227d45b880077383c145e9ca5a0c16e6fae327b84d2c614566b8c47104`

This hash identifies the evidence artifact without copying secrets; the artifact itself contains no supplied credential values.

## Contract facts now evidenced

The provider guide states the following exact integration facts:

- API base URL: `https://api.dashboardmagicpay.com/v1`;
- HTTP Basic Authentication;
- Basic username = API public key (`apiPublicKey`);
- Basic password = API private/secret key (`apiKey`);
- money is integer centavos;
- dates are ISO 8601 strings;
- CPF/CNPJ and phone are digit-only;
- withdrawal/anticipation operations additionally require `x-withdraw-key`;
- Pix cash-in is created with `POST /transactions` and `paymentMethod: pix`;
- transaction lookup is `GET /transactions/{id}`;
- transaction list is `GET /transactions?page=&pageSize=`;
- company/profile read is `GET /company`;
- balance read is `GET /balance/available`;
- transaction postbacks use `postbackUrl`, carry transaction-shaped status data, require 2xx acknowledgement and are retried after non-2xx;
- example transaction statuses include `waiting_payment`, `paid`, `refused`, `refunded`, `chargedback`.

The guide also documents refund, delivery, transfer and anticipation routes. Those are outside the first A28 Pix cash-in slice and grant no SwiftPay cash-out/refund authority.

## Critical facts still NOT evidenced

The guide does not provide enough detail to safely normalize a successful Pix create into SwiftPay's provider contract. Missing evidence includes:

1. exact success response schema for `POST /transactions`, especially provider transaction id location, Pix copy-and-paste/QR field names and Pix expiration field location;
2. exact `GET /transactions/{id}` response envelope/schema;
3. provider-defined idempotency semantics for create;
4. whether top-level/item `externalRef` is merely metadata or a uniqueness/replay key;
5. a query-by-external-reference recovery path after an ambiguous create;
6. error-body/status-code contract distinguishing definitive pre-execution rejection from ambiguous execution;
7. explicit Sandbox/homologation host or environment classification;
8. webhook authentication/signature/replay identity;
9. webhook ordering/duplicate guarantees;
10. explicit rate limits.

These gaps are material. SwiftPay MUST NOT infer idempotency from `externalRef`, MUST NOT infer QR field names from another provider, and MUST NOT trust unsigned postback content as monetary authority.

## Safe authenticated probe attempt

A non-destructive probe was attempted only against documented read endpoints (`GET /company`, `GET /transactions?page=1&pageSize=1`, `GET /balance/available`). The available execution environment could not resolve `api.dashboardmagicpay.com`, so no provider request reached MagicPay and no account data was retrieved.

This is an environment DNS limitation, not provider evidence and not an authentication failure.

## A28 implementation boundary

A28 may now implement only contract-safe, non-authorizing primitives:

- a MagicPay Basic Auth header builder;
- deterministic validation/serialization for the documented Pix create request shape;
- read-only request primitives for `/company` and `/balance/available`;
- explicit metadata listing the unresolved contract gaps.

A28 MUST NOT yet implement a success-normalizing live `createPixCharge` adapter, mark MagicPay active in A10, bind monetary calls to A11, or treat provider postbacks as trusted.

The pure Pix request builder is preparation only. Runtime monetary traffic remains impossible unless a later slice deliberately closes response/idempotency/recovery evidence and changes A10 activation.

## Pix request shape frozen for the safe builder

Input must contain:

- positive safe integer `amountCents`;
- nonblank `clientReference`;
- nonblank description/title;
- valid customer name/email/phone/document;
- optional `postbackUrl` if supplied.

The documented request projection is:

```text
POST transactions
Authorization: Basic base64(publicKey:secretKey)
Content-Type: application/json

amount               integer cents
paymentMethod        "pix"
items[0].title       description
items[0].unitPrice   amount cents
items[0].quantity    1
items[0].tangible    false
items[0].externalRef clientReference
customer.name
customer.email
customer.phone       digits only
customer.document.number digits only
customer.document.type   cpf | cnpj
externalRef          clientReference
postbackUrl          optional
```

No idempotency guarantee is attached to `externalRef` by A28.

## Webhook boundary

The guide proves delivery and acknowledgement semantics only. It does not define signature or authentication. Therefore:

- MagicPay webhook authority remains unavailable;
- a postback can be persisted as untrusted evidence in a future slice if useful;
- no payment may transition to paid from MagicPay postback content alone;
- later trusted processing requires provider-owned authentication/replay evidence or conservative query-based reconciliation.

## Cash-out boundary

The documented `x-withdraw-key` and `/transfers` routes are acknowledged only as provider capability evidence. A28 does not implement or authorize withdrawal, cancellation, anticipation or refund behavior.

## Next evidence required for live Pix integration

Before a real MagicPay Pix adapter can move beyond request construction:

1. capture exact successful Pix create response example/schema;
2. capture exact transaction lookup response example/schema;
3. obtain provider idempotency/retry/recovery semantics;
4. obtain Sandbox/homologation classification or deliberately freeze a minimal Production smoke contract;
5. obtain webhook authenticity/replay contract, or explicitly design query-only monetary reconciliation;
6. run authenticated read-only proof from a network path that can resolve the provider host;
7. then freeze a new fail-first live-adapter/activation slice.

## Current conclusion

The uploaded guide is sufficient to move A28 from documentation discovery into a contract-safe implementation subset. It is not sufficient to authorize a payable Pix call. The next code in A28 must therefore be pure/read-only and default-deny by construction.