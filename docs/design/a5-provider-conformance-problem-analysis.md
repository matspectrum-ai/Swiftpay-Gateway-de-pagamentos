# SwiftPay V2 — A5 Provider Conformance Fixtures — Problem Analysis

Date: 2026-08-16
Status: FROZEN PROBLEM ANALYSIS
Next artifact: `docs/specs/provider-conformance-v0.yaml`

## Problem statement

A1–A4 now prove a complete deterministic sandbox Pix lifecycle through authenticated create/get, paid evidence, exactly-once ledger posting, balance projection, durable merchant event creation and signed/retried merchant webhook delivery.

The next material production risk is no longer SwiftPay's internal state machine. It is the external PSP boundary.

SwiftPay V2 initially retains exactly two native providers:

1. AkkadPag;
2. FlevoPay.

The repository contains strong source evidence for the legacy adapters, but current production activation cannot be inferred from legacy code, marketing pages or similarly branded public APIs. Provider endpoints, authentication, idempotency, query/recovery identity, status vocabularies and webhook verification can change independently of SwiftPay.

A5 must therefore build a **network-free provider conformance layer** that separates what is proven from what remains unknown, freezes canonical adapter semantics, captures sanitized deterministic fixtures and prevents any live monetary request until the provider-specific activation evidence is strong enough.

A5 is not a live-provider integration milestone. It is the gate that makes a future live-provider integration safe to implement.

## Existing canonical decisions

### Provider scope is frozen

`docs/reverse-engineering/provider-retention.md` and ADR 0004 freeze the V1 provider set to:

```text
AkkadPag
FlevoPay
```

No other legacy provider receives a V1 adapter, credential surface, webhook route or provider-specific routing branch without a new explicit scope decision.

Initial capability intent remains:

```text
Pix In   -> AkkadPag or FlevoPay, once operation-level conformance is enabled
Pix Out  -> AkkadPag only, once payout conformance is enabled
Refund   -> disabled until exact execution/recovery semantics are proven
```

FlevoPay Pix Out remains locally unsupported despite current marketing references to Pix-out, because the retained adapter has no Pix-out implementation and no exact current technical contract has been accepted.

### Stable provider boundary already exists as a contract

`docs/contracts/native-pix-provider-adapter.md` freezes the cross-provider semantics that A5 must preserve:

- canonical money enters adapters as integer BRL centavos;
- provider-specific amount conversion is explicit and tested;
- customer requirements are declared; identity/contact data is never fabricated merely to satisfy a PSP;
- every monetary request carries a stable SwiftPay client reference when the provider contract supports one;
- external execution certainty is explicit;
- timeout/reset/lost response/ambiguous post-transmission outcomes become `execution_unknown` unless stronger provider evidence proves otherwise;
- monetary POSTs have no transparent retry;
- recovery is an explicit first-class operation;
- provider statuses are evidence, not canonical state by themselves;
- unknown provider statuses fail closed as unrecognized evidence;
- inbound provider events require provider-specific authentication before they can become trusted `ProviderEvent` evidence;
- unsupported capabilities fail locally before external I/O.

A5 does not redesign those invariants. It must prove that each retained-provider fixture maps into them without provider DTO leakage.

## Evidence hierarchy

Provider behavior is unusually sensitive to stale or ambiguous documentation. A5 freezes the following evidence precedence:

1. **current provider-owned technical documentation** that can be tied to the exact retained provider/API lineage;
2. **current authenticated sandbox evidence** captured without real money, with secrets redacted and reproducible request/response metadata;
3. **provider-owned written confirmation** of API lineage/migration or operation semantics;
4. **retained legacy adapter source** at the audited revision;
5. **public marketing material** only as discovery evidence, never as executable contract;
6. inference is never sufficient to enable an external monetary operation.

A lower-precedence source may document historical behavior but cannot override a contradictory higher-precedence current source.

Every provider fact in the A5 spec/fixtures must carry one of:

```text
proven_current
proven_legacy
inferred_non_authoritative
unknown
```

Only `proven_current` may independently unlock a production operation. `proven_legacy` may drive compatibility fixtures and adapter shape but leaves production activation blocked when current lineage is material.

## Evidence re-verified on 2026-08-16

### AkkadPag retained legacy identity

Accepted historical evidence from the audited legacy revision proves the retained adapter used:

```text
base URL: https://api.akkadpag.com/v1/
auth: HTTP Basic base64(publicKey:secretKey)
Pix-in create: POST transactions
Pix-in query: GET transactions/{paymentId}
Pix-out create: POST transfers
Pix-out query: GET transfers/{transferId}
company query: GET company/details
Pix-out extra credential: x-withdrawal-key
```

