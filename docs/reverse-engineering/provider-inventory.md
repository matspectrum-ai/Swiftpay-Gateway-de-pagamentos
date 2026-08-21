# Legacy SwiftPay — Pix Provider Inventory

Status: Adapter layer audited; provider webhook/model/client details remain in progress.

Legacy source: `SwiftPay-Prod/swiftpay---Prod`

## Purpose

Capture the actual provider-specific knowledge currently embedded in SwiftPay before choosing the V2 orchestration strategy.

The legacy abstraction is intentionally small:

```text
IAcquirerService
├── GeneratePixAsync
├── GetPixStatusAsync
└── WithdrawAsync
```

That abstraction is useful. The implementations, however, prove that providers do not share one uniform contract.

## Provider matrix

| Provider | Primary credentials observed | Pix In | Status polling | Pix Out | Amount unit observed | Customer-data behavior | Initial V2 treatment |
|---|---|---:|---:|---:|---|---|---|
| Accithus | `publicKey`, `secretKey` | yes | yes | yes | integer cents | synthesizes name/email and valid CPF when missing | PORT KNOWLEDGE; remove synthetic identity defaults |
| ActivePayments | `publicKey`, `secretKey`; optional withdrawal secret | yes | yes | yes | **decimal BRL** (`cents / 100m`) | explicitly requires customer name + CPF/CNPJ for Pix | PORT KNOWLEDGE; explicit requirements are a good model |
| AkkadPag | `publicKey`, `secretKey`; `withdrawalKey` for Pix Out | yes | yes | yes | integer cents | fills name/email/phone/document with placeholder values | PORT KNOWLEDGE; fix contracts/security semantics |
| Bankizi | `clientId`, `clientSecret` OAuth | yes | yes | yes | integer cents | payer object optional | PORT KNOWLEDGE; preserve token/id quirks |
| Coldfy | `secretKey`, `companyId` | yes | yes | yes | integer cents | synthesizes email/phone/valid CPF | PORT KNOWLEDGE; require real fields when provider needs them |
| FlevoPay | `secretKey` | yes | yes | **no** | integer cents | uses placeholder name/email/phone/document | PORT KNOWLEDGE; capability must state no Pix Out |
| HeartPay | `apiKey` | yes | yes | yes | integer cents | deterministic fallback names/email/phone + generated valid CPF | PORT KNOWLEDGE; remove hidden synthetic identity |
| HunterPay | `apiKey`; optional `companyId` | yes | yes | yes | integer cents | hard-coded fallback CPF/phone + generated local email | PORT KNOWLEDGE; remove hidden defaults |
| IHubBanking | `secretKey` | yes | yes | yes | integer cents | placeholder name/email/CPF/phone when absent | PORT KNOWLEDGE; preserve identifier lookup nuance |
| MagicPay | `apiKey` | yes | yes | yes | integer cents | payer object optional | PORT KNOWLEDGE |
| Pluggou | `publicKey`, `secretKey` | yes | yes | yes | integer cents | synthesizes name/email/phone/valid CPF | PORT KNOWLEDGE; remove hidden defaults |
| Rapdyn | `token` | yes | yes | yes | integer cents | synthetic customer data plus fallback delivery address | PORT KNOWLEDGE; make required delivery/customer contract explicit |

`PORT KNOWLEDGE` does not mean copy the legacy class. It means preserve confirmed external-provider behavior in provider conformance tests and implement it behind the selected V2 provider boundary.

## Provider-specific observations

### Accithus

Legacy path:

`swiftpay-api-payment/Services/Acquirers/AccithusService.cs`

Observed behavior:

- Basic-like auth header derived from public/secret keys.
- Pix create via `/v1/transactions`.
- Canonical transaction response can use `TxId` or `Id`.
- Status exposes end-to-end id and paid timestamp.
- Pix Out supported through `/v1/withdrawals`.
- Payout ID is passed as a stable request identity to the client call.
- Pix-key type is normalized to cpf/cnpj/email/phone/evp.
- Missing document may cause generation of a valid synthetic CPF.
- Missing email is synthesized under a SwiftPay-controlled domain.

V2 implication:

Provider input requirements must be declared explicitly. A fake person/document must not be generated merely to make the provider call succeed.

