# SwiftPay V2 — A28 MagicPay Provider Contract Evidence v0

Status: Frozen for TDD
Date: 2026-09-03 (America/Santarem)

## Purpose

A28 records the provider-owned MagicPay integration facts now available and implements only a non-authorizing subset that cannot create real monetary traffic.

The source artifact is identified by SHA-256:

`b9b493227d45b880077383c145e9ca5a0c16e6fae327b84d2c614566b8c47104`

No supplied credential value may enter Git, tests, docs, screenshots or ordinary logs.

## 1. Base URL and authentication

The documented API base URL is exactly:

`https://api.dashboardmagicpay.com/v1`

Normal requests use HTTP Basic Auth:

`Authorization: Basic base64(publicKey:secretKey)`

For withdrawal/anticipation routes the guide additionally documents `x-withdraw-key`. A28 does not implement those monetary operations.

## 2. Monetary representation

All amounts are positive integer centavos at the SwiftPay/provider boundary. Floating-point provider amounts are forbidden.

CPF/CNPJ and phone values are serialized as digits only. Document type is lower-case `cpf` or `cnpj` in the MagicPay request.

## 3. Safe Pix create request builder

A28 may implement a pure builder for the documented Pix request. It does not send the request and does not constitute provider activation.

The implementation lives only in `packages/providers/src/magicpay.ts`. It MUST NOT be exported from the public `packages/providers/src/index.ts` barrel while the live response/idempotency/recovery contract remains unresolved.

The result must be a provider request equivalent to:

- method `POST`;
- relative path `transactions`;
- Basic `Authorization` header;
- `Content-Type: application/json`;
- body fields in MagicPay's documented camelCase vocabulary.

The request body is limited to:

- `amount` = input centavos;
- `paymentMethod` = `pix`;
- one non-tangible item with `title`, `unitPrice`, `quantity=1`, `tangible=false`, `externalRef`;
- required customer name/email/phone/document;
- top-level `externalRef` using the SwiftPay client reference;
- optional `postbackUrl` only when supplied.

A28 does not attach idempotency meaning to either `externalRef` field.

Invalid amount, credentials, customer identity or reference data must fail locally with zero transport.

## 4. Read-only request primitives

The internal A28 module may expose read-only clients for:

- `GET company`;
- `GET balance/available`.

They use the same Basic Auth credentials, perform at most one provider request, and return provider JSON only as opaque read-only data. They do not alter SwiftPay financial state and do not infer provider activation.

## 5. Pix live adapter remains forbidden

A28 MUST NOT expose a live success-normalizing MagicPay `createPixCharge` adapter because the available guide does not prove the exact successful response projection.

In particular, A28 does not invent:

- provider payment-id field location;
- Pix copy-and-paste/QR field names;
- Pix expiration field location;
- response envelope shape;
- transaction query response envelope.

## 6. Idempotency and ambiguous execution remain unproven

The guide documents `externalRef`, but does not state that it is unique, replay-safe, or queryable for recovery. A28 therefore MUST NOT use `externalRef` as a provider idempotency guarantee.

No retry-after-timeout policy is authorized. A later live-adapter slice must obtain provider-owned create idempotency and ambiguous execution recovery semantics before a payable Pix call is allowed.

## 7. Webhook authority remains unavailable

The guide documents `postbackUrl`, transaction-shaped status payloads, 2xx acknowledgement and retries after non-2xx.

It does not document authentication/signature or replay identity. Therefore MagicPay postback data is untrusted for monetary transitions in A28.

`webhookAuthority = false` remains mandatory. No `paid` transition may be driven by MagicPay postback content alone.

## 8. A10/A11 authority boundary

A28 changes no A10 activation state and binds no MagicPay monetary operation to A11.

A MagicPay request builder existing in source code is not authorization to execute it. Keeping the module out of the public provider barrel is an additional defense against accidental runtime wiring.

Production and Sandbox monetary authority remain zero until a later explicit slice closes:

- response normalization;
- idempotency/recovery;
- environment classification;
- authenticated provider proof;
- deliberate A10 transition.

## 9. Cash-out/refund boundary

The guide proves that MagicPay exposes transfer/refund-related routes, but those capabilities are outside A28. No withdrawal key is accepted by A28 runtime primitives and no transfer/refund request builder is added.

## 10. Security

Secrets remain server-side only. Tests use synthetic values. Authorization headers must never be logged by application observability.

## 11. RED/GREEN acceptance

RED is the absence of the dedicated MagicPay contract-safe module required by the A28 application test.

GREEN requires:

- exact evidence metadata;
- pure Pix request serialization in documented camelCase;
- local validation before any transport;
- read-only company/balance request primitives;
- explicit unresolved-gap metadata;
- dedicated module remains absent from the public provider barrel;
- no A10 MagicPay activation;
- no live MagicPay Pix adapter;
- no webhook trust;
- all existing Application contracts remain GREEN.

## 12. Explicit non-claim

A28 GREEN does not prove MagicPay credentials, network reachability, Sandbox access, payable Pix creation, successful QR normalization, webhook authenticity, idempotency or Production readiness.