This is `proven_legacy`, not current production approval.

### Public AkadPay material is a distinct unproven lineage

Current provider-owned public pages re-checked on 2026-08-16:

- `https://akadpay.com.br/`
- `https://painel.akadpay.com.br/docs/api-pix/receive`
- `https://painel.akadpay.com.br/docs/api-pix/send`
- `https://painel.akadpay.com.br/docs/api-pix/webhooks`

They currently describe **AkadPay**, including:

```text
Pix-in create:
POST https://painel.akadpay.com.br/api/wallet/deposit/payment
credentials in JSON: token + secret
response identity: idTransaction

Pix-out create:
POST https://painel.akadpay.com.br/api/pixout
credentials in JSON: token + secret
request idempotencyKey documented as unique per withdrawal
same key + same data documented to return existing transaction
response identifiers include id/reference_id/idempotencyKey

webhook:
callback payload examples are documented
Pix-out duplicate handling recommends idempotencyKey/reference_id
public webhook page does not expose an exact signature verification algorithm
```

The marketing site also advertises signature validation/JWT-style security, but marketing statements do not define an executable authentication protocol.

Material mismatch with the retained AkkadPag identity remains:

```text
api.akkadpag.com/v1/            != painel.akadpay.com.br
Basic publicKey:secretKey       != token/secret JSON examples
transactions / transfers        != wallet/deposit/payment / pixout
```

No provider-owned source discovered in the current pass proves a rename, migration or compatibility relationship between retained `AkkadPag` and public `AkadPay`.

Therefore:

- AkadPay facts are `inferred_non_authoritative` for the retained AkkadPag integration;
- AkadPay's documented Pix-out idempotency MUST NOT be imported into AkkadPag;
- production AkkadPag remains blocked until current identity/lineage is proven.

### FlevoPay retained legacy identity

Accepted historical evidence proves the retained adapter used:

```text
base URL: https://app.flevopay.com.br/api/v1/
auth header: X-API-Key
Pix-in create: POST transaction
Pix-in query: GET query?action=get_transaction&id={transactionId}
seller query: GET seller
Pix-out: no operation in audited adapter
```

This is `proven_legacy`.

### FlevoPay current public evidence is insufficient for executable semantics

Current public site re-checked on 2026-08-16:

- `https://flevopay.com.br/`

It currently advertises:

- `api.flevopay.com/v1` as active;
- API-key style integration at a marketing level;
- an API reference visual mentioning Pix-in and Pix-out;
- instant withdrawal capability.

The public site does not expose the exact current create/query route, request/response schema, idempotency contract, recovery identity, webhook verification protocol, status vocabulary or rate-limit contract required by SwiftPay.

Material lineage uncertainty remains because the retained adapter used `app.flevopay.com.br/api/v1/` while current marketing names `api.flevopay.com/v1`.

Therefore:

- current API-host existence is useful discovery evidence;
- exact retained/new route compatibility is `unknown`;
- FlevoPay Pix-out remains unsupported in V1 until an exact technical contract is proven;
- live Pix-in remains blocked until current create/recovery/webhook semantics are verified.

## Provider fact ledger

### AkkadPag

| Concern | Current classification | A5 behavior |
|---|---|---|
| retained provider name and V1 scope | `proven_legacy` + frozen product decision | include provider in conformance matrix |
| legacy base URL | `proven_legacy` | fixture metadata only; never live activation |
| Basic `publicKey:secretKey` auth | `proven_legacy` | legacy fixture contract only |
| integer-cent Pix-in request | `proven_legacy` | fixture/conversion test |
| Pix-in `transactions` create/query | `proven_legacy` | compatibility fixture only |
| Pix-in required customer fields | partial `proven_legacy` | no production activation until current requirements proven |
| Pix-in current idempotency guarantee | `unknown` | classify create as non-replay-safe by default |
| Pix-in authoritative recovery identifier | `unknown_current` | production recovery disabled |
| legacy payment status vocabulary | `proven_legacy` | mapping fixtures, unknown status fails closed |
| Pix-out `transfers` + withdrawal key | `proven_legacy` | payout fixture only |
| Pix-out provider idempotency | `unknown_current` | no automatic retry/replay |
| webhook payload shape | `proven_legacy` | normalization fixture only |
| webhook authentication | `unknown_current`; legacy app path unsafe | no trusted ProviderEvent from live AkkadPag webhook |
| refund endpoint/identity/recovery | `unknown` | capability disabled |
| current rate limits | `unknown` | no live retry policy frozen |
| AkkadPag == AkadPay lineage | `unknown` | never assume equivalence |

