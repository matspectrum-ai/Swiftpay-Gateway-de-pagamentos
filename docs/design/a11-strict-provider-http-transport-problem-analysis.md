# SwiftPay V2 — A11 Strict Provider HTTP Transport Foundation — Problem Analysis

Date: 2026-08-17  
Status: **FROZEN PROBLEM ANALYSIS**  
Next artifact: `docs/specs/strict-provider-http-transport-v0.yaml`

## Problem statement

A10 now makes retained-provider activation an executable default-deny decision. Its checked-in registry authorizes zero runtime provider operations.

The next production-oriented gap is the network boundary itself.

The current A5 adapters operate against an injected abstract `ProviderTransport`. That abstraction is intentionally fixture-compatible and contains no live HTTP implementation. A future live implementation must not become a generic arbitrary-URL HTTP client, must not bypass A10, must not silently follow redirects, and must not introduce transparent retry of monetary POSTs.

A11 will establish a **strict HTTPS transport foundation for provider traffic** that is safe to exist in the codebase even while every retained provider operation remains denied by the default A10 registry.

A11 does not activate AkkadPag, AkadPay or FlevoPay. It does not change any A10 record above `fixture_only`/`unsupported`, does not resolve provider credentials, does not wire live transport into the A2 Payment execution path, and performs no real PSP call during implementation or acceptance.

## Why this slice is next

The current critical path is:

```text
A10 activation authority gate       DONE / zero authority
  -> strict provider HTTPS boundary A11
  -> current provider evidence      EVIDENCE_REQUIRED
  -> authenticated sandbox proof
  -> sandbox_proven activation
  -> provider-specific runtime integration
  -> webhook verification/recovery
  -> production_enabled activation
```

Implementing provider-specific live endpoints before a strict reusable transport boundary would duplicate network policy and increase the probability of SSRF/origin confusion, redirect leakage, credential leakage, accidental retry or DNS-rebinding defects.

A11 therefore solves transport safety first while preserving zero live authority.

## Existing proven pattern to reuse

A4 merchant webhook delivery already proves a useful outbound network pattern in `packages/webhooks/src/legacy.ts`:

- HTTPS only;
- DNS resolution before connection;
- rejection of non-public IPv4/IPv6 addresses;
- reject the complete destination if any resolved address is non-public;
- pin the selected resolved address for the actual socket connection;
- preserve the original hostname for TLS SNI and Host;
- no automatic redirect following;
- bounded timeout.

A11 should preserve these invariants instead of inventing a conflicting egress policy.

The provider case differs in two important ways:

1. the provider origin is security-reviewed A10 configuration rather than merchant input;
2. the target path comes from a provider adapter and must not be able to escape the reviewed A10 base-path authority.

## Node.js 24 implementation constraints verified for planning

The repository currently runs Node.js 24.

Current Node.js 24 documentation confirms:

- `https.request()` accepts TLS options including `servername`;
- client requests support `maxHeaderSize`;
- `dns.lookup(..., { all: true })` can return all resolved addresses;
- current Node guidance favors `order: 'verbatim'` over the deprecated `verbatim` lookup option;
- HTTPS requests do not require a redirect-following abstraction; redirects can remain ordinary 3xx responses.

A11 may therefore use the same low-level Node HTTPS + DNS approach as A4, with the policy differences frozen below.

## Critical architecture decision: A11 must not trust a structurally forgeable grant

The A10 public grant is immutable decision context, but TypeScript object shapes are not runtime authority by themselves.

A11 must not expose a public API of the form:

```text
send(anyObjectThatLooksLikeGrant, request)
```

because a caller could construct a lookalike object.

A11 V0 will instead accept a **validated A10 registry** at construction time. The existing A10 authorizer already runtime-checks that a registry came through `parseProviderActivationRegistry` using an internal, non-exported brand.

The A11 send sequence is therefore:

```text
validated A10 registry
  -> A11 internally constructs/uses A10 authorizer
  -> caller supplies exact provider/operation/environment/lineage subject + adapter request
  -> A10 authorizer mints the immutable grant internally
  -> only an authorized internal grant reaches the network executor
```

A caller-supplied grant or caller-supplied provider base URL is not accepted by the A11 public boundary.

This preserves the intended A10 rule that network origin authority exists only after a successful A10 decision while avoiding structural-grant forgery.

## A11 V0 package ownership

A11 remains in `packages/providers` because it is provider-runtime infrastructure and must sit adjacent to A5/A10 provider contracts.

