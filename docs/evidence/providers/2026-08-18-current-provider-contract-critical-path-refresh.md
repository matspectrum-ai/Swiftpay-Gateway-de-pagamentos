# Current Provider Contract Critical-Path Refresh — 2026-08-18

Status: **EVIDENCE REFRESH / NO ACTIVATION AUTHORITY**

Purpose: refresh only provider-owned current public evidence relevant to the retained AkkadPag/AkadPay and FlevoPay critical path. This artifact does not authorize a network call, does not promote any A10 tuple and does not establish authenticated sandbox proof.

## Evidence classification rules

- Provider-owned current technical documentation may prove only the exact behavior it explicitly documents.
- Marketing copy may corroborate capability existence but cannot supply missing executable endpoint/authentication/recovery/webhook semantics.
- A current contract under a different product/brand/host does not prove lineage/equivalence with a retained historical adapter.
- A static provider-owned API-reference screenshot is stronger than generic marketing for visible fields/capabilities, but is not a substitute for a complete executable endpoint contract when paths/payloads/status/error/webhook semantics are not visible.
- No inference from brand similarity, domain similarity or endpoint naming may advance A10.

## AkadPay — current provider-owned public technical evidence

### Sources reviewed

- `https://painel.akadpay.com.br/docs/api-pix`
- `https://painel.akadpay.com.br/docs/api-pix/receive`
- `https://painel.akadpay.com.br/docs/api-pix/send`
- `https://painel.akadpay.com.br/docs/api-pix/webhooks`
- `https://akadpay.com.br/`

### Explicitly documented current behavior

PIX-IN:

- current technical endpoint: `POST https://painel.akadpay.com.br/api/wallet/deposit/payment`;
- request body carries `token` and `secret` plus amount/debtor/contact/payment-method/postback data;
- documented success returns `idTransaction`, Pix copia-e-cola QR payload and QR image data;
- split is optional and expressed through receiver client IDs and percentages.

PIX-OUT:

- current technical endpoint: `POST https://painel.akadpay.com.br/api/pixout`;
- request body carries `token`, `secret`, amount, Pix key/type, recipient identity, `idempotencyKey` and callback URL;
- `idempotencyKey` is documented as 8..100 characters and unique per withdrawal;
- repeating the same idempotency key with the same data is explicitly documented to return the existing transaction without sending another Pix;
- current success projection includes `id`, `reference_id`, `idempotencyKey`, amount, Pix key/type, `withdrawStatusId`, `createdAt` and `updatedAt`;
- provider documentation currently shows a 2026-08-15 timestamp example, supporting that this page is current material rather than only historical retained evidence.

Webhooks:

- PIX-IN callback is bound to the request callback URL and includes status, `idTransaction` and transaction type;
- PIX-OUT callback includes status, `idTransaction`, `reference_id`, `idempotencyKey` and transaction type;
- PIX-OUT events may be replayed; current docs explicitly direct consumers to use `idempotencyKey` or `reference_id` for once-only processing;
- completion/rejection after manual approval is documented as callback-producing behavior.

### Material gaps / contradictions

The current public Pix documentation navigation exposes introduction, receive, send and webhooks, but no provider-owned query/recovery endpoint is documented there. Therefore:

- exact current PIX-IN query/recovery semantics are not proven;
- exact current PIX-OUT query/recovery semantics are not proven beyond callback identifiers;
- status vocabulary is incomplete for safe normalization;
- rate-limit semantics are not proven;
- exact webhook cryptographic authentication/verification is not documented on the technical webhook page.

The AkadPay marketing homepage claims JWT-secured APIs and signed webhooks. The exact Pix technical pages instead show `token` + `secret` in request bodies and do not define a webhook-signature verification algorithm. Marketing claims are therefore retained only as corroborative/informative evidence and are not used to invent missing technical behavior.

### Retained AkkadPag lineage conclusion

