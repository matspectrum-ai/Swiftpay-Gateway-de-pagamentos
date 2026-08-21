# SwiftPay V2 — A11 Strict Provider HTTP Transport — TDD RED Evidence

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
Feature: A11 — Strict Provider HTTP Transport Foundation  
Status: **CLEAN RED — IMPLEMENTATION AUTHORIZED NEXT**

## Frozen inputs

- Problem Analysis: `docs/design/a11-strict-provider-http-transport-problem-analysis.md`
- Spec: `docs/specs/strict-provider-http-transport-v0.yaml`
- Contract: `docs/contracts/strict-provider-http-transport-v0.md`
- Fail-first contracts: `tests/application/051_a11_strict_provider_http_transport.contract.test.mjs`

## Application RED

Commit under test: `1298ebea7adc915ab2cc17c95be9450565af4a59`.

Application workflow: `32012444428`.

- dependency install: GREEN;
- typecheck: GREEN;
- build: GREEN;
- application contracts: intentionally RED;
- total tests: **265**;
- previous K7/A1-A10 tests PASS: **250**;
- new A11 tests FAIL: **15**;
- failures are assertion-level and caused by the four required A11 exports being absent;
- no parser, module-resolution, typecheck, build or harness failure occurred.

The 15 RED vectors cover construction branding, default deny-before-network, grant-derived destination, path/header/body validation, DNS/public-address policy, one-attempt/no-retry semantics, conservative ambiguity classification, bounded fatal UTF-8 response handling, safe error objects, Node resolver/executor structural security and explicit non-wiring into A5 adapters.

## Database and runtime regression gate

Database workflow: `32012444422` — GREEN.

- pgTAP: existing **40 files / 1292 assertions PASS**;
- K5 deterministic sandbox fixtures: GREEN;
- K6 runtime topology: GREEN.

The first runtime-database-acceptance execution on application workflow `32012444428` produced an unrelated A8 concurrency-harness failure: `concurrent_limit_created_5`. A11 at this checkpoint contains only documentation/tests and has no runtime/database code capable of affecting A8.

The same runtime job was rerun in isolation on the **same commit** and completed GREEN:

- K7: GREEN;
- A1: GREEN;
- A2: GREEN;
- A3: GREEN;
- A4: GREEN;
- A6: GREEN;
- A7: GREEN;
- A8: GREEN;
- A9: GREEN.

This proves the first A8 failure was nondeterministic acceptance-harness behavior rather than a branch regression. No A8 product code or database behavior was changed to obtain the clean rerun.

## Safety state

At RED:

- no `packages/providers/src/http-transport.ts` implementation exists;
- no retained PSP network call exists;
- no A5 adapter is wired to live transport;
- default A10 registry still authorizes zero provider operations;
- no Supabase migration or hosted change exists;
- no financial/provider/ledger/job/webhook/credential state is mutated by A11.

## Authorized next step

Implement only the frozen A11 transport boundary in `packages/providers`, make the 15 new contracts GREEN without weakening them, rerun all prior application/database/runtime regressions, and preserve zero retained-provider traffic under the default registry.