### ActivePayments

Legacy path:

`swiftpay-api-payment/Services/Acquirers/ActivePaymentsService.cs`

Observed behavior:

- Requires `publicKey` + `secretKey`.
- Pix creation rejects missing customer name or document before provider call.
- Provider amount is sent in decimal BRL, converting from SwiftPay cents with `amount / 100m`.
- Pix Out also converts cents to decimal BRL.
- Withdrawal may use an additional `withdrawalSecret`.
- Phone Pix keys are normalized before payout.

V2 implication:

Provider amount unit must be a typed capability/adapter concern. The canonical SwiftPay domain remains integer cents.

### AkkadPag

Legacy path:

`swiftpay-api-payment/Services/Acquirers/AkkadPagService.cs`

Observed behavior:

- Pix In requires public + secret keys.
- Pix Out additionally requires `withdrawalKey`.
- Pix create uses `/transactions` with an item list and customer document object.
- Provider response id is reused as canonical provider payment id and legacy tx id.
- Status polling exposes end-to-end id and paid timestamp.
- Pix Out uses `/transfers`.
- Pix-key type inferred as CPF/CNPJ/EMAIL/PHONE/EVP.
- Missing customer values are replaced by placeholder values.
- Legacy `WithdrawAsync` reports `Success = true` only when the mapped status is already `Completed`; a valid provider `Processing` status therefore returns `Success = false` with a rejection-like error message. This semantic inconsistency must **not** be copied into V2.

#### Application-layer webhook authentication finding

Legacy group:

`swiftpay-api-payment/EndpointsGroups/Acquirers/AkkadPagGroup.cs`

Observed:

- group is `AllowAnonymous()`;
- unlike the other audited provider groups, it does not register `AcquirerWebhookAuthPreProcessor`;
- the alternative `AcquirerWebhookAuthMiddleware` exists but `UseSwiftPayPipeline()` does not register `UseAcquirerWebhookAuth()`;
- code search shows the preprocessor explicitly registered on 11 provider groups, including FlevoPay and Rapdyn.

Therefore the current application code does not route AkkadPag webhooks through the standard provider-authentication layer used by the other providers.

Caveat: infrastructure outside the application (reverse proxy, network allowlist, provider-side secret URL, etc.) has not yet been audited. This finding is specifically about the application-layer path.

V2 requirement:

Every inbound provider webhook must have an explicit provider-specific authentication policy and a fail-closed test. `AllowAnonymous` at the framework level is acceptable only when a mandatory verified provider-auth boundary runs before handler logic.

### Bankizi

Legacy path:

`swiftpay-api-payment/Services/Acquirers/BankiziService.cs`

Observed behavior:

- OAuth client credentials (`clientId`, `clientSecret`).
- Access token cached in memory.
- A process-local semaphore avoids concurrent token refreshes.
- Refresh buffer is 300 seconds.
- Pix create sends generated `txId`, amount in cents and expiration in seconds.
- Payer info is optional.
- Status polling extracts the first Pix receipt item for end-to-end/payer fields.
- Pix Out supported with a specially formatted uppercase provider tx id: `PAYOUT{uuid}` capped to provider constraints.

V2 implication:

Token lifecycle belongs inside the provider adapter/orchestrator. Process-local caching must not become a correctness dependency in horizontally scaled execution.

Potential audit item:

Validate behavior when provider token lifetime is less than or close to the hard-coded 300-second refresh buffer.

### Coldfy

Legacy path:

`swiftpay-api-payment/Services/Acquirers/ColdfyService.cs`

Observed behavior:

- Requires `secretKey` + `companyId`.
- Pix is created as a transaction with customer, item, metadata and postback.
- Provider expiration is modeled in days; legacy converts requested minutes to `ceil(minutes / 1440)`, clamped to 1–7 days.
- Provider returns EMV string rather than a QR image.
- Pix Out supported via cashout endpoint and stable payout request identity.
- Missing customer values are synthesized, including valid CPF and fallback phone.

V2 implication:

Expiration capability must be provider-aware. The public API can accept a desired expiration, but the persisted payment must snapshot the effective provider expiration actually used.

### FlevoPay

Legacy path:

`swiftpay-api-payment/Services/Acquirers/FlevoPayService.cs`

