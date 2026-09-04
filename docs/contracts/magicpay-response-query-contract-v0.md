# SwiftPay V2 — A29 MagicPay Response + Query Contract v0

Status: Frozen for TDD
Date: 2026-09-03 (America/Santarem)

## Purpose

A29 converts newly supplied provider-owned MagicPay create-sale/find-sale documentation into executable, network-free response/query normalization.

A29 does not authorize provider traffic.

Source screenshot manifest SHA-256:

`8838db6276152af9d43d16ce71fa32cb9310b01f46f10c20897dea668d2f6833`

No provider credential value may enter Git, tests, docs, browser bundles or ordinary logs.

## 1. Architecture decision

ADR 0005 admits MagicPay as the third provider candidate. This satisfies ADR 0004's explicit-decision requirement for a third processor.

Provider-candidate status is not runtime authorization.

A29 MUST NOT modify A10 or A11 and MUST NOT add MagicPay to the public providers barrel.

## 2. Optional Pix expiration request

`buildMagicPayPixCreateRequest` may accept an optional `expiresInDays` input.

When absent, the request body omits the `pix` object.

When present, it MUST be a positive signed-int32 integer and the request body contains exactly:

```json
{
  "pix": {
    "expiresInDays": 1
  }
}
```

as an additive field to the already frozen A28 Pix request body.

Invalid values fail locally with zero transport.

## 3. Create-sale successful response parser

A29 may expose a pure parser for MagicPay's documented `200` create-sale response body.

The provider documentation establishes a top-level transaction object including `id`, `amount`, `paymentMethod`, `status`, `externalRef` and a provider-specific nested `pix` object among other fields.

A29 normalization requires only evidence-backed fields needed for safe provider-layer state:

```ts
{
  providerPaymentId: string;
  amountCents: number | null;
  paymentMethodRaw: string | null;
  providerStatusRaw: string;
  paymentStatus:
    | 'pending'
    | 'paid'
    | 'failed'
    | 'refunded'
    | 'disputed';
  externalRef: string | null;
}
```

The parser MUST:

- accept a positive safe-integer `id` and normalize it to decimal string;
- accept `status` only when it maps through the documented status vocabulary;
- preserve raw status text;
- preserve `paymentMethod` and `externalRef` only when they are nonblank strings;
- preserve `amount` only when it is a non-negative safe integer;
- reject malformed JSON/body shape;
- fail closed on an unknown provider status.

The parser MUST NOT inspect or invent nested create-response `pix` fields because those fields remain unproven.

## 4. Documented status mapping

The only MagicPay statuses normalized by A29 are:

```text
waiting_payment -> pending
pending         -> pending
paid            -> paid
refused         -> failed
refunded        -> refunded
chargedback     -> disputed
```

Matching is case-insensitive after trimming.

Any other nonblank status returns an explicit unrecognized-status result carrying the raw provider value.

A29 does not invent `expired`, `cancelled`, `processing` or any other MagicPay state.

## 5. Create-sale 400 parser

The create-sale documentation establishes a `400` body with:

```ts
{
  code: integer;
  message: string;
}
```

A29 may parse this shape into opaque provider error metadata.

The parser MUST NOT classify the error as `pre_execution_failure`, MUST NOT infer that no transaction was created, and MUST NOT authorize a retry. Monetary execution certainty remains unproven.

## 6. Query request builder

A29 may expose a pure query request builder for:

```text
GET transactions/{id}
```

It MUST:

- require valid Basic Auth credentials;
- require a positive integer provider transaction ID represented as decimal string or positive safe integer;
- URL-encode the normalized ID segment;
- send no request body;
- attach no withdrawal header.

Invalid input fails locally.

## 7. Query successful response parser

The provider documentation establishes a successful `200` find-sale transaction object with, among other fields:

- `id` integer;
- `amount` integer;
- `paymentMethod` string;
- `status` string;
- `paidAt` string;
- `externalRef` string;
- `pix` string.

The provider describes `pix` as the Pix key or code used in the transaction.

A29 normalization is:

```ts
{
  providerPaymentId: string;
  amountCents: number | null;
  paymentMethodRaw: string | null;
  providerStatusRaw: string;
  paymentStatus:
    | 'pending'
    | 'paid'
    | 'failed'
    | 'refunded'
    | 'disputed';
  providerPixValue: string | null;
  paidAt: string | null;
  externalRef: string | null;
}
```

The parser MUST preserve a nonblank query `pix` string exactly as `providerPixValue`.

It MUST NOT rename that value to `copyAndPaste`, `brCode`, `emv`, `qrCode` or equivalent without stronger provider-owned evidence or an authenticated real response proving the semantic.

## 8. Provider-id consistency

A future caller may compare the query response `id` with the requested provider ID, but A29's pure parser has no request context and therefore only normalizes the response itself.

A later live adapter MUST reject or escalate mismatched requested/returned provider IDs rather than silently associating the response with another SwiftPay payment.

## 9. No live adapter

A29 MUST NOT expose `createMagicPayAdapter`.

The existing MagicPay module remains internal-only and is not re-exported from `packages/providers/src/index.ts`.

No A29 function performs HTTP, DNS, socket, database, provider, payment, ledger, webhook, payout or refund side effects.

## 10. Remaining create/recovery gap

Even though A29 closes the documented top-level create and query envelopes, a payable Pix adapter is still blocked by:

- unexpanded nested create-response `pix` object fields;
- ambiguity of query `pix` as key-vs-copy-and-paste payload;
- provider create idempotency semantics;
- ambiguous-create recovery after connection/timeout failure;
- provider error certainty semantics;
- environment/Sandbox classification;
- authenticated provider proof;
- webhook authentication/replay identity;
- explicit rate limits.

`externalRef` remains a correlation field only. It is not provider idempotency evidence.

## 11. RED/GREEN acceptance

RED requires fail-first tests proving the new pure normalizers/builders are absent.

GREEN requires:

- exact screenshot manifest lineage preserved in Problem Analysis/spec/contract;
- optional `pix.expiresInDays` serialization with positive-int32 validation;
- exact documented MagicPay status mapping;
- create-success parser;
- create-400 opaque parser with no execution certainty;
- query request builder;
- query-success parser preserving `providerPixValue`;
- explicit remaining-gap metadata;
- no `createMagicPayAdapter`;
- no public MagicPay barrel export;
- no A10/A11 change;
- all existing application contracts remain GREEN.

## 12. Explicit non-claim

A29 GREEN does not prove real MagicPay credentials, network reachability, Sandbox access, canonical Pix copy-and-paste semantics, provider idempotency, ambiguous-create recovery, webhook authenticity or Production readiness.
