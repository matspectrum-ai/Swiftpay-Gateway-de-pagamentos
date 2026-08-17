# SwiftPay V2 — A10 Provider Activation & Outbound Safety Gate — Problem Analysis

Date: 2026-08-17  
Status: **FROZEN PROBLEM ANALYSIS**  
Next artifact: `docs/specs/provider-activation-outbound-safety-v0.yaml`

## Problem statement

A1–A9 prove most of the internal SwiftPay V1 gateway path, while A5 proves that the retained AkkadPag and FlevoPay adapters can only be treated as fixture-compatible until current provider contracts are authoritative.

The main production risk is now a dangerous gap between those two facts:

- provider adapter code exists;
- generic provider transport is injectable;
- current retained-provider contract authority is still incomplete;
- future runtime composition could accidentally attach a network transport to a fixture-only adapter before the evidence gate is actually closed.

A10 must make that class of failure structurally difficult.

A10 will introduce a **default-deny provider activation and outbound-network authorization boundary**. The boundary decides whether a particular provider operation may receive network authority in a particular environment, and it binds that decision to an exact contract lineage and versioned evidence record.

A10 is not a live provider rollout. It does not guess PSP routes, perform authenticated provider calls, send money, create provider webhooks, or claim current provider semantics that remain unproven.

## Why this slice is next

The hosted A9 checkpoint leaves the conservative weighted V1 engineering estimate at about 75%, but the remaining work is dominated by production risk rather than missing CRUD surfaces.

The most consequential unresolved path is:

```text
current provider contract evidence
  -> safe network authority
  -> sandbox proof
  -> production activation
  -> live recovery/webhook/reconciliation
```

Without an explicit activation boundary, evidence state is mostly documentary. A future implementation error could wire a live HTTP transport directly to `createAkkadPagAdapter` or `createFlevoPayAdapter` and bypass the intent of A5.

A10 turns the evidence state into an executable deny-by-default invariant before any live provider transport is implemented.

## Current evidence checkpoint

Canonical evidence refresh:

- `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`

AkkadPag/AkadPay remains a lineage problem. Current AkadPay public technical docs materially differ from the retained AkkadPag legacy API and do not prove migration/equivalence.

FlevoPay currently advertises `api.flevopay.com/v1` and API-key integration, but provider-owned public material still does not expose the exact executable create/query/recovery/webhook contract required for live authorization.

Therefore A10 starts with **zero retained monetary operations authorized for live network execution**.

## Existing canonical decisions A10 must preserve

### Provider scope

Exactly these retained provider identities exist for V1:

```text
akkadpag
flevopay
```

Adding a different provider still requires an explicit scope/ADR decision.

### A5 activation vocabulary

A5 already freezes:

```text
unsupported
fixture_only
current_contract_proven
sandbox_proven
production_enabled
```

A10 must reuse these states rather than invent a competing provider lifecycle.

### Money safety

- monetary POSTs never receive transparent retry;
- ambiguous post-transmission outcomes remain `execution_unknown`;
- no second monetary attempt after ambiguity unless recovery or independently proven replay safety authorizes it;
- customer identity/contact placeholders remain forbidden;
- unknown provider statuses fail closed;
- provider webhook payload shape alone never grants financial authority.

### Current A5 adapter state

`packages/providers` currently exposes fixture-compatible AkkadPag and FlevoPay adapters behind an injected `ProviderTransport`.

`PROVIDER_CAPABILITIES` marks both retained providers `activation: fixture_only`; webhook authority is false for both; FlevoPay Pix-out remains unsupported.

A10 does not rewrite the fixture adapter mappings. It controls whether a transport with network authority may be attached to a provider operation.

## Core distinction: adapter capability vs outbound authority

A provider may have a fixture-level capability without being authorized to use the network.

These concepts must remain separate:

```text
adapter capability
  = code can map a canonical operation to/from a provider contract fixture

outbound authority
  = runtime is allowed to communicate with the exact approved provider contract lineage
```

For example:

```text
akkadpag.pix_in adapter capability = true / fixture_only
akkadpag.pix_in outbound production authority = false
```

A10 must never derive outbound authority merely from `pixIn: true`, provider name, existence of credentials, base URL presence, or environment name.

## Required activation subject

Every decision must be bound to the full tuple:

```text
provider
operation
contract_lineage
environment
```

Provider alone is insufficient.

Initial operation vocabulary for A10:

```text
pix_in_create
pix_in_query
pix_in_recover
pix_out_create
pix_out_query
pix_out_recover
webhook_verify
```

Refund remains unsupported for both retained providers in the current V1 contract and receives no outbound grant.