Observed behavior:

- Requires `secretKey`.
- Reference uses external id when available, otherwise generated tx id.
- Create endpoint conceptually `/transaction`.
- Provider transaction id becomes both provider payment id and legacy tx id.
- QR string is used as both QR/copy-and-paste representation.
- Status polling supported.
- Health check queries seller and caches result for 30 seconds.
- Pix Out is explicitly unsupported.
- Missing customer values are replaced with placeholder values.

V2 requirement:

Provider capabilities must explicitly state `supports_pix_out = false` rather than discovering this only after attempting a payout.

### HeartPay

Legacy path:

`swiftpay-api-payment/Services/Acquirers/HeartPayService.cs`

Observed behavior:

- Requires `apiKey`.
- Base URL normalization rewrites a legacy HeartPay host to a canonical host.
- Pix create uses a provider correlation id with minimum/shape assumptions.
- Pix Out supported with payout correlation id derived from SwiftPay payout ID.
- Fallback customer identity is synthesized when absent.
- Provider API compatibility logic exists for legacy/canonical base URL shapes.

V2 implication:

Base URL normalization and correlation-id constraints are provider conformance behavior and should receive tests if HeartPay is retained.

### HunterPay

Legacy path:

`swiftpay-api-payment/Services/Acquirers/HunterPayService.cs`

Observed behavior:

- Requires `apiKey`; `companyId` is optionally passed.
- Legacy host is rewritten to the current Hunter subdomain/function host.
- Pix create includes customer, product/item and postback.
- Provider expiration is modeled in days (1–7).
- Pix Out supported through withdrawal/cashout endpoint.
- Fallback customer document is a hard-coded CPF; fallback phone and local email are also synthesized.

V2 implication:

Do not preserve hard-coded identity fallback. Provider schema must say which fields are mandatory and validation must happen before external execution.

### IHubBanking

Legacy path:

`swiftpay-api-payment/Services/Acquirers/IHubBankingService.cs`

Observed behavior:

- Requires `secretKey`.
- Pix create uses a generated tx id plus external id.
- Missing customer CPF/phone values are replaced by zeros; email is generated under `securetransaction.com.br`.
- Status polling first queries provider by `externalId`, then retries by `id` when not found.
- Pix Out supported.
- Payout external id is derived from SwiftPay payout UUID.
- Webhook URL is only built when a webhook token exists and includes that token via the legacy webhook URL helper.

V2 implication:

Provider identifier model should distinguish at least:

- SwiftPay payment id;
- merchant external/idempotency reference;
- provider payment id;
- provider tx id/end-to-end id;
- provider-specific lookup reference when needed.

Do not overload one string called `txId` for all of these concepts.

### MagicPay

Legacy path:

`swiftpay-api-payment/Services/Acquirers/MagicPayService.cs`

Observed behavior:

- Requires `apiKey`.
- Pix create supports optional payer object.
- SwiftPay-generated tx id is sent as provider external reference.
- Provider response id is kept separately from legacy tx id.
- Pix Out supported through transfer endpoint.
- Payout external reference is derived from payout UUID.
- Provider webhook authentication infrastructure contains a MagicPay-specific HMAC branch using `X-Signature`.

V2 implication:

This provider is a useful example of why provider payment id and client correlation id must remain separate.

### Pluggou

Legacy path:

`swiftpay-api-payment/Services/Acquirers/PluggouService.cs`

Observed behavior:

- Requires `publicKey` + `secretKey`.
- Pix create sends amount in cents and buyer structure.
- Provider returns EMV string; no QR image is required.
- Pix Out supported.
- Missing buyer identity/contact values are synthesized, including a generated valid CPF.

V2 implication:

Same explicit-customer-contract requirement as above.

### Rapdyn

Legacy path:

`swiftpay-api-payment/Services/Acquirers/RapdynService.cs`

Observed behavior:

- Requires a `token`.
- Pix create includes customer, delivery address and product list.
- When not configured, legacy supplies fallback delivery address values (São Paulo / generic address).
- Customer email/phone/document may also be synthesized.
- CPF/CNPJ and phone values are formatted for provider-specific request shapes.
- Pix Out supported.
- Pix keys are formatted differently by key type.
- Processing or completed Pix Out statuses are considered successful execution acceptance.

