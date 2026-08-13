# Provider Retention — Engineering Shortlist

Status: provisional engineering shortlist; commercial/production evidence still required

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Goal

Do not port all 12 legacy providers by default. Retain only providers whose Pix-in/Pix-out/refund contracts can be made deterministic and whose business value exceeds their maintenance cost.

This ranking is based on source-code/protocol evidence. It does not rank real approval rate, fees, uptime, support or current production volume.

## V2 retention gates

A retained Pix-in provider must have create, recovery/status lookup, authenticated webhook normalization, explicit customer requirements, amount/expiration semantics and a defined unknown-result path.

A provider used for Pix-out must additionally have a stable payout identity plus a proven provider-side idempotency/deduplication contract and deterministic recovery. A provider used for refunds must have a stable refund identity, request operation, provider event/reference and ambiguous-result recovery.

Provider capabilities are per operation: a provider may be valid for Pix-in but not Pix-out/refund.

## Cross-provider findings

Ten legacy clients use `AddAcquirerHttpClient`: ActivePayments, Bankizi, IHubBanking, Rapdyn, Coldfy, Pluggou, HunterPay, HeartPay, Accithus and MagicPay. That shared handler retries HTTP 5xx, transport errors and timeouts up to 3 times without checking HTTP method. AkkadPag and FlevoPay use plain `AddHttpClient`.

V2 must not copy this behavior. GET/read operations may retry; monetary POSTs do not receive blind transport retries. Ambiguous `createCharge`, `createPayout` or `createRefund` results enter recovery.

Exact code search for `Idempotency-Key`/`idempotencyKey` found explicit Pix-out keys only in:

- Accithus;
- Coldfy;
- HunterPay.

All three pass the stable SwiftPay `PayoutId`. This is positive evidence but still requires provider contract/conformance proof that the PSP honors the key.

No equivalent external idempotency header was observed for audited Pix-in creates. Stable external references are correlation identifiers, not assumed idempotency guarantees.

## Provisional tiers

### Tier A — prove first

**Accithus — CANDIDATE**

- Pix-in + polling + Pix-out.
- Explicit payout `Idempotency-Key` using `PayoutId`.
- Standard webhook-auth preprocessor path.
- Refund statuses recognized.
- Legacy synthetic name/email/CPF must be removed.
- Pix-in create has no observed external idempotency and inherits unsafe legacy retry.

**MagicPay — CANDIDATE**

- Simple API-key auth, Pix-in + polling + Pix-out.
- Optional payer object reduces checkout data friction.
- Provider payment ID and external correlation remain separate.
- Provider-specific HMAC verification via `X-Signature`.
- Concrete `POST /payment/{id}/refund` client method exists.
- Refund method is uncalled in production legacy and has no observed refund idempotency key.
- Payout deduplication through `ExternalRef` is not proven.

**Coldfy — CANDIDATE WITH FRICTION**

- Pix-in + polling + Pix-out.
- Explicit payout `Idempotency-Key` using `PayoutId`.
- Legacy fabricates email/phone/CPF.
- Expiration is whole-day based (1–7 days), not minute-granular.
- Pix-in external idempotency/refund execution not proven.

**HunterPay — CANDIDATE WITH COMPATIBILITY COST**

- Pix-in + polling + Pix-out.
- Explicit payout `Idempotency-Key` using `PayoutId`.
- Refund status/amount fields exist.
- Legacy fabricates CPF/phone/email, uses whole-day expiration, rewrites hosts and tries multiple Basic-auth variants.
- Pix-in external idempotency not proven.

### Tier B — unresolved; require operational justification

**ActivePayments** — clear real-customer validation and Pix-in/out, but decimal-BRL conversion, mandatory identity data, no observed payout idempotency header and unsafe legacy POST retry.

**Bankizi** — optional payer, Pix-in/out/polling and rich refund metadata, but OAuth/token complexity, no observed payout idempotency, unsafe legacy POST retry and a broken `RequestedRefund -> Processing -> terminal refund` legacy state path.

**IHubBanking** — Pix-in/out/polling with useful lookup fallback, but broad mandatory customer data, legacy placeholders, specialized identifier/webhook token semantics and no observed payout idempotency.

**Pluggou** — Pix-in/out/polling, but synthetic buyer data, no observed payout idempotency and no proven refund execution contract.

### Tier C — defer by default

**AkkadPag** — Pix-in/out exists, but legacy payout `Processing` semantics are inconsistent and it is the known provider group missing the standard application-layer webhook-auth preprocessor.

**HeartPay** — HMAC/timestamp webhook verification is positive, but customer identity is synthesized; partial-refund status can be normalized without the amount needed by the ledger path; payout idempotency is unproven.

**Rapdyn** — Pix-in/out exists, but legacy fabricates customer/delivery-address data; payload is more commerce-specific than the desired small Pix core; payout idempotency/refund execution unproven.

**FlevoPay** — Pix-in/polling only; Pix-out explicitly unsupported. Consider only as an inbound-only provider if conversion/fees/reliability justify it.

## Recommended proof order

Do not port all providers.

1. Prove Accithus or MagicPay end-to-end.
2. Prove the other if its real operational/commercial evidence is strong.
3. Add Coldfy/HunterPay only when their customer-data/expiration costs are acceptable.
4. Add any Tier B/C provider only for a measurable reason: conversion, reliability, fee, settlement/liquidity fit or merchant demand.

The exact first provider is not frozen by source code alone. Current credentials, contract, production relationship, fees, uptime and support quality can override this engineering order.

## V2 provider boundary

The legacy three-method interface is too vague. Target capability-oriented shape:

```text
PixProvider
├── capabilities()
├── createCharge(input, attempt)
├── recoverCharge(attempt)
├── getCharge(reference)
├── verifyAndNormalizeWebhook(rawRequest)
├── createPayout(input, attempt)   # capability gated
├── recoverPayout(attempt)
├── createRefund(input, attempt)   # capability gated
└── recoverRefund(attempt)
```

Each operation declares customer requirements, amount unit, expiration, stable correlation, provider idempotency evidence, recovery mechanism, webhook authentication, status mapping and unknown-result behavior.

## Provider conformance gate

Before a provider becomes `RETAIN`, tests must cover amount conversion, missing required customer data without synthetic identity, effective expiration, create success/4xx/5xx/timeout, ambiguous-result recovery, duplicate/out-of-order webhook, invalid webhook auth, status recovery, payout duplicate/ambiguous behavior when enabled, refund duplicate/ambiguous behavior when enabled, and provider-field non-leakage.

A provider is `RETAIN` only when both its engineering contract and its business/operational value are proven.