### FlevoPay

| Concern | Current classification | A5 behavior |
|---|---|---|
| retained provider name and V1 scope | `proven_legacy` + frozen product decision | include provider in conformance matrix |
| legacy base URL | `proven_legacy` | fixture metadata only |
| `X-API-Key` auth | `proven_legacy`; current marketing says API key generally | fixture contract; production exact header still requires current proof |
| integer-cent Pix-in request | `proven_legacy` | fixture/conversion test |
| legacy `POST transaction` | `proven_legacy` | compatibility fixture only |
| legacy query by transaction id | `proven_legacy` | compatibility fixture; current recovery identity not assumed |
| stable SwiftPay external/reference behavior | `proven_legacy` | adapter fixture must preserve client reference separately |
| current idempotency guarantee | `unknown` | no replay-safe assumption |
| legacy status vocabulary | `proven_legacy` | mapping fixtures, unknown status fails closed |
| webhook payload shape | `proven_legacy` | normalization fixture only |
| exact webhook auth/replay mechanism | `unknown_current` | live webhook trust disabled |
| Pix-out | legacy explicitly unsupported; current marketing advertises capability | keep V1 `supports_pix_out=false` until exact current contract approved |
| refund | `unknown` | capability disabled |
| current rate limits | `unknown` | no provider-specific live retry policy frozen |

## Primary design hazards

### 1. Mistaking legacy compatibility for current production conformance

A fixture can prove that a TypeScript adapter correctly reproduces a historical request/response mapping. It cannot prove that the provider still accepts that protocol.

A5 must therefore keep **fixture conformance** and **production activation evidence** as separate states.

Proposed provider-operation state:

```text
unsupported
fixture_only
current_contract_proven
sandbox_proven
production_enabled
```

A5 may reach `fixture_only`. It MUST NOT set `production_enabled`.

### 2. Brand-name collision / migration ambiguity

`AkkadPag` and public `AkadPay` are similar enough to tempt accidental contract import, but the protocol mismatch is material. The conformance model must bind evidence to a provider contract lineage identifier rather than brand text alone.

Example conceptual identity:

```text
provider = akkadpag
contract_lineage = legacy-api.akkadpag.com-v1
```

A future proven migration can explicitly supersede that lineage. Until then, it remains separate from an AkadPay contract lineage.

### 3. Hidden retry can duplicate money

Neither retained provider has a currently proven replay-safe Pix-create contract. An HTTP client's generic retry policy can create duplicate charges or payouts after a lost response.

A5 tests must prove:

- create/Pix-out fixture transports are invoked exactly once per adapter execution;
- timeout/reset/ambiguous 5xx maps to `execution_unknown`;
- the adapter itself never converts uncertainty into a second POST;
- a retry is allowed only through a separately proven idempotency/recovery contract.

### 4. Recovery cannot guess an identifier

Legacy FlevoPay returns multiple identifiers; AkkadPag exposes provider payment/transaction/Pix identifiers. After an ambiguous create, using the wrong lookup key can produce a false `not found`, then incorrectly permit a second create.

A5 must model lookup identifiers semantically and per operation:

```text
client_reference
provider_payment_id
provider_transaction_id
pix_txid
end_to_end_id
provider_event_id
provider_specific_lookup_reference
```

A provider fixture may declare a recovery lookup only when evidence proves which identifier the query endpoint accepts.

### 5. `404/not found` does not automatically prove non-execution

Even a documented query endpoint can be eventually consistent. A missing record is not `proven_not_created` unless provider evidence explicitly gives that guarantee for the chosen identifier/time horizon.

A5 therefore defaults missing/indeterminate recovery to `still_unknown`.

### 6. Webhook trust is operation-specific security, not DTO parsing

A valid JSON shape does not make a provider event authoritative.

A5 must split:

```text
verifyWebhook(raw request) -> verified / rejected / verification_unavailable
normalizeWebhook(verified evidence) -> canonical provider event candidate
```

If verification is unavailable or unproven for a live provider:

- payload may be retained only as an untrusted recovery hint under an explicitly separate path;
- it cannot directly create trusted financial `ProviderEvent` evidence;
- an authoritative provider lookup is required before money-state transition.

### 7. Unknown statuses must stay unknown

Legacy code mapped unknown AkkadPag/FlevoPay values to benign-looking in-progress states. That masks provider contract drift.

A5 fixtures must prove that an unrecognized raw status produces structured `unrecognized_provider_status` evidence and never independently advances/reverses canonical Payment/Payout state.

### 8. Customer placeholders are prohibited