V2 implication:

If Rapdyn is retained, delivery/address requirements must be modeled as provider requirements rather than silently fabricating a delivery destination.

## Cross-provider findings

### 1. The adapter boundary is worth keeping conceptually

A small provider interface is preferable to leaking 12 APIs across the application.

However the V2 interface should be capability-oriented and more precise than the legacy one.

Candidate conceptual shape:

```text
PixProvider
├── capabilities
├── createCharge(input, stableReference)
├── getCharge(reference)
├── verifyAndNormalizeWebhook(rawRequest)
└── createPayout(input, stableReference)   # only when supported
```

Do not finalize this interface until the webhook audit is complete.

### 2. Provider capabilities differ materially

Capabilities that must be explicit include:

- Pix In support;
- Pix Out support;
- status polling support;
- required customer fields;
- accepted amount unit;
- expiration granularity/range;
- supported Pix key types;
- provider/client idempotency support;
- webhook authentication mechanism;
- webhook transaction vs payout event types;
- submerchant/onboarding requirement where applicable.

### 3. Canonical money remains cents

Only adapters may transform from canonical integer cents to provider-specific units. ActivePayments is concrete evidence that at least one provider expects decimal BRL while most audited implementations send integer cents.

Conversions require exact tests.

### 4. Identity synthesis should be removed

Legacy integrations frequently create fake or placeholder customer identity data.

V2 default rule:

- if provider does not require a field, omit it;
- if provider requires it, validate real input;
- if a legal/product decision permits a platform-controlled substitute, that behavior requires an explicit provider-specific ADR/contract and must never masquerade as a real customer identity.

### 5. One `txId` is not enough as a domain model

The audit already shows providers use different identifiers for:

- client/external reference;
- provider payment/charge id;
- provider transaction id;
- Pix txid;
- end-to-end id;
- payout/transfer id.

V2 should persist these as separate typed/semantic fields or provider-attempt attributes, not overload a single identifier.

### 6. Payout capability is not universal

FlevoPay explicitly has no withdrawal support while the majority of other current adapters do.

Provider routing for payouts must therefore be capability-aware and cannot blindly reuse the Pix-In provider.

### 7. Provider expiration is heterogeneous

Examples:

- seconds/minutes-style providers;
- Coldfy/HunterPay convert requested expiration to whole days 1–7;
- provider may return its own effective expiration.

V2 must store effective expiration returned/accepted by the provider rather than assuming requested expiration equals actual expiration.

### 8. Webhook authentication must fail closed

The standard legacy preprocessor supports provider-configured modes including token, IP, Token+IP and HMAC, with special handling for HeartPay and MagicPay.

Code search found the standard preprocessor explicitly registered in 11 provider groups. AkkadPag is the current exception identified in this audit.

V2 should make webhook verification part of the provider contract so an endpoint cannot exist without a declared verification policy.

## Native adapters vs Hyperswitch — implications from the audit

The existing connector surface is not large in abstraction terms: three core operations plus provider-specific webhooks/clients.

The actual migration cost is in provider knowledge:

- 12 credential shapes;
- amount-unit quirks;
- identifier semantics;
- request requirements;
- status vocabularies;
- webhook payload/authentication behavior;
- payout differences;
- production compatibility fixes.

Hyperswitch is beneficial only if it meaningfully absorbs these retained-provider responsibilities. If the providers required for V2 need custom Hyperswitch connectors anyway, a native Pix-only adapter layer may remain simpler.

This ADR cannot be closed until:

1. retained production provider set is identified;
2. each retained provider webhook/client behavior is fully audited;
3. current Hyperswitch connector coverage is verified;
4. custom connector effort is compared with native adapter effort;
5. payout orchestration is included in the comparison.

## Remaining provider audit

Adapter source review is complete for all 12 current `AcquirerType` implementations.

Still required:

- client implementation + DTO/schema review for retained providers;
- every status converter mapping;
- every transaction webhook model/handler;
- every withdrawal webhook model/handler;
- provider group authentication registration;
- production/sandbox credential schema/configuration;
- submerchant/onboarding dependencies;
- recent provider-specific production fix history;
- explicit active/retired provider decision;
- provider conformance test corpus for V2.