# SwiftPay V2 — Provider Activation & Outbound Safety V0 Contract

Status: frozen for TDD  
Feature: A10 — Provider Activation & Outbound Safety Gate

## Purpose

This contract converts A5 provider evidence state into an executable, fail-closed authorization decision. It does not implement network transport.

A provider adapter being able to serialize a fixture request does not authorize that adapter to contact a PSP.

## Package ownership

A10 belongs to `packages/providers`.

Required exports:

```ts
PROVIDER_ACTIVATION_SCHEMA_VERSION
DEFAULT_PROVIDER_ACTIVATION_REGISTRY
parseProviderActivationRegistry
createProviderOperationAuthorizer
```

No A10 export may perform DNS, HTTP(S), socket, Fetch, Undici, database or public-route I/O.

## Enumerations

Provider:

```text
akkadpag
flevopay
```

Environment:

```text
sandbox
production
```

Operation:

```text
pix_in_create
pix_in_query
pix_in_recover
pix_out_create
pix_out_query
pix_out_recover
webhook_verify
```

Activation state:

```text
unsupported
fixture_only
current_contract_proven
sandbox_proven
production_enabled
```

A10 reuses the A5 activation vocabulary. No competing lifecycle is allowed.

## Registry schema

`PROVIDER_ACTIVATION_SCHEMA_VERSION` is exactly:

```text
a10-provider-activation-v0
```

A registry is:

```ts
{
  schemaVersion: 'a10-provider-activation-v0';
  registryVersion: string;
  records: ProviderActivationRecord[];
}
```

A record is exactly:

```ts
{
  provider: 'akkadpag' | 'flevopay';
  operation:
    | 'pix_in_create'
    | 'pix_in_query'
    | 'pix_in_recover'
    | 'pix_out_create'
    | 'pix_out_query'
    | 'pix_out_recover'
    | 'webhook_verify';
  environment: 'sandbox' | 'production';
  contractLineage: string;
  state:
    | 'unsupported'
    | 'fixture_only'
    | 'current_contract_proven'
    | 'sandbox_proven'
    | 'production_enabled';
  approvedBaseUrl: string | null;
  evidenceBundleSha256: string | null;
  reviewedAt: string | null;
}
```

Unknown fields are invalid. Missing fields are invalid.

The record identity is `(provider, operation, environment)`. Duplicate identities invalidate the complete registry.

`registryVersion` must match:

```regex
^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$
```

`contractLineage` is nonblank, case-sensitive, untrimmed authority text with a maximum length of 128 characters.

## State-bound validation

For `unsupported` and `fixture_only`:

```text
approvedBaseUrl = null
evidenceBundleSha256 = null
reviewedAt = null
```

For `current_contract_proven`, `sandbox_proven` and `production_enabled`:

```text
approvedBaseUrl != null
evidenceBundleSha256 != null
reviewedAt != null
```

`evidenceBundleSha256` must be exactly 64 lowercase hexadecimal characters.

`reviewedAt` must be a valid UTC timestamp in canonical millisecond form:

```text
YYYY-MM-DDTHH:mm:ss.SSSZ
```

## Approved provider base URL

An evidence-bound record must use an absolute canonical HTTPS base URL.

Required:

- `https:` exactly;
- hostname present;
- trailing `/` on pathname.

Forbidden:

- username/password/userinfo;
- query string;
- fragment;
- `localhost`;
- `*.localhost`;
- IPv4 or IPv6 literal host;
- non-HTTPS schemes.

The base URL is provider-origin authority. Future provider transports must derive the origin from the authorization grant, not from merchant input, adapter output, provider response data or a generic `ENABLE_LIVE` environment switch.

## Parser result

`parseProviderActivationRegistry(input)` returns one of:

```ts
{
  ok: true;
  registry: ValidatedProviderActivationRegistry;
}
```

or:

```ts
{
  ok: false;
  reason: 'registry_invalid';
}
```

It must not partially accept a malformed registry.

The successful registry value is immutable from the caller's perspective. Mutating the original input after parsing must not alter authorization behavior.

## Authorizer construction

`createProviderOperationAuthorizer({ registry })` accepts only a successfully validated registry value.

