# SwiftPay V2 — Strict Provider HTTP Transport V0 Contract

Status: frozen for TDD  
Feature: A11 — Strict Provider HTTP Transport Foundation

## Purpose

A11 creates the first production-capable provider HTTPS primitive, but it remains unusable for retained PSP traffic under the checked-in A10 registry because every retained operation is denied.

The transport is not a generic HTTP client. It derives provider origin exclusively from A10 authorization, performs one pinned HTTPS attempt, never follows redirects and never retries.

## Package ownership

A11 belongs to `packages/providers`, preferably `src/http-transport.ts`.

Required exports:

```ts
ProviderHttpTransportError
createStrictProviderHttpTransport
createNodeProviderDnsResolver
createNodeProviderHttpsExecutor
```

Existing A5 `ProviderTransport` and adapter method signatures remain unchanged in A11 V0. A11 is not wired to either retained provider adapter yet.

## Construction

Conceptual constructor:

```ts
createStrictProviderHttpTransport({
  registry,
  resolver?,
  executor?,
})
```

`registry` must be a runtime-validated A10 registry returned by `parseProviderActivationRegistry`.

A11 internally calls `createProviderOperationAuthorizer` and never accepts a raw grant or base URL from the caller.

An arbitrary/unbranded registry causes construction to throw `ProviderHttpTransportError`:

```ts
{
  name: 'ProviderHttpTransportError',
  code: 'activation_registry_invalid',
  phase: 'pre_transmission'
}
```

No resolver/executor/network side effect occurs during construction.

Optional `resolver` and `executor` dependencies exist only as a narrow deterministic test seam. They receive no authority to bypass A10 or choose a provider origin.

## Send input

```ts
transport.send({
  subject: {
    provider,
    operation,
    environment,
    contractLineage,
  },
  request: {
    method: 'GET' | 'POST',
    relativePath: string,
    headers: Record<string, string>,
    bodyUtf8?: string,
  },
})
```

Authorization subject semantics are exactly A10.

## Authorization order

Before DNS or executor invocation A11 must:

1. validate the request shape and size ceilings;
2. obtain an A10 authorization decision for the exact subject;
3. reject a denied decision;
4. derive the target from the authorized grant base URL plus the validated relative path;
5. prove exact origin and approved-base-path containment.

A10 denial returns/rejects with:

```text
code = activation_denied
phase = pre_transmission
```

The error must not include the A10 evidence digest, base URL, request headers/body or credentials.

With the default A10 registry, every send is denied before resolver/executor invocation.

## Request validation

Supported methods are exactly `GET` and `POST`.

A GET request cannot contain `bodyUtf8`.

Limits:

```text
relativePath UTF-8 bytes <= 4096
request headers count <= 64
request header aggregate UTF-8 bytes <= 16384
request body UTF-8 bytes <= 262144
```

A validation failure is:

```text
code = request_invalid
phase = pre_transmission
```

### Relative path

Required:

- nonempty;
- relative to the A10 approved base URL;
- query string allowed.

Forbidden:

- absolute URL;
- leading `/`;
- leading `//`;
- backslash;
- fragment;
- literal `.` or `..` path segment;
- percent-encoded dot traversal segment, case-insensitive;
- any normalized target with a different origin;
- any normalized pathname outside the approved base pathname.

For approved base `https://provider.example/api/v1/`, examples:

Allowed:

```text
transactions
transactions/abc
query?action=get_transaction&id=abc
```

Denied:

```text
/transactions
../admin
%2e%2e/admin
//attacker.example/x
https://attacker.example/x
transactions#frag
```

## Header policy

Header names are validated as HTTP token strings. Header values are strings and cannot contain CR/LF.

These names are reserved and rejected case-insensitively when supplied by the adapter/caller:

```text
host
connection
proxy-connection
proxy-authorization
transfer-encoding
upgrade
te
trailer
forwarded
x-forwarded-host
x-forwarded-proto
x-forwarded-for
content-length
accept-encoding
expect
```

Transport-owned headers:

```text
Host: approved URL host, including explicit port when present
Accept-Encoding: identity
Content-Length: exact UTF-8 body bytes when body exists; 0 for POST without body
```

A11 does not invent provider authentication or Content-Type headers.

Request headers/body are sensitive and must never be copied into errors/log-safe output.

## DNS resolver contract

Production factory:

```ts
createNodeProviderDnsResolver()
```

It resolves through current Node `dns.lookup()` semantics with:

```text
all = true
order = verbatim
```

Every send performs a fresh resolution.

Resolver result must contain at least one address and **every** returned address must pass the public-address policy. A mixed public/private answer rejects the full destination.

A11 uses at least the same blocked IPv4/IPv6 classes as A4, including IPv4-mapped IPv6 handling.

The first validated public address becomes the pinned socket destination.

Errors:

```text
DNS lookup failure:
  code = dns_unavailable
  phase = pre_transmission

empty/non-public/mixed result:
  code = destination_policy
  phase = pre_transmission
```

The HTTPS executor is not invoked for either case.

## HTTPS executor contract

Production factory:

```ts
createNodeProviderHttpsExecutor()
```

The executor input is fully derived by the strict transport and contains:

```text
method
pinnedAddress
approved hostname
approved host (hostname[:port])
approved port or 443
path + query
validated headers
body bytes
5000 ms timeout
16384 byte response-header ceiling
1048576 byte response-body ceiling
minimum TLS version TLSv1.2
```

Production behavior:

- direct HTTPS connection to pinned IP;
- SNI = approved hostname;
- Host = approved host;
- certificate verification enabled;
- minimum TLS 1.2;
- no automatic proxy environment behavior;
- no redirect-following logic;
- no transparent retry;
- one network attempt per `send`.

Connection pooling/keep-alive is not required in V0.

## Raw response

A received bounded HTTP response returns:

```ts
{
  statusCode: number,
  headers: Record<string, string>,
  bodyUtf8: string,
}
```

Requirements:

- status must be an integer from 100 through 599;
- response header names are lowercase;
- repeated response header values join deterministically using `, `;
- body decoding is fatal UTF-8: replacement-character decoding is forbidden;
- response body maximum is 1 MiB.

A11 does not interpret provider business semantics.

HTTP 3xx, 408, 425, 429 and 5xx are returned once as ordinary raw HTTP responses. They do not trigger redirects or retry in A11.

## Failure taxonomy

`ProviderHttpTransportError` has only safe public diagnostic fields:

```ts
name: 'ProviderHttpTransportError'
code: string
phase: 'pre_transmission' | 'transmission_unknown'
```

No request/response body/header/credential data is attached.

Pre-transmission codes:

```text
activation_registry_invalid
activation_denied
request_invalid
destination_policy
dns_unavailable
```

Once the HTTPS executor is invoked, executor/response failures are conservatively `transmission_unknown`:

```text
network_error
timeout
response_too_large
response_invalid_utf8
response_invalid_status
```

A11 prefers false ambiguity to a false assertion that a monetary request was not transmitted.

A11 does not itself change a Payment or ProviderAttempt to `execution_unknown`; the later provider-runtime bridge consumes this transport evidence.

## No retry invariant

Exactly one executor invocation is permitted per authorized `send` call.

A11 never retries DNS, connect, TLS, timeout, reset, HTTP errors, redirects or malformed/oversized responses.

DNS resolution itself may return multiple addresses, but A11 does not fail over to a second address after a network attempt. Doing so could duplicate a monetary POST.

## Default authority invariant

The checked-in `DEFAULT_PROVIDER_ACTIVATION_REGISTRY` authorizes zero operations.

Therefore A11 code existing in the repository must not make real retained-provider traffic possible under default composition.

## Side-effect boundary

A11 V0 adds no:

- retained-provider call in tests/acceptance;
- provider credential storage/resolution;
- adapter integration;
- Payment/ProviderAttempt/ProviderEvent mutation;
- Supabase migration;
- public/dashboard route;
- ledger/payout/refund/job/webhook/idempotency/audit/KYC change.

## TDD gate

Implementation is authorized only after fail-first tests prove the absence of:

1. required exports;
2. branded A10 construction gate;
3. default-registry deny-before-DNS/network;
4. exact grant-derived origin/base-path containment;
5. path/header/body/method safety validation;
6. public-only DNS and pinning;
7. pinned-IP + SNI/Host executor construction;
8. one-attempt/no-redirect/no-retry behavior;
9. bounded fatal-UTF8 response handling;
10. safe pre-transmission/transmission-unknown errors;
11. production Node resolver/executor structural security;
12. any accidental A5/live provider wiring.