No provider-owned current artifact found in this refresh establishes that AkadPay's current `painel.akadpay.com.br/api/...` contract is the contractual successor/equivalent of the retained historical `api.akkadpag.com/v1` Basic-Auth contract, or that historical credentials/identifiers/contracts are interchangeable.

Classification:

- current AkadPay PIX-IN create: **provider-owned current technical evidence captured, but not retained-AkkadPag lineage authority**;
- current AkadPay PIX-OUT create/idempotency: **provider-owned current technical evidence captured, but not retained-AkkadPag lineage authority**;
- current AkadPay query/recovery: **insufficient**;
- current AkadPay webhook replay identity: **partially proven**;
- current AkadPay webhook cryptographic authentication: **insufficient**;
- retained AkkadPag live authority: **blocked**.

No A10 state transition is authorized.

## FlevoPay — current provider-owned public evidence

### Source reviewed

- `https://flevopay.com.br/`

The current provider-owned homepage explicitly presents `api.flevopay.com/v1` as active and says integration is performed with API credentials.

The same current homepage embeds a provider-branded static `v1.0 API Reference` image. Visible API-reference text includes:

- an Introduction / authentication section;
- `Basic Base64(PUBLIC_KEY:SECRET_KEY)` authentication text;
- a `Formato dos Webhooks` section;
- `Dados da Empresa` (GET);
- PIX IN: `Buscar transação` (GET), `Criar transação` (POST), `Estornar transação` (POST);
- PIX OUT: `Criar saque` (POST), `Consultar saldo` (GET).

### Material consequence for the retained adapter

The retained historical FlevoPay evidence/adapter uses `X-API-Key`. The provider-owned current API-reference screenshot instead shows Basic credentials composed from `PUBLIC_KEY:SECRET_KEY`.

This is material current-contract drift. The historical adapter must not be treated as current-compatible merely because the provider/brand name is the same.

### Remaining gaps

The public homepage/screenshot does not expose enough exact technical detail to freeze an executable current adapter:

- exact request paths for the visible operations are not publicly readable from the evidence captured here;
- exact request/response schemas are not proven;
- exact status/error vocabulary is not proven;
- idempotency semantics are not proven;
- ambiguous-execution recovery order/identifiers are not proven;
- webhook payload, signature/authentication and replay contract are not proven;
- authenticated sandbox behavior is not proven.

Classification:

- current base API host: **provider-owned current evidence captured**;
- current authentication family: **provider-owned current evidence captured; materially different from retained historical adapter**;
- current capability surface: **partially evidenced by provider-owned API-reference screenshot**;
- executable current PIX-IN/PIX-OUT/query/recovery/webhook contract: **insufficient**;
- retained FlevoPay live authority: **blocked**.

No A10 state transition is authorized.

## Critical-path conclusion

This refresh improves the evidence base but does not close the production PSP gate.

What is now stronger:

1. AkadPay has current provider-owned executable create contracts for PIX-IN and PIX-OUT, including explicit PIX-OUT idempotency/replay identity.
2. FlevoPay's current provider-owned material demonstrates a current API v1 surface and indicates Basic `PUBLIC_KEY:SECRET_KEY` authentication, proving material drift from the retained historical `X-API-Key` adapter.

What remains mandatory before live retained-provider integration:

- provider-owned lineage/equivalence for AkkadPag→AkadPay, or an explicit reviewed decision to replace the retained lineage;
- complete current create + query/recovery semantics for the selected provider contract;
- exact current idempotency semantics for every monetary create path;
- exact webhook authentication/signature and replay contract;
- current status/error/rate-limit vocabulary;
- authenticated current sandbox acceptance;
- only then, a dedicated A5→A11 bridge Problem Analysis/spec/contracts/RED cycle;
- only after sandbox proof, deliberate applicable A10 transition to `sandbox_proven`.

Checked-in A10 live provider authority remains **zero**. No real provider call was made during this refresh.