Preferred module separation:

```text
packages/providers/src/activation.ts  A10 evidence/authority
packages/providers/src/http-transport.ts A11 network policy/execution
packages/providers/src/index.ts       public exports + legacy A5 adapters
```

A11 must not move provider DTO mapping, Payment orchestration or credential storage into the transport module.

## Public A11 boundary

Exact TypeScript names/signatures belong in the YAML/contract phase, but V0 conceptually exposes:

```text
createStrictProviderHttpTransport({ validatedActivationRegistry, networkPolicy? })

transport.send({
  subject: {
    provider,
    operation,
    environment,
    contractLineage
  },
  request: {
    method,
    relativePath,
    headers,
    bodyUtf8?
  }
})
```

The public A11 boundary does not accept:

- `baseUrl`;
- absolute destination URL;
- provider credentials separately from the adapter-produced request;
- a raw A10 grant;
- retry count/policy;
- redirect policy override;
- TLS verification disable flag;
- proxy URL;
- arbitrary DNS result/pinned IP in production composition.

Deterministic tests may inject low-level DNS/socket/HTTPS primitives through a deliberately narrow testable dependency seam, but those primitives cannot alter authorization/origin/path policy.

## Authorization order

A11 must fail closed in this exact conceptual order:

```text
1. validate A11 request shape and bounded sizes
2. ask A10 authorizer for exact subject authorization
3. if denied: stop before DNS, secret/network side effects or socket creation
4. derive destination only from grant.approvedBaseUrl + validated relativePath
5. prove derived URL stays inside exact approved origin/base path
6. resolve approved hostname
7. reject if no addresses or if any resolved address is non-public
8. pin one validated public address
9. perform exactly one HTTPS attempt
10. return one bounded raw provider HTTP response or one typed transport failure
```

A10 denial must be observable in tests as **zero DNS calls and zero network calls**.

## Destination authority

The A10 grant is the sole origin authority.

A11 must never derive provider origin from:

- adapter `relativePath`;
- request headers (`Host`, forwarding headers, etc.);
- customer/merchant input;
- provider response;
- environment variables such as generic `PROVIDER_BASE_URL` or `ENABLE_LIVE`;
- provider credentials;
- DNS aliases discovered at runtime.

### Relative path rules

Provider adapters emit a relative path, including an optional query string.

A11 V0 must reject before DNS/network:

- empty path;
- absolute URLs;
- scheme-relative strings beginning `//`;
- paths beginning `/` that replace the reviewed base pathname;
- backslashes;
- fragments;
- literal or percent-encoded dot-segments capable of path traversal;
- any normalized target whose origin differs from the approved base URL;
- any normalized target whose pathname no longer begins with the approved base pathname.

Examples with base:

```text
https://provider.example/api/v1/
```

