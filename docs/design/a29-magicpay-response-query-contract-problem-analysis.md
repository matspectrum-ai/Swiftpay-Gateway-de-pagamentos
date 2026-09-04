# SwiftPay V2 — A29 MagicPay Response + Query Contract — Problem Analysis

Status: Problem Analysis
Date: 2026-09-03 (America/Santarem)
Branch: `agent/a29-magicpay-response-query-contract`

## Problem

A28 established MagicPay's provider-owned base URL, Basic authentication, integer-centavo request model, Pix create route, query route and safe read-only primitives, but intentionally stopped before response normalization because the provider guide available at that time did not expose the exact successful Pix-create schema or query envelope.

On 2026-09-03, provider-owned MagicPay documentation screenshots were supplied for:

- `https://app.dashboardmagicpay.com/docs/sales/create-sale`
- `https://app.dashboardmagicpay.com/docs/sales/find-sale`

The screenshots are not committed because browser chrome and local context are not repository evidence. Their byte-level SHA-256 digests are recorded instead.

Ordered screenshot SHA-256 manifest:

1. `5ad4cd92cd5a654fec57f3c45431a20a0b9e3787cd5f5e23126b75ef7bbff148`
2. `d720b951667468ec9141f7c0b3fbad487b3405d423aa4b50ff4ae2c0ccf02814`
3. `5aec15cfa73555566938614f8a58db2f47be8af8905b922edfcbce3fb1a5841c`
4. `c5878ba3973df7e3bf88b5eeff3853e74d2c142c7599b3d27f5070935ef4af3e`
5. `eb85215e9e2703a79dcbc8b6b0c1949d053bb599bc6bb2ad339b63cf35b72183`
6. `23f40be57787d5eac0bcd3af5db88a74df5b07597e44d9d830b506553f23ca77`
7. `b65fda0fa784eafdb5c7a60b362eae96a42e74151d81e005bfaafcf249346be4`
8. `4bca878869114e4e48af6f076fe5379c737b9ecc91b0490522c2079262c49338`

The SHA-256 of the newline-delimited ordered digest manifest is:

`8838db6276152af9d43d16ce71fa32cb9310b01f46f10c20897dea668d2f6833`

No provider credential appears in these repository artifacts.

## Newly proven create-sale facts

MagicPay documents a successful `200` response as a transaction object with top-level fields including:

- `id` integer — unique transaction identifier;
- `amount` integer — transaction amount in cents;
- `currency` string;
- `paidAmount` integer;
- `refundedAmount` integer;
- `companyId` integer;
- `installments` integer;
- `paymentMethod` string;
- `status` string, with documentation examples including `pending`, `paid`, `refunded`, `refused`;
- `postbackUrl` string;
- `metadata` string;
- `traceable` boolean;
- `secureId` string;
- `secureUrl` string;
- `createdAt` string;
- `updatedAt` string;
- `ip` string;
- `externalRef` string;
- `authorizationCode` string;
- `basePrice` string;
- `interestRate` string;
- `customer` object;
- `fee` object;
- `pix` object;
- `boleto` string;
- `card` string;
- `shipping` object;
- `refusedReason` string;
- `items` array of objects;
- `splits` array;
- `refunds` array;
- `delivery` object;
- `payer` string;
- `threeDS` object.

The nested fields of the successful response's `pix` object were **not** expanded in the supplied evidence and therefore remain unproven.

MagicPay also documents the create-sale `400` body as:

- `code` integer, documented default `400`;
- `message` string, documented default `Bad Request`.

This error shape does not establish monetary execution certainty. A later live adapter MUST NOT reinterpret every provider `400` as proof that no transaction was created unless the provider contract explicitly establishes that guarantee.

## Newly proven Pix request option

The create-sale request `pix` object documents:

- `expiresInDays` int32 — number of days until the Pix expires.

The provider documentation does not establish an allowed min/max range beyond the int32 type. A29 may serialize a positive int32 value when explicitly supplied and otherwise omit the object.

