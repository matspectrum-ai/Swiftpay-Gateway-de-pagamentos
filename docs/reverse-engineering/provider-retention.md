# Provider Retention — SwiftPay V2 Initial Scope

Status: **FROZEN for the initial release**

Date: 2026-08-13
Legacy revision audited: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Decision

SwiftPay V2 will initially support exactly two payment processors:

1. **AkkadPag**
2. **FlevoPay**

No other legacy processor is in the active V1 implementation matrix.

This is a product-scope decision. The previous engineering ranking was useful to expose protocol risks, but it is no longer a provider-selection recommendation.

## Active capability matrix

| Provider | V1 status | Pix In | Status / recovery lookup | Pix Out | Refund | V1 note |
|---|---|---:|---:|---:|---:|---|
| **AkkadPag** | **RETAIN** | yes | yes | yes | **must be proven by retained-provider deep audit before enabling** | Primary bidirectional candidate. Webhook authentication and payout `Processing` semantics must be corrected, not copied. |
| **FlevoPay** | **RETAIN** | yes | yes | **no in audited legacy implementation** | **must be proven by retained-provider deep audit before enabling** | Inbound Pix provider. V1 capability metadata must explicitly reject Pix Out. |

`RETAIN` means SwiftPay will implement and maintain a native thin adapter for that provider. It does not mean every optional operation is automatically enabled.

Capabilities are operation-specific and fail closed. If a capability has not passed its conformance contract, the router must treat it as unsupported.

## Explicitly deferred processors

The following legacy processors are **not part of the initial SwiftPay V2 runtime**:

- Accithus
- ActivePayments
- Bankizi
- Coldfy
- HeartPay
- HunterPay
- IHubBanking
- MagicPay
- Pluggou
- Rapdyn

Their legacy audit remains useful historical knowledge, but no V1 adapter, credential surface, webhook endpoint, routing branch, provider-specific migration or test fixture should be added for them.

Reintroducing any deferred processor requires a new explicit scope decision plus the same conformance gate required for AkkadPag/FlevoPay.

## Why this changes the architecture

The provider layer is now deliberately small:

```text
PaymentOrchestrator
  -> ProviderRouter
      -> AkkadPagAdapter
      -> FlevoPayAdapter
```

There is no need for a general-purpose twelve-provider migration framework.

The router remains capability-oriented so that provider choice never implies unsupported behavior. In particular:

```text
Pix In
  -> AkkadPag OR FlevoPay, subject to routing policy and health

Pix Out
  -> AkkadPag only, unless a future audited FlevoPay contract proves support

Refund
  -> disabled per provider until exact execution/recovery semantics are proven
```

Provider routing changes funding location, not merchant ownership or ledger semantics.

## Retained-provider risks that must be closed

### AkkadPag

Confirmed legacy facts:

- Pix In uses `publicKey` + `secretKey`;
- Pix Out additionally uses `withdrawalKey`;
- Pix create uses `/transactions`;
- Pix Out uses `/transfers`;
- status polling exists;
- legacy code fabricates placeholder customer data when fields are missing;
- legacy `WithdrawAsync` treats a valid provider `Processing` state as unsuccessful/rejection-like;
- the AkkadPag webhook group is the known exception that did not register the standard application-layer provider authentication preprocessor.

V2 requirements before the adapter can be production-enabled:

1. exact request/response DTO contract;
2. exact amount and expiration semantics;
3. stable client/provider identifiers for create and payout;
4. explicit customer-field requirements with no hidden fake identity;
5. status normalization including `Processing` as non-terminal when appropriate;
6. fail-closed webhook verification;
7. no blind retry of monetary POSTs;
8. `execution_unknown` recovery for ambiguous transport/provider outcomes;
9. payout idempotency/deduplication evidence before automatic retry is ever allowed;
10. refund capability disabled until exact execution identity and recovery are proven.

### FlevoPay

Confirmed legacy facts:

- requires `secretKey`;
- Pix In is supported;
- status polling is supported;
- client reference prefers merchant external id and otherwise uses a generated tx id;
- provider transaction id is returned and persisted;
- QR string is usable as Pix copy-and-paste data;
- seller/health lookup exists and legacy caches it briefly;
- Pix Out is explicitly unsupported;
- legacy code supplies placeholder customer values.

V2 requirements before the adapter can be production-enabled:

1. exact create/status DTO and endpoint contract;
2. exact provider reference semantics and recovery lookup order;
3. explicit real-customer requirements, with no placeholder identity;
4. fail-closed webhook verification and normalized event identity;
5. no blind retry of Pix-create POSTs;
6. `execution_unknown` recovery for ambiguous create outcomes;
7. capability metadata must expose `supports_pix_out = false`;
8. payout router must reject FlevoPay before any external request;
9. refund capability disabled until an exact supported provider contract is proven.

## Retry and uncertainty policy

AkkadPag and FlevoPay used plain `AddHttpClient` in the audited legacy system, unlike ten other providers that inherited a shared retry handler. V2 still does not infer safety from that fact.

Rules for both retained providers:

- read-only GET/status calls may use bounded retry when semantically safe;
- Pix-create, payout and refund POSTs are never blindly transport-retried;
- a timeout, connection reset, lost response, ambiguous 5xx or crash after possible transmission produces an unresolved `ProviderAttempt`;
- unresolved attempts enter recovery using provider query/webhook evidence;
- a new monetary attempt is allowed only when the previous attempt is authoritatively non-executed or a provider idempotency contract makes replay safe.

## Provider boundary

Target interface remains small and capability-oriented:

```text
PixProvider
├── capabilities()
├── createCharge(input, attempt)
├── recoverCharge(attempt)
├── getCharge(reference)
├── verifyAndNormalizeWebhook(rawRequest)
├── createPayout(input, attempt)   # AkkadPag only initially
├── recoverPayout(attempt)         # AkkadPag only initially
├── createRefund(input, attempt)   # disabled until proven
└── recoverRefund(attempt)         # disabled until proven
```

Public SwiftPay contracts never expose provider-specific DTOs or credentials.

## Conformance gate

Before either adapter is production-enabled, tests must cover at minimum:

- credential/config validation;
- canonical cents -> provider amount mapping;
- missing required customer data without synthetic identity;
- requested/effective expiration;
- create success and deterministic identifier persistence;
- provider 4xx;
- provider 5xx;
- timeout/connection-reset ambiguity;
- recovery/status lookup;
- duplicate and out-of-order webhook delivery;
- invalid/missing webhook authentication;
- canonical status mapping;
- provider-field non-leakage into public API;
- environment isolation;
- capability rejection before unsupported operations are attempted.

For AkkadPag payout additionally:

- stable payout request identity;
- `Processing` is not converted into definitive failure;
- duplicate/ambiguous payout execution behavior;
- unknown result keeps merchant funds blocked;
- authoritative success/failure resolves exactly once.

For FlevoPay:

- a Pix Out request is rejected locally as unsupported and creates zero provider-side traffic.

## Revisit rule

Adding a third processor is not an implementation detail. It requires an explicit product/architecture decision and a complete provider conformance contract.