Both retained legacy adapters synthesized placeholder customer fields. A5 must not preserve this behavior.

Provider fixture metadata must classify customer fields as:

```text
required
optional
unsupported
unknown_current
```

If a field is required by the accepted contract and SwiftPay lacks it, execution fails before network I/O. No fake CPF/name/email/phone is generated.

### 9. Provider DTO leakage would couple the public API to unstable contracts

The public SwiftPay resource shape is already canonical. A5 adapter results must normalize into internal provider evidence and never surface provider-specific request/response objects through public routes.

### 10. Fixtures can accidentally contain secrets or customer PII

All A5 fixtures are synthetic/sanitized. They must not contain:

- real API keys/tokens/secrets;
- Authorization header values derived from live credentials;
- real CPF/CNPJ, phone, email or Pix keys;
- real transaction/end-to-end identifiers copied from production;
- webhook signing secrets.

Tests should scan fixture trees for known secret prefixes/patterns and enforce documentation that identifiers are synthetic.

## Proposed A5 artifact model

A5 should create a dedicated provider package only after RED tests exist. Before implementation, the repository should freeze:

```text
docs/specs/provider-conformance-v0.yaml

tests/application/provider-fixtures/
  akkadpag/
    manifest.json
    pix-create-success.json
    pix-create-rejected.json
    pix-create-ambiguous-5xx.json
    pix-query-pending.json
    pix-query-paid.json
    webhook-known-status.json
    webhook-unknown-status.json
    payout-create-processing.json
  flevopay/
    manifest.json
    pix-create-success.json
    pix-create-rejected.json
    pix-create-ambiguous-5xx.json
    pix-query-pending.json
    pix-query-paid.json
    webhook-known-status.json
    webhook-unknown-status.json
```

Exact filenames may be finalized in the YAML spec, but every fixture manifest must carry provenance/classification rather than pretending to be current live traffic.

Example manifest fields:

```text
provider
contract_lineage
operation
fixture_version
evidence_classification
source_artifacts
contains_real_secrets = false
contains_real_pii = false
production_activation = blocked
```

## Proposed adapter result boundary

The exact TypeScript interface belongs in the YAML/contracts phase, but A5 needs one semantic result vocabulary shared by both providers.

Create result categories:

```text
succeeded
  provider IDs + Pix material + raw status evidence

definitive_rejection
  provider proved request was rejected / not executed

pre_execution_failure
  local validation/config or transport failure proven before possible transmission

execution_unknown
  request may have reached provider; no replay

configuration_error
unsupported
```

Recovery result categories:

```text
found_pending
found_paid
found_expired
found_failed       # only when provider evidence definitively means terminal failure
proven_not_created # only when provider contract explicitly proves absence
still_unknown
unrecognized_provider_status
```

Webhook verification categories:

```text
verified
rejected
verification_unavailable
```

## Network boundary for A5

A5 conformance CI is strictly network-free.

Requirements:

- no DNS resolution;
- no `fetch`, `http.request`, `https.request` or provider SDK network call from conformance tests;
- adapters receive an injected transport interface;
- fixtures drive deterministic transport responses/errors;
- a source guard/test fails if a fixture-conformance test imports a live transport implementation;
- no provider host credential is required by CI;
- no live provider account is needed to make A5 GREEN.

A later activation slice may add a separately controlled sandbox/live transport after current-contract evidence is accepted.

## What A5 can prove without current provider access

A5 can safely prove:

- SwiftPay's provider abstraction is capability-oriented;
- integer-cent input is preserved/converted exactly as accepted evidence requires;
- legacy request mapping does not synthesize PII;
- stable client references remain distinct from provider IDs;
- result/error/status normalization is deterministic;
- no hidden monetary retry occurs;
- ambiguous transport becomes `execution_unknown`;
- unsupported operations produce zero transport calls;
- unknown statuses fail closed;
- provider DTOs do not leak past the adapter boundary;
- historical webhook payload normalization is deterministic;
- unverified/unproven webhook auth cannot create trusted evidence;
- fixtures contain no real secrets/PII.

## What A5 cannot prove without stronger external evidence

A5 cannot truthfully claim:

- `api.akkadpag.com/v1` is still a valid production endpoint;
- AkkadPag is the same API lineage as current AkadPay;
- current AkkadPag Pix-create or payout replay is idempotent;
- a given AkkadPag/FlevoPay query `not found` proves non-execution;
- the exact current webhook verification mechanism for either provider;
- the current complete status vocabulary/rate limits for either provider;
- current FlevoPay Pix-out semantics;
- refund support/recovery for either provider;
- production readiness of either adapter.