Allowed conceptually:

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
transactions#fragment
```

This prevents an adapter bug from escaping the contract lineage's reviewed base-path authority.

## DNS and SSRF / rebinding policy

A11 reuses the A4 public-address principle.

For every request:

1. resolve the approved hostname through the runtime resolver;
2. request all addresses in resolver order;
3. require at least one address;
4. reject the entire request if **any** returned IPv4/IPv6 address is non-public;
5. select the first validated public address as the pinned connection target;
6. connect to the pinned IP, not the hostname;
7. preserve the approved hostname for TLS SNI and the HTTP Host header.

Blocked address classes must remain at least as strict as A4, including loopback, RFC1918/ULA, link-local, carrier-grade NAT, documentation/test ranges, benchmarking, multicast and reserved ranges, including IPv4-mapped IPv6 handling.

A DNS failure or destination-policy rejection occurs before a provider socket is opened.

A11 should use Node's current `order: 'verbatim'` lookup option rather than adding a new IPv4/IPv6 preference that might change provider routing unexpectedly.

## TLS policy

A11 V0 is HTTPS only.

Required:

- certificate verification remains enabled;
- original approved hostname is used as TLS `servername` even though the socket target is the pinned IP;
- no `rejectUnauthorized: false` escape hatch;
- no custom insecure CA injection through the public transport API;
- minimum TLS version should be at least TLS 1.2;
- redirects are not followed;
- connection reuse across provider requests is not required in V0; safety and deterministic origin pinning take priority over keep-alive optimization.

A provider that later requires mTLS or a provider-specific CA requires a separate reviewed contract/slice rather than weakening A11 globally.

## Request method boundary

A5 currently requires only:

```text
GET
POST
```

A11 V0 therefore supports exactly GET and POST.

No PUT/PATCH/DELETE/CONNECT/TRACE/OPTIONS expansion occurs without a later contract change.

## Header policy

Adapter-produced headers may carry provider credentials such as:

- `Authorization`;
- `X-API-Key`;
- provider-specific withdrawal keys.

A11 must treat every request header/body as sensitive operational data and never log or persist them.

Before network execution A11 must reject caller-supplied hop-by-hop or routing authority headers, including at minimum:

```text
Host
Connection
Proxy-Connection
Proxy-Authorization
Transfer-Encoding
Upgrade
TE
Trailer
Forwarded
X-Forwarded-Host
X-Forwarded-Proto
X-Forwarded-For
```

A11 owns the canonical Host header derived from the approved provider origin.

Header names/values must be valid HTTP tokens/values and must not contain CR/LF. Node's own validation remains a second line of defense, not the first contract.

A11 V0 does not invent provider authentication headers or content types. Provider-specific headers remain adapter/contract responsibilities.

A11 may set transport-owned framing such as exact `Content-Length` from the UTF-8 bytes that it actually sends.

## Bounded request/response policy

Provider payloads are expected to be small. A transport boundary must not provide unbounded memory consumption.

Freeze the following V0 safety ceilings for the spec phase:

```text
request body: 256 KiB UTF-8 bytes
response body: 1 MiB bytes
response header size: 16 KiB
request timeout: 5,000 ms
```

Rationale:

- the 5-second timeout matches the already-proven A4 outbound runtime policy;
- 16 KiB matches the current Node client default header-size ceiling and should be set explicitly for deterministic behavior;
- the body ceilings are far above known Pix JSON payload needs while bounding memory exposure.

A future provider with an authoritative contract requiring a larger body or timeout needs an explicit spec revision. A11 V0 does not accept arbitrary per-call overrides.

## Redirect policy

A11 never follows redirects.

Any HTTP 3xx is returned as a raw provider response to the provider adapter/classifier. The transport does not repeat the request at a Location target.

This prevents:

- credential leakage to another origin;
- path/origin authority bypass;
- accidental second monetary POST;
- hidden method rewriting.

## No transparent retry

A11 performs **exactly one network attempt per `send` call**.

It never retries on:

- DNS errors;
- connect errors;
- TLS errors;
- timeout/reset;
- HTTP 408/425/429;
- 5xx;
- malformed/oversized response;
- redirect.

Retry/recovery semantics belong to the higher provider/payment state machine and must be justified by the exact provider contract.

This is especially important for monetary POSTs: transport convenience must never become duplicate-money risk.

## Typed transport failure phases

A11 should make future money-safe classification possible without claiming more certainty than it has.

Transport failures need at least two internal phases:

```text
pre_transmission
transmission_unknown
```

### `pre_transmission`

Reserved for failures proven before provider socket/request execution, for example:

- A10 denial;
- invalid request shape/path/header/body size;
- destination derivation failure;
- DNS lookup failure;
- non-public/mixed DNS result rejection.

### `transmission_unknown`

Once the HTTPS request object/socket execution begins, network/TLS/timeout/reset/response-stream failures are conservatively classified as `transmission_unknown` unless the implementation can prove no HTTP application bytes could have been transmitted.

A11 V0 should prefer false ambiguity over a false `pre_transmission` claim.

An oversized or malformed response after a request was sent is also `transmission_unknown` for create operations; higher layers decide operation-specific consequences.

A11 itself does not convert this into Payment `execution_unknown`; it returns typed transport evidence for the future provider-runtime integration slice.

## Raw HTTP response boundary

A successful network exchange means only that an HTTP response was received within bounds.

A11 returns a transport response containing only the provider-facing raw HTTP primitives required by A5 adapters:

```text
statusCode
normalized response headers
bodyUtf8
```

A11 does not interpret:

- provider status vocabulary;
- Pix QR data;
- idempotency semantics;
- definitive failure vs ambiguous business result;
- recovery identifiers.

Those remain provider adapter / provider-contract responsibilities.

Invalid UTF-8 response handling must be deterministic; the exact policy belongs in the spec. A11 must not silently replace undecodable bytes and then let an adapter treat corrupted JSON as authoritative.

## Credential and data leakage boundary

A11 may transmit adapter-produced sensitive headers/body only to the exact authorized provider destination.

It must never persist or expose through errors/log-safe result fields:

- provider API keys/secrets;
- Basic/JWT/Bearer authorization values;
- withdrawal keys;
- customer name/email/phone/document;
- Pix keys;
- full provider request/response bodies.

Transport errors should expose stable codes, provider/operation/environment/lineage and failure phase only. Any observability payload must be safe-by-construction.

## Proxy/environment isolation

A11 must not silently honor generic HTTP(S) proxy environment variables in a way that bypasses pinned-IP/SNI egress policy.

Production Node transport should use an explicit direct HTTPS connection strategy. Proxy support, if ever required, is a separate reviewed egress design.

Likewise, environment variables must not be able to replace the A10 approved origin.

## Relationship to current A5 adapter interface

A11 V0 will **not** wire itself into `createAkkadPagAdapter` or `createFlevoPayAdapter` yet.

Reason:

- current provider contracts remain blocked;
- adapter integration would create a temptation to supply real credentials/base URLs before sandbox evidence is authoritative;
- current A5 `ProviderTransport` does not carry an A10 operation subject.

A11 therefore introduces a strict authorized network primitive alongside the existing fixture transport abstraction.

A later provider-runtime integration slice must explicitly bridge:

```text
canonical operation
  -> exact A10 subject
  -> A11 authorized transport
  -> A5/provider adapter mapping
  -> money-safe result classification