Environment vocabulary remains:

```text
sandbox
production
```

## Versioned activation record

A10 should use a repository-versioned activation registry, not an implicit environment-variable convention and not provider marketing text.

Each record must contain, at minimum:

```text
provider
operation
contract_lineage
state
environments
approved_base_url_or_null
evidence_bundle_sha256_or_null
reviewed_at_or_null
```

The exact serialized schema belongs in the YAML specification.

### Initial registry state

The initial canonical registry must keep all retained monetary/network operations denied.

Expected initial entries remain at either:

```text
unsupported
fixture_only
```

No `current_contract_proven`, `sandbox_proven`, or `production_enabled` entry may be fabricated from current public discovery evidence.

An operation without a registry record is denied.

## Evidence binding

An activation record above `fixture_only` must bind to a versioned evidence bundle digest.

The digest exists to prevent a later runtime/config edit from silently saying “evidence exists” without identifying what review actually authorized the transition.

A10 is not responsible for cryptographically proving the truth of external documentation. It is responsible for ensuring that runtime authorization cannot exist without an explicit reviewed evidence artifact identity.

Required rule:

```text
state > fixture_only
=> non-null evidence_bundle_sha256
=> non-null exact contract_lineage
=> non-null approved base URL for outbound operations
```

A similarly branded lineage cannot satisfy another lineage's record.

Example:

```text
akadpay-public-2026 evidence
!= authorization for akkadpag-legacy-api-v1
```

unless a future provider-owned lineage/migration artifact explicitly establishes that relation and the registry is deliberately changed.

## Environment/state rules

A10 must fail closed with the following minimum policy:

### Sandbox network authorization

A monetary outbound operation in `sandbox` requires at least:

```text
state = sandbox_proven
```

`current_contract_proven` alone is not enough to send a monetary request; it means the technical contract is accepted, not that SwiftPay has proven its actual authenticated sandbox behavior.

Non-monetary verification tooling may later use a narrower dedicated path during evidence acquisition, but that path is not provider money execution and is outside A10 V0 runtime authorization.

### Production network authorization

A monetary outbound operation in `production` requires exactly:

```text
state = production_enabled
```

A `sandbox_proven` operation remains denied in production.

### Query/recovery

Network query/recovery is still provider communication and must be authorized for the exact operation/lineage/environment. Query authority does not imply create authority, and create authority does not imply recovery semantics.

### Webhook verification

`webhook_verify` is independently activated. Receiving an HTTP callback must not imply that the callback is trusted.

A provider event may become authoritative only if the exact current webhook verification contract has been accepted and the runtime verifier is enabled under a corresponding activation record.

## Authorization grant design

A10 should avoid boolean checks that can be evaluated once and then discarded.

The preferred boundary is a short-lived in-memory authorization grant minted only after the registry check succeeds.

Conceptually:

```text
authorizeProviderOperation(input)
  -> denied(reason)
  -> authorized(grant)
```

The grant should carry the resolved immutable decision context:

```text
provider
operation
contractLineage
environment
approvedBaseUrl
registryVersion/evidenceDigest
```

A future network transport must require this grant instead of accepting an arbitrary base URL/provider string.

The grant is process memory only. It is not a credential, merchant-facing token, database object, or reusable public API primitive.

## Base URL authority

A10 must not let provider adapters choose arbitrary origins.

When outbound authority eventually exists, the approved base URL comes from the activation record tied to the exact lineage. The provider adapter continues to emit only relative provider paths.

A future network transport will join:

```text
approved base URL from grant
+ relative path from adapter
```

and must not allow a provider response, runtime input, customer field, callback URL, or adapter body to replace the provider origin.

Current V0 initial registry contains no approved live base URL because no retained operation is activated.

## Default-deny invariants

A10 must prove all of the following:

1. missing provider record -> denied;
2. unknown provider -> denied;
3. unsupported operation -> denied;
4. fixture-only operation -> denied for sandbox and production network use;
5. current-contract-proven monetary operation -> still denied for sandbox money execution;
6. sandbox-proven -> may authorize only the explicitly allowed sandbox operation/lineage;
7. sandbox-proven -> denied in production;
8. production-enabled -> authorizes only the explicitly allowed production operation/lineage;
9. provider/operation/environment/lineage mismatch -> denied;
10. absent/malformed evidence digest for activated state -> invalid registry / denied;
11. missing/invalid approved base URL for outbound activated state -> invalid registry / denied;
12. base URL must be HTTPS and must not contain userinfo, fragment or query;
13. IP-literal/localhost/private-development provider origins are not silently accepted as production PSP origins;
14. credentials never influence activation state;
15. adapter fixture capability never implicitly upgrades activation state;
16. no environment variable can bypass the registry with a generic `ENABLE_LIVE=true` switch;
17. initial checked-in registry authorizes zero live monetary provider operations.