Supplying arbitrary unvalidated data must fail closed by throwing a configuration error before any authorization decision can be made.

A10 does not expose a fallback/default-allow constructor.

## Authorization input

```ts
{
  provider;
  operation;
  environment;
  contractLineage;
}
```

All values are exact and case-sensitive.

Lookup key:

```text
(provider, operation, environment)
```

The supplied `contractLineage` must then exactly equal the record lineage.

## Denied decisions

The authorizer returns:

```ts
{
  kind: 'denied';
  reason:
    | 'subject_not_registered'
    | 'lineage_mismatch'
    | 'activation_state_denied';
}
```

Rules:

- no matching tuple -> `subject_not_registered`;
- matching tuple but different lineage -> `lineage_mismatch`;
- matching tuple/lineage but state is not sufficient for that environment -> `activation_state_denied`.

Credentials, presence of an adapter capability, or presence of a URL outside the registry do not alter a denied result.

## State authorization matrix

For a `sandbox` record:

| State | Runtime outbound authorization |
|---|---|
| `unsupported` | denied |
| `fixture_only` | denied |
| `current_contract_proven` | denied |
| `sandbox_proven` | authorized |
| `production_enabled` | authorized |

For a `production` record:

| State | Runtime outbound authorization |
|---|---|
| `unsupported` | denied |
| `fixture_only` | denied |
| `current_contract_proven` | denied |
| `sandbox_proven` | denied |
| `production_enabled` | authorized |

`current_contract_proven` is contract evidence, not authenticated runtime proof. It never authorizes provider runtime traffic by itself.

## Authorized grant

An authorized decision is:

```ts
{
  kind: 'authorized';
  grant: {
    provider;
    operation;
    environment;
    contractLineage;
    activationState;
    approvedBaseUrl;
    evidenceBundleSha256;
    reviewedAt;
    registryVersion;
  };
}
```

The grant is immutable.

It contains no:

- provider credential;
- Authorization value;
- customer data;
- Payment data;
- Pix key;
- merchant token;
- public reusable bearer-token semantics.

It is process-memory decision context only.

## Exact lineage invariant

Evidence and authorization are lineage-specific.

In particular:

```text
akadpay-public-2026
```

must not satisfy:

```text
akkadpag-legacy-api-v1
```

merely because the names are similar.

Any future lineage migration/equivalence requires a reviewed provider-owned evidence artifact plus a deliberate registry change.

## Default registry

`DEFAULT_PROVIDER_ACTIVATION_REGISTRY` has `registryVersion = '2026-08-17.0'` and must parse successfully.

It carries zero runtime-authorized operations.

AkkadPag uses lineage:

```text
akkadpag-legacy-api-v1
```

All seven Sandbox and all seven Production operation records are `fixture_only`.

FlevoPay uses lineage:

```text
flevopay-legacy-app-api-v1
```

Pix-in create/query/recover and webhook verification are `fixture_only` in both environments. Pix-out create/query/recover are `unsupported` in both environments.

Every default record has:

```text
approvedBaseUrl = null
evidenceBundleSha256 = null
reviewedAt = null
```

The default registry therefore cannot mint an authorization grant.

## Side-effect and dependency contract

A10 V0 performs no:

- provider network call;
- DNS/socket operation;
- database read/write;
- Payment/ProviderAttempt/ProviderEvent mutation;
- ledger/payout/refund operation;
- job/webhook operation;
- audit/idempotency mutation;
- Fastify route registration.

No hosted Supabase migration is part of A10 V0.

## Public error boundary

A10 decisions are internal runtime configuration/security results. They are not directly returned to merchants.

A future live-provider slice must translate a denied/invalid activation state into the already-established fail-closed public behavior without leaking provider lineage, base URLs, evidence digests or provider configuration details.

## TDD gate

Implementation is authorized only after fail-first tests prove the following are absent:

1. required exports;
2. default registry validation + zero authority;
3. tuple/lineage default denial;
4. fixture/current-contract denial;
5. Sandbox-only grant behavior;
6. Production-only grant behavior;
7. duplicate/malformed registry rejection;
8. evidence/base-URL strictness;
9. immutable safe grants;
10. absence of live network implementation in A10.