```

That later bridge must be TDD-driven and provider-contract-specific.

## Testability without real PSP traffic

A11 must be fully testable without contacting any external PSP.

The design should separate:

1. authorization/destination/DNS/header/body policy;
2. low-level HTTPS execution.

Unit/contract tests can inject deterministic resolver and HTTPS execution primitives to prove:

- A10 deny means zero resolver/network calls;
- exact URL/base-path derivation;
- DNS mixed/private rejection;
- pinned-IP + SNI/Host request construction;
- no redirect/retry behavior;
- one-attempt invariant;
- body/response bounds;
- typed failure phase;
- redaction-safe failures.

A production Node HTTPS primitive can then be verified structurally without making a retained-provider call. Any loopback integration fixture must not weaken the production A10 origin policy or become an alternate public constructor.

## No database / public API changes in A11 V0

A11 requires no Supabase migration.

A11 does not add or change:

- public Fastify routes;
- dashboard routes;
- Payment status transitions;
- ProviderAttempt persistence;
- provider webhook ingress;
- ledger/payout/refund behavior;
- jobs;
- credentials;
- idempotency/audit;
- KYC/customer state.

## Default runtime consequence

Because the checked-in A10 registry authorizes zero operations, the presence of A11 code must still result in:

```text
real retained-provider outbound calls = 0
```

under default composition.

A11 GREEN alone therefore does not increase production readiness percentages. The meaningful readiness movement occurs only when current provider evidence plus authenticated sandbox acceptance justifies an explicit A10 state transition and a provider-runtime bridge proves safe behavior.

## Non-goals

A11 V0 does not:

- prove AkkadPag == AkadPay;
- replace AkkadPag with AkadPay;
- update any A10 registry record to `current_contract_proven`, `sandbox_proven` or `production_enabled`;
- resolve/store provider credentials;
- call a retained PSP;
- integrate live transport into Payment create/query;
- implement provider-specific retry;
- implement provider webhook verification;
- implement recovery/reconciliation;
- implement mTLS;
- support arbitrary proxies;
- follow redirects;
- add a generic arbitrary-URL HTTP client.

## Acceptance criteria for leaving Problem Analysis

The YAML/contract phase may begin because this Problem Analysis freezes the required behavior categories. The next artifacts must define deterministically:

1. exact exported A11 types/functions;
2. exact validated-registry construction dependency;
3. exact subject/request/response/error schemas;
4. URL/base-path normalization and traversal test vectors;
5. public IPv4/IPv6 policy and DNS pinning behavior;
6. TLS/SNI/Host construction;
7. header denylist/validation;
8. body/header/time bounds;
9. exactly-one-attempt/no-redirect/no-retry semantics;
10. pre-transmission vs transmission-unknown error taxonomy;
11. invalid UTF-8/oversized response behavior;
12. deterministic test injection seam that cannot bypass production authorization;
13. proof that A11 is not wired to real provider execution and default A10 authority remains zero.

## Decision

Proceed with A11 as a **strict, grant-gated, provider-only HTTPS transport foundation**.

Do not implement provider-specific live runtime integration or make any real PSP request in A11.