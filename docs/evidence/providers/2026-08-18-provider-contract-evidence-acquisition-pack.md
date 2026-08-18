# Provider Contract Evidence Acquisition Pack — 2026-08-18

Status: **EVIDENCE_REQUIRED / NO ACTIVATION AUTHORITY**

Purpose: define the exact provider-owned evidence and authenticated sandbox proof required to unblock the retained AkkadPag/AkadPay and FlevoPay live-provider critical path.

This artifact is an acquisition/acceptance checklist. It does not authorize provider traffic, does not alter the A10 registry, does not wire A5 adapters to A11, and does not permit monetary calls.

## Why this pack exists

A second provider-owned public-evidence pass on 2026-08-18 revalidated the already-captured current material and found no additional public technical contract that closes the remaining gaps.

Public AkadPay material currently proves current PIX-IN/PIX-OUT create surfaces and useful PIX-OUT replay/idempotency identifiers, but the public technical docs still do not expose query/recovery endpoints or a cryptographic webhook verification algorithm. The public marketing site claims signed webhooks/JWT-secured APIs, but those claims are not a substitute for the executable Pix technical contract.

Public FlevoPay material currently proves the active `api.flevopay.com/v1` host and a provider-owned API-reference image showing Basic `Base64(PUBLIC_KEY:SECRET_KEY)` authentication plus a visible capability list. It still does not expose enough exact paths/schemas/status/idempotency/recovery/webhook semantics to freeze a current executable adapter.

No public sandbox/homologation technical contract was found for either provider during this pass. Search absence is not proof that no private sandbox exists; it means public evidence is exhausted for the current gate.

Canonical prior refresh: `docs/evidence/providers/2026-08-18-current-provider-contract-critical-path-refresh.md`.

## Evidence acceptance rule

An item may advance a provider gate only when the source is provider-owned and sufficiently exact to reproduce the behavior without inference.

Acceptable authoritative artifacts include:

1. provider-owned current technical documentation;
2. provider-owned OpenAPI/Postman collection or signed integration manual with version/date;
3. provider support response from an official provider-controlled channel that explicitly answers the requested contract questions;
4. authenticated current sandbox evidence captured from credentials supplied for that environment, provided the observed behavior is recorded without secrets and is reproducible;
5. provider-owned migration/lineage statement explicitly binding the current contract to the retained historical integration, where lineage matters.

Not sufficient by itself:

- marketing copy;
- brand/domain similarity;
- third-party integration code;
- screenshots without readable endpoint/schema semantics;
- a successful request made against an unversioned/undocumented endpoint;
- assumptions derived from another PSP or from a similarly named API.

## AkkadPag / AkadPay — required provider response

### A. Contract lineage

Provider must explicitly answer at least one of the following:

1. `AkadPay` is the current contractual/API successor of historical `AkkadPag`, and the provider identifies which historical API lineage/version maps to the current contract; or
2. `AkadPay` is a distinct/replacement contract and the retained `akkadpag-legacy-api-v1` integration must not be treated as current-compatible.

Required supporting data:

- current legal/product name;
- current API version identifier;
- effective/migration date if applicable;
- whether historical AkkadPag credentials remain valid;
- whether historical transaction/provider identifiers remain queryable;
- whether any old endpoint remains supported and until when.

Without this, current AkadPay evidence cannot authorize the retained AkkadPag A10 lineage.

### B. PIX-IN create contract

Current public create evidence is useful but incomplete for production freeze. Request:

- exact current endpoint and HTTP method;
- authentication placement and credential fields;
- exact request schema, required/optional fields and money unit;
- merchant/client reference field, uniqueness requirements and maximum lengths;
- whether create has provider-side idempotency; exact key/header/body field and replay semantics;
- complete success response schema;
- complete error/status-code contract;
- definitive-rejection vs ambiguous-execution classification guidance;
- rate limits.

### C. PIX-IN query/recovery contract

Request:

- exact query endpoint/method;
- accepted lookup identifiers and priority/order;
- whether merchant/client reference can recover a create after timeout/reset;
- whether provider transaction ID can always be used for authoritative recovery;
- response schema and full status vocabulary;
- terminal/nonterminal status mapping;
- not-found semantics;
- rate limits;
- recommended recovery cadence/backoff.

This item is mandatory before ambiguous create transmission can be recovered safely.

### D. PIX-OUT create/query/recovery

Current public create docs expose `idempotencyKey`, `reference_id` and replay behavior for same-key/same-data. Request the remaining exact contract:

- whether same key + different data is rejected and with which status/error;
- uniqueness scope and retention period of `idempotencyKey`;
- query endpoint/method;
- lookup by `id`, `reference_id`, `idempotencyKey` and/or another identifier;
- complete withdrawal status vocabulary and terminality;
- manual-approval states and timing;
- ambiguous create recovery procedure;
- error/status-code contract and rate limits.

### E. Webhook authentication and replay

Current public technical page documents callback bodies and replay identifiers but no cryptographic verification algorithm. Request:

- exact signature header name(s);
- signing algorithm;
- canonical bytes/string-to-sign definition;
- timestamp field/header and tolerated skew, if any;
- key/secret distribution and rotation semantics;
- example signed request with expected signature;
- replay/event identity and retention expectations;
- retry schedule and delivery timeout;
- source-IP allowlist, if officially supported;
- whether unsigned callbacks are ever possible.

Marketing claims of signed webhooks cannot close this item without the above technical definition.

### F. Authenticated sandbox/homologation

Request:

