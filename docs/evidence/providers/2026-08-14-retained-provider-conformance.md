# Retained-provider conformance evidence — 2026-08-14

Status: evidence capture only; **not an activation or compatibility approval**.

This note records what can be proven today from the retained legacy adapter source and currently discoverable public provider material. It exists to prevent provider-specific reconciliation, routing or recovery behavior from being inferred from marketing copy or from a similarly named but technically different API.

## Decision rule

A public provider source is accepted as conformance evidence only when its provider identity and contract lineage can be tied to the retained SwiftPay adapter with sufficient confidence.

A matching brand name, marketing claim or similar Pix capability is not enough. Material changes in hostname, authentication, resource paths or request/response identity keep the integration `EVIDENCE_REQUIRED` until the provider confirms the relationship or a current authenticated sandbox proves it.

## Legacy retained adapter baseline

Legacy source commit audited: `f60a515d2bbfa6ed8142f46fa778fb27068a700d` in `SwiftPay-Prod/swiftpay---Prod`.

### AkkadPag legacy adapter

Source:

- `swiftpay-api-payment/Extensions/ServiceCollectionExtensions.cs`
- `swiftpay-api-payment/Clients/AkkadPag/AkkadPagClient.cs`

Observed retained contract:

- base URL: `https://api.akkadpag.com/v1/`;
- HTTP Basic authentication built from `publicKey:secretKey`;
- Pix-in create: `POST transactions`;
- Pix-in query: `GET transactions/{paymentId}`;
- Pix-out create: `POST transfers` plus `x-withdrawal-key`;
- Pix-out query: `GET transfers/{transferId}`;
- company details: `GET company/details`.

These details are the identity anchor for deciding whether newly discovered material actually describes the retained `AkkadPag` integration.

### FlevoPay legacy adapter

Source:

- `swiftpay-api-payment/Extensions/ServiceCollectionExtensions.cs`
- `swiftpay-api-payment/Clients/FlevoPay/FlevoPayClient.cs`

Observed retained contract:

- base URL: `https://app.flevopay.com.br/api/v1/`;
- authentication header: `X-API-Key`;
- Pix-in create: `POST transaction`;
- Pix-in query: `GET query?action=get_transaction&id={transactionId}`;
- seller query: `GET seller`;
- the audited adapter exposes no Pix-out operation.

## Public material discovered on 2026-08-14

### AkadPay public documentation

Public sources:

- `https://painel.akadpay.com.br/docs/api-pix`
- `https://painel.akadpay.com.br/docs/api-pix/receive`
- `https://painel.akadpay.com.br/docs/api-pix/send`
- `https://painel.akadpay.com.br/docs/api-pix/webhooks`
- `https://akadpay.com.br/`

The public documentation currently describes a product branded **AkadPay**, not `AkkadPag`, with a materially different contract:

Pix-in:

- `POST https://painel.akadpay.com.br/api/wallet/deposit/payment`;
- `token` and `secret` are shown in the JSON request body;
- response identity is `idTransaction`;
- callback URL is supplied in `postback`.

Pix-out:

- `POST https://painel.akadpay.com.br/api/pixout`;
- request includes `token`, `secret`, recipient data, `idempotencyKey` and `baasPostbackUrl`;
- documentation says `idempotencyKey` is unique per withdrawal and replaying the same key with the same data returns the existing transaction instead of sending another Pix;
- sample response includes `id`, `reference_id`, `idempotencyKey`, amount, Pix-key data and `withdrawStatusId: PendingProcessing`;
- documentation says a withdrawal can remain pending for administrative approval when automatic withdrawal is disabled.

Webhooks:

- Pix-in sample contains `status`, `idTransaction`, `typeTransaction`;
- Pix-out material states that the event may be resent and recommends `idempotencyKey` or `reference_id` for duplicate processing;
- the Pix-out sample includes `status`, `idTransaction`, `reference_id`, `idempotencyKey`, `typeTransaction`;
- the public webhook documentation visible on 2026-08-14 does **not** specify an authentication header/signature verification algorithm.

The AkadPay marketing site states that webhooks use signature validation and that APIs use JWT/robust authentication, but the public API pages above do not expose a concrete webhook-signature contract and show token/secret fields for the documented Pix endpoints. Marketing text is therefore not accepted as the authentication contract.

### Identity mismatch: AkkadPag != proven AkadPay

The discovered AkadPay material is **not accepted as conformance evidence for the retained AkkadPag adapter yet**.

Reasons:

