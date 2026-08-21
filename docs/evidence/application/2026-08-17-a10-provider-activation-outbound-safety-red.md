# A10 — Provider Activation & Outbound Safety — CLEAN RED

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
Status: **TDD RED — IMPLEMENTATION AUTHORIZED**

## Frozen authority

- Problem Analysis: `docs/design/a10-provider-activation-outbound-safety-problem-analysis.md`
- Spec: `docs/specs/provider-activation-outbound-safety-v0.yaml`
- Contract: `docs/contracts/provider-activation-outbound-safety-v0.md`
- Current retained-provider revalidation: `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`

A10 is a network-free default-deny activation boundary. It authorizes no provider traffic in its checked-in initial state and introduces no provider HTTP transport, route, database change, credential store or monetary side effect.

## Fail-first commit

`254dee966cc66af58240b8d11a8aaad1911cbed8`

Test file:

- `tests/application/050_a10_provider_activation_outbound_safety.contract.test.mjs`

## Application RED proof

Workflow: `32010941614`  
Application-contract job: `95330147090`

- dependency install: PASS;
- TypeScript typecheck: PASS;
- build: PASS;
- test total: **250**;
- previous K7/A1-A9/A5 application contracts: **240 PASS**;
- new A10 contracts: **exactly 10 FAIL**;
- parser/module/typecheck/harness failures: **0**.

All ten failures are assertion-level absence of the new A10 provider activation exports. The first required constant is `undefined`, proving the behavior is missing rather than malformed.

The missing A10 contracts cover:

1. required package exports;
2. valid default registry with zero authority;
3. unregistered subject and exact-lineage denial;
4. fixture/current-contract denial;
5. exact Sandbox authorization grant;
6. Sandbox/Production separation;
7. complete invalidation for duplicate/unknown/missing/enum-drift registry data;
8. state-bound evidence metadata and caller-mutation isolation;
9. strict digest/timestamp/provider-origin validation;
10. immutable safe grant plus continued absence of live network implementation.

## Runtime regression proof

Workflow `32010941614`, runtime-database-acceptance job `95330147138`: **GREEN**.

Real isolated PostgreSQL acceptance remains PASS for:

- K7;
- A1;
- A2;
- A3;
- A4;
- A6;
- A7;
- A8;
- A9.

A10 adds no database acceptance because its V0 contract has no database behavior.

## Database regression proof

Workflow: `32010941697`.

- pgTAP job `95330147556`: GREEN — existing **40 files / 1292 assertions PASS**;
- K5 sandbox fixtures job `95330147358`: GREEN;
- K6 runtime topology job `95330147458`: GREEN.

No A10 migration exists or is planned in V0.

## Implementation authority

The clean RED authorizes only the minimal `packages/providers` implementation required by the frozen A10 spec/contract:

- version/schema constant;
- checked-in zero-authority default registry;
- strict registry parser/validator;
- exact tuple/lineage/state authorizer;
- immutable in-memory grant.

It does **not** authorize:

- Fetch/Undici/HTTP provider transport;
- DNS/socket access;
- AkkadPag/AkadPay/FlevoPay monetary requests;
- provider credentials;
- provider webhook ingress;
- database migrations;
- public/dashboard routes;
- activation of any default registry record above fixture-only/unsupported.