- dedicated sandbox/homologation base URL;
- credentials scoped to sandbox only;
- deterministic/non-monetary test values or provider-approved test procedure;
- supported simulation of success, rejection, pending/manual approval and timeout/recovery where available;
- webhook test procedure;
- confirmation that no real funds move in the supplied environment.

A10 may not move to `sandbox_proven` from documentation alone; authenticated current sandbox acceptance is required.

## FlevoPay — required provider response

### A. Current contract identity and retained-lineage compatibility

Provider-owned public material shows `api.flevopay.com/v1` and Basic `Base64(PUBLIC_KEY:SECRET_KEY)` authentication, materially different from the retained historical `X-API-Key` adapter.

Request explicit confirmation of:

- current API version and base URL;
- whether historical `app.flevopay.com.br/api/v1` remains supported;
- whether `X-API-Key` is deprecated/removed or applies to a different product;
- whether historical credentials and provider transaction IDs remain valid/queryable;
- effective migration date and migration guidance.

No same-brand inference may be used as compatibility proof.

### B. Authentication contract

Request:

- exact `Authorization` header syntax;
- whether Basic is required on every endpoint;
- public/secret key character/length constraints;
- credential rotation behavior;
- environment scoping;
- authentication failure status/error contract.

### C. PIX-IN create

The public API-reference image lists `Criar transação` but does not expose a complete executable contract. Request:

- exact path + method;
- exact request schema and amount unit;
- required customer fields;
- merchant/client reference and uniqueness constraints;
- provider-side idempotency semantics;
- complete success response;
- complete errors/status codes;
- definitive rejection vs ambiguous execution guidance;
- rate limits.

### D. PIX-IN query/recovery

The public image lists `Buscar transação`. Request:

- exact path + method;
- lookup identifiers and order;
- merchant/client reference recovery support;
- provider transaction ID semantics;
- full response/status vocabulary;
- terminal/nonterminal mapping;
- not-found contract;
- recovery cadence/rate limits.

### E. PIX-IN refund/reversal

The public image lists `Estornar transação`. This capability must not be inferred as a generic SwiftPay refund contract. Request:

- exact path + method;
- eligibility/state constraints;
- full/partial reversal support;
- idempotency;
- amount unit and limits;
- response/status vocabulary;
- recovery/query semantics after ambiguous reversal execution.

### F. PIX-OUT

The public image lists `Criar saque` and `Consultar saldo`. Request:

- exact paths/methods;
- create request/response schema;
- Pix key types and recipient identity requirements;
- provider idempotency key semantics;
- query/recovery endpoint for withdrawal state;
- full status vocabulary;
- ambiguous create recovery order;
- balance semantics and settlement timing;
- rate limits.

No FlevoPay Pix-out capability should be promoted in the retained adapter before this contract is explicit.

### G. Webhook contract

The public image exposes `Formato dos Webhooks` but not a readable full contract. Request:

- event types;
- complete payload schema;
- event/replay identity;
- signature/authentication algorithm and headers;
- canonical signing bytes and timestamp handling;
- signing-key rotation;
- retry schedule/timeouts;
- example signed webhook with expected verification result.

### H. Authenticated sandbox/homologation

Request:

- sandbox/homologation base URL;
- sandbox-only credentials;
- deterministic non-monetary test procedure;
- test outcomes for create/query/recovery/webhook;
- confirmation that the environment cannot move real funds.

## Sandbox acceptance capture protocol

When provider-supplied sandbox access exists, acceptance must be executed as a separate reviewed slice. Before any call:

1. provider-owned contract bundle is stored/summarized with source/version/date and SHA-256 digest;
2. the exact provider/operation/environment/lineage subject is identified;
3. test credentials are stored outside Git/repository evidence;
4. test plan proves the call is sandbox/non-monetary;
5. A10 remains unchanged until evidence is reviewed.

Capture for each tested operation:

- contract version/source;
- request method/path without credentials/PII;
- sanitized canonical request shape;
- HTTP status;
- sanitized canonical response shape;
- provider identifiers returned;
- idempotency/replay observation;
- query/recovery observation;
- webhook observation where applicable;
- exact timestamps;
- evidence SHA-256 digest;
- explicit statement that no real money moved.

Secrets, Authorization values, raw customer PII and reusable provider credentials must never be committed.

## Minimum gate to begin an A5 → A11 bridge slice

A bridge Problem Analysis may begin only for an exact provider operation whose current contract is sufficiently proven to specify:

- provider + operation + environment + contract lineage;
- approved base URL;
- authentication ownership;
- exact path/method/request/response mapping;
- idempotency semantics for monetary create;
- recovery strategy for ambiguous transmission;
- status/error classification;
- credential redaction/secret ownership;
- testable sandbox acceptance plan.

Webhook ingress additionally requires exact webhook authentication and replay semantics.

Implementation remains forbidden until that future bridge slice completes Problem Analysis → spec → contracts → RED.

## Current decision

As of this acquisition pass:

- AkkadPag/AkadPay retained live authority: **BLOCKED / EVIDENCE_REQUIRED**;
- FlevoPay retained live authority: **BLOCKED / EVIDENCE_REQUIRED**;
- authenticated current sandbox proof: **NOT ACQUIRED**;
- A5 → A11 bridge: **NOT AUTHORIZED**;
- A10 `sandbox_proven` transitions: **NONE**;
- A10 `production_enabled` transitions: **NONE**;
- checked-in live retained-provider authority: **ZERO**;
- real provider calls in this evidence-acquisition pass: **ZERO**.

The next useful external action is to obtain provider-owned answers/artifacts and sandbox-only credentials through official provider channels, then evaluate them against this checklist before changing any executable authority.