- legacy hostname: `api.akkadpag.com`; discovered public hostname: `painel.akadpay.com.br`;
- legacy create/query resource family: `transactions`; public AkadPay Pix-in resource: `api/wallet/deposit/payment`;
- legacy payout resource family: `transfers`; public AkadPay payout resource: `api/pixout`;
- legacy authentication: HTTP Basic `publicKey:secretKey`; public examples put `token` and `secret` in JSON;
- no provider-owned source discovered during this pass proves that `AkkadPag` was renamed/migrated to this `AkadPay` API or that the two contracts are compatible.

Until provider ownership/rebrand/API-migration equivalence is proven, useful AkadPay facts such as withdrawal idempotency and `PendingProcessing` cannot be imported into the retained AkkadPag runtime contract.

### FlevoPay public material

Public source:

- `https://flevopay.com.br/`

Observed current public statements:

- the site references `api.flevopay.com/v1` as active for integrations;
- the site describes API-key based integration at a marketing level;
- an API reference image is labelled as containing Pix-in and Pix-out endpoints;
- the site advertises instant withdrawals.

However, this public page does not expose the exact route, request, response, idempotency, query/recovery, webhook-authentication or status contracts required by SwiftPay.

There is also a material lineage gap relative to the retained adapter:

- legacy base URL: `https://app.flevopay.com.br/api/v1/`;
- current marketing reference: `api.flevopay.com/v1`;
- legacy adapter uses `X-API-Key`, `POST transaction` and `GET query?action=get_transaction&id=...`;
- no current public technical page was discovered that confirms those exact endpoints or their replacements.

The marketing reference to Pix-out is also insufficient to change the frozen V1 capability rule. The retained adapter had no Pix-out operation, and no exact current Pix-out contract was discovered in this pass.

## Conformance matrix after this evidence pass

| Provider / question | Status | Evidence decision |
|---|---|---|
| AkkadPag provider identity / current API lineage | `EVIDENCE_REQUIRED` | No provider-owned evidence ties legacy `api.akkadpag.com` to public AkadPay contract. |
| AkkadPag Pix-in create recovery/idempotency | `EVIDENCE_REQUIRED` | No current retained-contract source found. |
| AkkadPag Pix-in authoritative query identity/statuses | `EVIDENCE_REQUIRED` | Legacy query exists; current retained-contract proof unavailable. |
| AkkadPag Pix-out idempotency/recovery | `EVIDENCE_REQUIRED` | Public AkadPay documents useful semantics, but equivalence to retained AkkadPag is unproven. |
| AkkadPag webhook authentication | `EVIDENCE_REQUIRED` | Public AkadPay webhook page exposes no concrete signature contract; marketing claim is insufficient. |
| AkkadPag rate limits | `EVIDENCE_REQUIRED` | Not found in accepted retained-provider evidence. |
| FlevoPay current Pix-in create contract | `EVIDENCE_REQUIRED` | Legacy contract exists; current public technical contract not found. |
| FlevoPay authoritative query/recovery identifier | `EVIDENCE_REQUIRED` | Legacy `transactionId` query exists; current provider contract not proven. |
| FlevoPay webhook authentication | `EVIDENCE_REQUIRED` | No current public technical webhook contract discovered. |
| FlevoPay statuses/rate limits | `EVIDENCE_REQUIRED` | No current technical reference discovered. |
| FlevoPay Pix-out capability | `EVIDENCE_REQUIRED` for any scope change | Marketing now references Pix-out, but no exact executable contract was found; V1 remains locally disabled. |

## I3b gate

This pass does **not** unlock provider-specific I3b comparison semantics.

In particular, SwiftPay still must not invent:

- what a missing provider record proves;
- which query/report source is authoritative for each provider;
- current stable correlation identifiers after provider/API migrations;
- provider fee/balance semantics;
- provider-specific terminal/non-terminal status mappings;
- webhook authentication or replay guarantees.

I3a remains useful and GREEN because it records already-normalized provider-authoritative facts without knowing how those facts were fetched. I3b provider-vs-SwiftPay comparisons that depend on provider coverage/absence/current identity remain gated until authenticated sandbox evidence or provider-owned current technical documentation is obtained.

## Required next evidence

For AkkadPag:

1. confirmation of the current provider-owned API hostname and whether `api.akkadpag.com/v1` is still valid;
2. if AkadPay is a successor/rebrand, an explicit migration/equivalence statement or sandbox proof mapping old to new resources;
3. current Pix-in create/query identity and idempotency/recovery behavior;
4. current Pix-out create/query identity, idempotency and unknown-result recovery behavior;
5. exact webhook authentication/signature algorithm and replay identity;
6. status vocabulary and rate limits.

For FlevoPay:

1. current technical documentation or authenticated sandbox proof for the API referenced by the public site;
2. exact create and query/recovery identifiers;
3. exact webhook authentication and replay identity;
4. status vocabulary and rate limits;
5. an exact Pix-out endpoint/identity/recovery contract before reconsidering the current Pix-out capability rule.
