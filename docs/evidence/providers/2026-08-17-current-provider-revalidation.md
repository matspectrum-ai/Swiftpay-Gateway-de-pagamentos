# SwiftPay V2 — Current retained-provider revalidation

Date: 2026-08-17  
Scope: AkkadPag/AkadPay and FlevoPay  
Purpose: evidence refresh for the production activation gate  
Monetary traffic performed: **none**

## Evidence policy

This note refreshes discovery evidence only. It does not supersede A5's evidence hierarchy or authorize a live provider operation.

Only current provider-owned technical documentation tied to the exact retained contract lineage, current authenticated non-monetary sandbox evidence, or provider-owned written lineage/contract confirmation can move a retained operation toward live activation.

Marketing material remains discovery evidence only. Similar brand names are not lineage proof.

## AkadPay public technical material — rechecked 2026-08-17

Provider-owned pages inspected:

- https://akadpay.com.br/
- https://painel.akadpay.com.br/docs/api-pix
- https://painel.akadpay.com.br/docs/api-pix/receive
- https://painel.akadpay.com.br/docs/api-pix/send
- https://painel.akadpay.com.br/docs/api-pix/webhooks

### Newly/currently observable facts

The public AkadPay site advertises a "Nova API 2.0" and markets webhook signature validation / JWT-style API security. Those statements do not provide an executable signature or token-verification contract by themselves.

The current Pix-in documentation exposes:

```text
POST https://painel.akadpay.com.br/api/wallet/deposit/payment
credentials: token + secret in JSON body
amount: numeric example
customer/debtor name, email, document and phone
callback field: postback
response identity: idTransaction
Pix material: qrcode + qr_code_image_url
```

The current Pix-out documentation exposes:

```text
POST https://painel.akadpay.com.br/api/pixout
credentials: token + secret in JSON body
idempotencyKey: 8..100 chars, unique per withdrawal
same idempotencyKey + same data: documented to return existing transaction
response identifiers: id, reference_id, idempotencyKey
callback field: baasPostbackUrl
manual-approval mode may leave a withdrawal pending
```

The current webhook page documents callback bodies for Pix-in and Pix-out. For Pix-out it now explicitly states that the event may be resent and recommends idempotencyKey or reference_id for duplicate absorption. It does **not** document the exact cryptographic webhook verification algorithm/header/key derivation needed to treat the callback as trusted financial evidence.

### What remains unproven for retained `akkadpag`

The retained SwiftPay adapter lineage is historically:

```text
provider: AkkadPag
base URL: https://api.akkadpag.com/v1/
auth: HTTP Basic publicKey:secretKey
resources: transactions / transfers
```

The public current AkadPay material is materially different:

```text
provider branding: AkadPay
base path: https://painel.akadpay.com.br/api/...
auth examples: token + secret JSON fields
resources: wallet/deposit/payment / pixout
```

No provider-owned source discovered in this revalidation proves that AkkadPag was renamed/migrated to AkadPay, that credentials are interchangeable, that the old and new API contracts are compatible, or that the current AkadPay contract is authoritative for the retained `akkadpag` integration.

Therefore:

- AkadPay Pix-out idempotency is `proven_current` only for the public AkadPay contract shown by that documentation;
- it is **not** imported into the retained AkkadPag operation contract;
- AkadPay webhook replay guidance is useful current evidence for AkadPay, but trusted webhook authority remains unavailable without the exact verification protocol;
- retained AkkadPag live Pix-in, Pix-out, recovery and webhook authority remain blocked.

## FlevoPay public material — rechecked 2026-08-17

Provider-owned page inspected:

- https://flevopay.com.br/

The current site publicly states:

```text
api.flevopay.com/v1 active
API-key style integration
PIX support
marketing/API-reference visual mentioning PIX IN and PIX OUT
instant withdrawal capability
```

The page does not expose an executable technical contract for:

- exact Pix-in create path and schema;
- exact query/recovery route and lookup identifier;
- idempotency/replay semantics;
- definitive-rejection versus ambiguous-execution semantics;
- webhook authentication/signature and replay identity;
- provider status vocabulary;
- rate limits / safe read retry contract;
- exact Pix-out request/recovery contract.

The retained legacy SwiftPay adapter lineage remains:

```text
base URL: https://app.flevopay.com.br/api/v1/
auth header: X-API-Key
Pix-in create: POST transaction
query: GET query?action=get_transaction&id=...
Pix-out: unsupported by retained adapter
```

Current marketing names a different host (`api.flevopay.com/v1`) and does not prove compatibility with `app.flevopay.com.br/api/v1/`.

Therefore retained FlevoPay live Pix-in, recovery, webhook authority and Pix-out remain blocked.

## Revalidated activation matrix

| Provider | Operation | Evidence state | Live state |
|---|---|---|---|
| AkkadPag | Pix-in create/query | legacy contract proven; current retained lineage unproven | blocked |
| AkkadPag | Pix-out | legacy contract proven; AkadPay current idempotency cannot be imported without lineage proof | blocked |
| AkkadPag | webhook authority | exact current retained verification contract unknown | blocked |
| FlevoPay | Pix-in create/query | legacy contract proven; current host exists but exact technical contract unknown | blocked |
| FlevoPay | Pix-out | current marketing advertises capability; retained adapter contract unsupported/unproven | blocked |
| FlevoPay | webhook authority | exact verification/replay contract unknown | blocked |

## Engineering consequence

The next internal production-oriented slice should not hard-code current AkadPay semantics into `akkadpag` and should not guess FlevoPay routes.

The safe next step is a provider activation/outbound safety gate that:

1. binds authorization to exact provider + operation + contract lineage + environment;
2. defaults every retained operation to network-denied while evidence is fixture-only;
3. requires versioned evidence provenance before an operation can advance state;
4. prevents a similarly named provider contract from being silently substituted;
5. keeps provider transport unavailable to monetary code until the required activation state is explicitly satisfied;
6. remains testable without any real PSP request.

No fact in this note authorizes a monetary call.