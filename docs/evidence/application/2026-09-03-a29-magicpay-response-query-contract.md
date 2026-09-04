# A29 Evidence — MagicPay Response + Query Contract

Date: 2026-09-03 (America/Santarem)
Scope: application-only / provider-contract evidence / network-free

## Result

A29 is GREEN for its frozen scope.

A29 converts newly supplied provider-owned MagicPay create-sale/find-sale documentation into pure request/response/query normalization without granting any live provider authority.

No real provider credential is stored in this repository and no MagicPay monetary request was sent by this slice.

## Provider evidence lineage

Provider documentation pages represented by the supplied screenshots:

- `https://app.dashboardmagicpay.com/docs/sales/create-sale`
- `https://app.dashboardmagicpay.com/docs/sales/find-sale`

Ordered screenshot digest-manifest SHA-256:

`8838db6276152af9d43d16ce71fa32cb9310b01f46f10c20897dea668d2f6833`

The screenshots themselves are intentionally not committed. The frozen Problem Analysis records their individual SHA-256 digests and the provider-owned facts extracted from them.

## Architecture decision

ADR 0005 (`docs/decisions/0005-admit-magicpay-provider-candidate.md`) explicitly admits MagicPay as a third provider candidate, satisfying ADR 0004's requirement that adding a third processor be a deliberate product/architecture decision.

This decision does not change A10/A11 authority and does not authorize provider traffic.

## Provider-owned facts frozen by A29

The supplied create-sale documentation establishes:

- successful `200` response as a top-level transaction object;
- provider transaction `id` as integer;
- `amount` as integer cents;
- `paymentMethod` string;
- `status` string with examples including pending/paid/refunded/refused;
- `externalRef` string;
- nested `pix` object, whose internal success-response fields were not expanded;
- request `pix.expiresInDays` as int32;
- create error `400` response with integer `code` and string `message`.

The supplied find-sale documentation establishes:

- successful `200` response as a top-level transaction object;
- provider transaction `id` integer;
- `amount`, `paymentMethod`, `status`, `paidAt`, `externalRef`;
- `pix` string described by the provider as the Pix key or code used in the transaction.

A29 intentionally preserves the query `pix` string as `providerPixValue`. It does not call it `copyAndPaste`, `brCode`, `emv` or `qrCode` because that stronger semantic is not proven by the evidence.

## Formal RED

RED head:

`be50ec5a280867ac24e0ba5331c5c9669875ce74`

Application workflow:

`33822220854`

Application-contracts job:

`100867151352`

RED outcome:

- dependency install: PASS;
- typecheck: PASS;
- build: PASS;
- application tests: **412 total / 405 PASS / exactly 7 FAIL**;
- all prior A1-A28 tests: PASS;
- A29 architecture/artifact guard: PASS;
- A29 no-live-adapter/no-public-export/no-A10 guard: PASS.

The seven intended failures were exactly:

1. absent `MAGICPAY_RESPONSE_QUERY_EVIDENCE`;
2. absent `pix.expiresInDays` serialization;
3. absent `normalizeMagicPayPaymentStatus`;
4. absent `parseMagicPayCreateResponse`;
5. absent `parseMagicPayCreateErrorResponse`;
6. absent `buildMagicPayTransactionQueryRequest`;
7. absent `parseMagicPayTransactionQueryResponse`.

No unrelated regression was used as RED evidence.

## GREEN implementation

Implementation head:

`a5ca665501a5e8c68f7e4902ffc36153ecacd185`

Application workflow:

`33822375392`

Application-contracts job:

`100867618596`

Runtime-database-acceptance job:

`100867618738`

GREEN outcome:

- install: PASS;
- typecheck: PASS;
- build: PASS;
- application contracts: **412 / 412 PASS**;
- runtime-database acceptance: PASS;
- K7: PASS;
- A14: PASS;
- A18: PASS;
- A1-A9 real database runtime acceptance: PASS.

## Implemented behavior

`packages/providers/src/magicpay.ts` now adds, without changing A28's exact frozen metadata:

- `MAGICPAY_RESPONSE_QUERY_EVIDENCE`;
- optional positive-int32 `pix.expiresInDays` request serialization;
- `normalizeMagicPayPaymentStatus` with only the documented vocabulary;
- `parseMagicPayCreateResponse`;
- `parseMagicPayCreateErrorResponse`;
- `buildMagicPayTransactionQueryRequest`;
- `parseMagicPayTransactionQueryResponse`.

Status normalization is deliberately restricted to:

```text
waiting_payment -> pending
pending         -> pending
paid            -> paid
refused         -> failed
refunded        -> refunded
chargedback     -> disputed
```

Unknown values fail closed as unrecognized provider status.

## Preserved safety boundaries

A29 does not:

- expose `createMagicPayAdapter`;
- export MagicPay through `packages/providers/src/index.ts`;
- register MagicPay in A10;
- bind MagicPay monetary traffic to A11;
- send a payable Pix request;
- infer provider idempotency from `externalRef`;
- retry ambiguous monetary creation;
- treat a documented `400` as proof that execution did not occur;
- trust MagicPay postbacks;
- implement withdrawal, refund or anticipation.

## Explicit non-claims / remaining evidence

A29 does not prove:

- internal fields of the successful create-response `pix` object;
- canonical Pix copy-and-paste/EMV semantics;
- provider create idempotency semantics;
- ambiguous-create recovery after timeout/connection loss;
- provider error execution certainty;
- Sandbox/homologation environment classification;
- authenticated provider reachability/credential proof;
- webhook authentication/signature/replay identity;
- explicit provider rate limits;
- Production readiness.

Retained-provider Production authority remains zero.