These remain explicit activation blockers rather than guessed defaults.

## Required RED conformance suites

After the YAML spec is frozen, RED tests should be added in this order.

### Common provider contract

1. provider exposes explicit capability metadata;
2. unsupported operation performs zero transport calls;
3. canonical money uses integer cents;
4. no provider adapter fabricates customer identity/contact data;
5. stable client reference is preserved separately from provider identifiers;
6. monetary POST performs one transport invocation only;
7. timeout/reset/ambiguous post-transmission outcome becomes `execution_unknown`;
8. unknown raw status becomes `unrecognized_provider_status`;
9. provider DTO/raw secret fields do not leak into public/domain projection;
10. fixture provenance/sanitization manifest is mandatory;
11. conformance suite is network-free.

### AkkadPag fixture contract

Legacy-reference fixtures must test:

- Basic auth construction from synthetic keys without logging the header;
- integer-cent Pix create request mapping;
- real-input validation replacing legacy placeholders;
- success normalization of provider ID/Pix fields;
- known payment-status mappings;
- unknown payment status fail-closed;
- explicit reject vs ambiguous 5xx/timeout;
- historical query mapping without claiming current authoritative absence semantics;
- payout request mapping including synthetic withdrawal-key credential;
- `PENDING_ANALYSIS`/`PROCESSING` remain non-terminal;
- payout ambiguity never releases funds or triggers a second POST;
- refund capability is disabled;
- historical webhook DTO normalization;
- live webhook authority remains disabled while authentication contract is unproven.

### FlevoPay fixture contract

Legacy-reference fixtures must test:

- `X-API-Key` construction from a synthetic key without logging it;
- integer-cent create request;
- reference propagation;
- success normalization of `transaction_id`/`id`/QR fields;
- known status mappings;
- unknown status fail-closed;
- explicit reject vs ambiguous 5xx/timeout;
- historical query request uses the proven legacy lookup form only in fixture mode;
- multiple provider identifiers remain distinct;
- `supports_pix_out=false` and payout attempts make zero transport calls;
- refund capability disabled;
- historical webhook DTO normalization;
- live webhook authority remains disabled while exact verification is unproven.

## Activation gate after A5

Completing A5 fixture conformance does **not** activate a PSP.

For each provider/operation, production activation later requires:

1. accepted current provider contract lineage;
2. exact environment/base URL;
3. credential/header contract;
4. request/response schema and amount semantics;
5. idempotency/replay classification;
6. authoritative recovery identifiers and missing-record semantics;
7. current status vocabulary;
8. webhook verification and replay identity;
9. provider-specific safe read retry/rate-limit behavior;
10. authenticated sandbox evidence where available;
11. a separate acceptance proving no secrets/PII leak;
12. explicit enablement in provider capability/routing configuration.

Until all applicable items pass, the operation stays fail-closed.

## A5 scope

### In scope

- evidence classification/provenance;
- provider-operation capability matrix;
- network-free sanitized fixtures;
- common adapter contract;
- AkkadPag legacy-reference Pix-in/Pix-out mapping fixtures;
- FlevoPay legacy-reference Pix-in mapping fixtures;
- error/execution-certainty normalization;
- recovery result vocabulary;
- status normalization and unknown-state behavior;
- webhook verification/normalization boundary;
- conformance CI network prohibition;
- fixture-backed minimal adapters only after RED.

### Out of scope

- live AkkadPag/AkadPay/FlevoPay API calls;
- real credentials;
- provider account creation/onboarding;
- live Pix creation/payout/refund;
- importing AkadPay semantics into AkkadPag without lineage proof;
- enabling FlevoPay Pix-out from marketing evidence;
- merchant/provider production routing activation;
- provider webhook ingress listener connected to financial transitions;
- production retry/rate-limit tuning without current provider evidence;
- refund enablement;
- provider reconciliation based on unproven missing-record semantics.

## Exit criteria for Problem Analysis

This analysis is considered frozen when:

- retained provider scope remains exactly AkkadPag + FlevoPay;
- legacy facts and current public evidence are explicitly separated;
- AkkadPag/AkadPay equivalence is explicitly unresolved;
- FlevoPay current API lineage gaps remain explicit;
- no live-provider behavior is invented to fill those gaps;
- A5 is defined as network-free fixture conformance, not production activation;
- execution uncertainty, recovery, webhook trust and unsupported capabilities fail closed;
- the next artifact can freeze deterministic fixtures/tests without requiring live credentials.

Those conditions are satisfied. The next permitted step is the frozen A5 YAML specification. No adapter implementation or live PSP call is permitted yet.
