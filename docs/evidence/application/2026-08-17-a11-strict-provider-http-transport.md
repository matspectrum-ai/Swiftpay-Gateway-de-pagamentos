# SwiftPay V2 — A11 Strict Provider HTTP Transport — Final Evidence

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
Feature: A11 — Strict Provider HTTP Transport Foundation  
Status: **DONE / GREEN / UNBOUND FROM RETAINED PSP ADAPTERS**

## Frozen artifacts

- Problem Analysis: `docs/design/a11-strict-provider-http-transport-problem-analysis.md`
- Spec: `docs/specs/strict-provider-http-transport-v0.yaml`
- Contract: `docs/contracts/strict-provider-http-transport-v0.md`
- Fail-first/final contracts: `tests/application/051_a11_strict_provider_http_transport.contract.test.mjs`
- RED evidence: `docs/evidence/application/2026-08-17-a11-strict-provider-http-transport-red.md`

## Implementation

Behavioral GREEN head: `7f3b373fe0bdfe32ae9f1924e9e461071abeea6d`.

Implemented boundary:

- `packages/providers/src/http-transport.ts`
- `packages/providers/src/index.ts` reexport only

Public A11 exports:

- `ProviderHttpTransportError`
- `createStrictProviderHttpTransport`
- `createNodeProviderDnsResolver`
- `createNodeProviderHttpsExecutor`

No A5 retained-provider adapter was wired to the new transport.

## Final application proof

Application workflow: `32014646148` — GREEN.

- frozen dependency install: GREEN;
- typecheck: GREEN;
- build: GREEN;
- application contracts: **265/265 PASS**;
- A11 contracts: **15/15 PASS**;
- K7/A1/A2/A3/A4/A6/A7/A8/A9 real-database acceptance: GREEN.

A5 compatibility was deliberately refined after the first GREEN attempt exposed a now-obsolete package-wide assertion that no Node network primitive could exist anywhere in `packages/providers`. The replacement contract is stronger and matches the frozen A11 architecture: `http-transport.ts` must be the **only** provider-package Node network boundary, while retained A5 adapters remain network-free and unbound from A11. No A11 test was weakened.

## Final database/regression proof

Database workflow: `32014646143` — GREEN.

- pgTAP: existing **40 files / 1292 assertions PASS**;
- K5 deterministic sandbox fixtures: GREEN;
- K6 trusted runtime topology: GREEN.

A11 introduces no SQL, migration, database privilege, hosted Supabase state or runtime DB capability.

## Proven transport behavior

A11 now proves:

- construction requires a runtime-validated A10 registry; raw/unbranded registry fails closed;
- provider + operation + environment + exact contract lineage are authorized inside the transport through A10 before DNS/network execution;
- the checked-in A10 registry denies every retained-provider operation before DNS and HTTPS;
- destination origin/base path comes exclusively from the immutable A10 authorization grant;
- caller cannot supply/override an absolute destination, scheme-relative URL, root path, backslash path, fragment, dot traversal or base-path escape;
- only GET and POST are accepted; GET bodies are rejected;
- reserved routing/hop-by-hop headers and CRLF are rejected before DNS;
- request path/header/body sizes are bounded before DNS;
- DNS uses fresh `dns.lookup(..., { all: true, order: 'verbatim' })` resolution per send;
- empty, failed, private, reserved or mixed public/private DNS results fail before HTTPS;
- first validated public address is pinned for the request;
- Node HTTPS connects to the pinned address while preserving approved hostname for SNI and Host;
- certificate verification is enabled, TLS minimum is 1.2 and connection pooling is disabled for the isolated executor;
- request timeout is 5 seconds;
- response header ceiling is 16 KiB and response body ceiling is 1 MiB;
- automatic redirects, retries, proxy routing and transparent response decompression are absent;
- each send invokes the executor at most once;
- 3xx, 408, 425, 429 and 5xx are returned once to the caller rather than retried or followed;
- timeout/network/oversized/invalid-UTF8/invalid-status outcomes become redaction-safe `transmission_unknown` errors;
- response UTF-8 decoding is fatal rather than replacement-based;
- response header names/repeated values are normalized deterministically;
- transport errors contain only safe classification fields and never request/response payloads or credentials.

## Production safety state

A11 provides a production-grade outbound HTTPS primitive, but it grants no PSP authority by itself.

At closure:

- default A10 runtime-authorized retained-provider operations: **0**;
- A5 AkkadPag adapter live wiring: **absent**;
- A5 FlevoPay adapter live wiring: **absent**;
- live retained-provider calls made by A11 tests/CI: **0**;
- provider webhook ingress: still blocked;
- provider recovery/reconciliation: still blocked;
- current provider contract/lineage evidence gate: still unresolved;
- authenticated current sandbox proof gate: still unresolved;
- Production `production_enabled` transition: not authorized.

No readiness percentage is increased merely because the safe transport primitive exists. The production risk remains dominated by exact current PSP authority and sandbox/live acceptance evidence.

## Next permitted direction

Do not wire A5 adapters to A11 under the checked-in registry.

A future provider bridge/activation slice requires current provider-owned contract evidence and applicable authenticated sandbox proof first. Until then, the safest next internal slice should be selected independently from remaining merchant/product/hardening work, while PSP evidence acquisition continues in parallel.