## Newly proven find-sale facts

The provider documentation for `GET /transactions/{id}` exposes a successful `200` transaction object with top-level fields including:

- `id` integer;
- `amount` integer;
- `refundedAmount` integer;
- `companyId` integer;
- `installments` integer;
- `paymentMethod` string;
- `status` string, with examples including `pending`, `paid`, `refunded`;
- `postbackUrl` string;
- `metadata` string;
- `traceable` boolean;
- `secureId` string;
- `secureUrl` string;
- `createdAt` string;
- `updatedAt` string;
- `paidAt` string;
- `ip` string;
- `externalRef` string;
- `customer` object;
- `card` object;
- `boleto` string;
- `pix` string, described by MagicPay as the Pix key or code used in the transaction;
- `shipping` string;
- `refusedReason` string;
- `items` array of objects;
- `splits` array of objects;
- `refunds` array;
- `delivery` string;
- `fee` object;
- `threeDS` object.

The query `pix` field is now proven to be a provider string, but the documentation wording does not prove that every nonblank value is specifically an EMV Pix copy-and-paste payload rather than another Pix key/code representation. A29 therefore preserves it as `providerPixValue` and does not relabel it as canonical `copyAndPaste`.

## Architectural scope decision required by ADR 0004

ADR 0004 froze the initial V1 runtime provider set to AkkadPag + FlevoPay and requires an explicit decision before adding a third provider.

The product direction now explicitly selects MagicPay for integration. A29 therefore accompanies a new architecture decision that admits MagicPay as a third provider candidate while preserving all existing activation gates.

This decision does **not** authorize provider traffic.

## A29 authority boundary

A29 is application-only and network-free.

Allowed:

- update MagicPay evidence metadata;
- serialize optional `pix.expiresInDays`;
- build a Basic-authenticated query request for `transactions/{id}`;
- normalize the documented create-sale response envelope;
- normalize the documented query response envelope;
- normalize only provider-documented status vocabulary;
- parse the documented create-sale `400` error shape without assigning execution certainty.

Forbidden:

- payable MagicPay Pix creation;
- `createMagicPayAdapter` live execution;
- MagicPay public provider-barrel export;
- A10 MagicPay activation/registration in this slice;
- A11 MagicPay monetary binding;
- automatic retry after create timeout/5xx/4xx;
- treating `externalRef` as provider idempotency;
- treating query `pix` as canonical copy-and-paste without stronger evidence;
- trusted MagicPay webhook transitions;
- withdrawal/refund/anticipation implementation.

## Status vocabulary

Provider-owned documentation currently establishes the following values across create/query/postback evidence:

- `waiting_payment`
- `pending`
- `paid`
- `refused`
- `refunded`
- `chargedback`

A29 canonical mapping is deliberately narrow:

- `waiting_payment`, `pending` -> `pending`
- `paid` -> `paid`
- `refused` -> `failed`
- `refunded` -> `refunded`
- `chargedback` -> `disputed`
- anything else -> unrecognized

A29 does not invent `expired`, `cancelled` or other MagicPay states.

## Remaining provider evidence after A29

Even after response/query normalization, Production authority must remain zero until later evidence closes:

1. exact nested successful create-response `pix` object fields or a provider sample proving canonical Pix copy-and-paste semantics;
2. idempotency/replay semantics for `externalRef` or another provider key;
3. ambiguous-create recovery after timeout/connection loss;
4. environment/Sandbox classification;
5. authenticated non-destructive provider proof from a working network path;
6. webhook authentication/signature and replay identity;
7. explicit rate limits;
8. deliberate A10/A11 activation bridge.

## Expected sequence

1. architecture decision admitting MagicPay as third provider candidate;
2. freeze A29 YAML spec and contract;
3. add fail-first application tests;
4. implement only pure request/response/query normalization;
5. capture GREEN evidence;
6. update `TODOS.md` and V1 readiness;
7. keep live provider authority at zero.