## Registry integrity and startup behavior

The registry is security-sensitive configuration.

A malformed registry must fail runtime composition closed rather than silently dropping the bad record and continuing.

The application must distinguish:

```text
operation_denied
registry_invalid
```

for internal diagnostics, while public merchant API errors remain stable and must not disclose provider security/configuration details.

No secret material belongs in the activation registry.

The registry may contain provider technical origins and evidence digests, which are operational metadata rather than credentials.

## Logging / observability constraints

A10 should make denial diagnosable without leaking credentials or customer/provider payloads.

Allowed structured diagnostic fields:

```text
provider
operation
environment
contract_lineage
activation_state
deny_reason
registry_version
```

Forbidden:

- API keys, secrets or Authorization values;
- customer PII;
- Pix keys;
- provider request/response bodies;
- merchant Secret Keys;
- webhook signing secrets.

Actual structured logging implementation may remain in the later observability slice; A10 must keep its result model safe for that future use.

## No database migration in A10 V0

A10 activation authority is deliberately repository/deployment controlled in V0.

Reasons:

- activation changes are rare, security-sensitive production decisions;
- they should require code review and deploy evidence rather than a mutable dashboard toggle;
- no merchant/admin actor should be able to enable a PSP;
- avoiding a database mutation surface keeps the first activation gate small and auditable.

A future operational control plane may supersede this with signed/config-managed activation state, but that requires a separate design.

## No provider credentials in A10

A10 does not create a new credential store.

Provider credentials already belong to trusted runtime configuration/secret management. Possessing valid provider credentials must not imply activation.

The decision order is conceptually:

```text
1. validate canonical operation
2. evaluate activation registry
3. if denied: stop before provider transport
4. if authorized: future runtime may resolve credentials
5. future transport executes under exact grant
```

This ordering prevents secret resolution from becoming an accidental activation signal.

## A10 V0 application boundary

The exact TypeScript signatures belong in the spec/contracts phase, but the intended package ownership is:

`packages/providers`:

- activation state/types;
- registry parser/validator;
- authorization decision service;
- immutable grant object;
- checked-in default registry loader/data;
- no live HTTP implementation yet.

A10 V0 should not modify public Fastify routes, merchant dashboard routes, Payment state transitions, worker financial behavior, Supabase routines or provider DTO mappings.

## A10 V0 side-effect boundary

A10 must have no side effects on:

- `app.payments`;
- `app.provider_attempts`;
- `app.provider_events`;
- ledger/accounts;
- payouts/refunds;
- jobs;
- merchant webhooks;
- dashboard webhooks;
- API credentials;
- idempotency records;
- audit events;
- KYC/customer state.

It performs no network I/O in V0.

## Relationship to future slices

A10 should make subsequent production work explicit rather than combining it prematurely.

Expected sequence:

```text
A10 activation/outbound authority gate
  -> provider-owned current contract evidence upgrade
  -> A11 strict live HTTP transport foundation
  -> authenticated non-monetary / sandbox contract acceptance
  -> registry transition to sandbox_proven
  -> provider-specific sandbox monetary acceptance where safe/authorized
  -> webhook verification + recovery/reconciliation
  -> deliberate production_enabled transition
```

The exact numbering of future slices is not frozen by this document; the dependency direction is.

## Non-goals

A10 V0 does not:

- prove AkkadPag == AkadPay;
- select AkadPay as a replacement provider;
- call any PSP;
- implement Fetch/Undici network transport;
- add retries;
- add provider webhook ingress;
- create a provider dashboard;
- store provider credentials;
- implement Pix-out for FlevoPay;
- implement refunds;
- mutate provider activation from an HTTP API;
- increase readiness percentages merely for documentation.

## Acceptance criteria for leaving Problem Analysis

The next YAML spec may be frozen when it defines deterministically:

1. exact activation registry schema/version;
2. exact provider/operation/environment/state enums;
3. registry validation failures;
4. exact state-to-environment authorization matrix;
5. lineage/evidence/base-URL requirements;
6. immutable grant fields;
7. default registry contents proving zero live authorization;
8. required package exports;
9. test vectors for deny/authorize behavior;
10. explicit proof that no network/provider/database/public-route behavior is introduced in A10 V0.

## Decision

Proceed with A10 as a **network-free executable provider activation gate**.

Do not implement a live provider transport or authorize a monetary provider request until subsequent evidence and TDD gates explicitly permit it.