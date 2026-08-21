# A19 — Fastify LogController Compatibility — Final Evidence

Date: 2026-08-19  
Status: **DONE**  
Branch: `agent/foundation-phase-0`  
Accepted implementation head: `3882a691ced38e0403ec741d544c8f8b66c17f82`

## 1. Contract boundary

Authoritative artifacts:

- Problem Analysis: `docs/design/a19-fastify-log-controller-compatibility-problem-analysis.md`
- Frozen spec: `docs/specs/fastify-log-controller-compatibility-v0.yaml`
- Frozen contract: `docs/contracts/fastify-log-controller-compatibility-v0.md`
- Fail-first/application contract: `tests/application/062_a19_fastify_log_controller_compatibility.contract.test.mjs`

A19 is compatibility-only. It removes SwiftPay API construction's deprecated Fastify top-level `disableRequestLogging` usage while preserving A12 structured logging and A13 metrics exactly.

A19 does not upgrade Fastify, change a route, alter public HTTP behavior, enable Fastify/Pino logging, change PostgreSQL/Supabase, touch the worker, authorize a provider or mutate a financial state machine.

## 2. TDD proof

RED was observed before implementation on application workflow `32216969526`.

The corrected fail-first suite executed **358 tests: 356 PASS / 2 FAIL**. The only failures were A19:

1. source lacked the required stock `LogController` construction and still used top-level `disableRequestLogging`;
2. an isolated child process emitted Fastify warning `FSTDEP023`.

The RED also corrected one initial verification assumption before production code changed: Fastify `FSTDEP023` is not made process-fatal by Node `--throw-deprecation`, so stderr — not exit status alone — is the explicit warning acceptance surface.

No production file was changed until that corrected RED was established.

## 3. Minimal implementation

Implementation commit: `3882a691ced38e0403ec741d544c8f8b66c17f82`.

The commit changes exactly one production file, `apps/api/src/app.ts`, with exactly two semantic edits:

1. import Fastify's stock `LogController`;
2. replace top-level:

```ts
disableRequestLogging: true
```

with:

```ts
logController: new LogController({
  disableRequestLogging: true,
})
```

The commit diff contains no route, handler, hook, request-ID, logger, metric, auth, admission, provider or financial change.

No custom `LogController` subclass or override exists and no warning suppression was introduced.

## 4. Application GREEN

Application workflow: `32217137426` — GREEN.

Application-contract job:

- dependency install: PASS;
- typecheck: PASS;
- build: PASS;
- tests: **358/358 PASS**;
- A19 contracts: **5/5 PASS**;
- fail/cancelled/skipped/todo: **0/0/0/0**.

A19 specifically proves:

- stock `LogController` replaces the deprecated top-level option;
- no custom LogController subclass/override or warning suppression exists;
- isolated `buildApp()` construction/close emits no `FSTDEP023`;
- A12 server-owned UUID request correlation and exactly-one safe `http_request_completed` event remain unchanged;
- A19 introduces no database/worker/provider/monetary implementation surface.

A12 and A13 regression contracts pass unchanged, including route-template-only completion logging, caller `x-request-id` rejection, bounded metrics and observability/metrics failure isolation.

The CI runner still reports unrelated toolchain warnings about GitHub Actions Node runtime compatibility and Node's `punycode` `DEP0040`; these are not `FSTDEP023` and are outside the frozen A19 boundary.

## 5. Real-runtime regression GREEN

The `runtime-database-acceptance` job in application workflow `32217137426` is GREEN.

Passed against isolated PostgreSQL with production-like runtime identities:

- K7 runtime database acceptance;
- A14 ingress abuse acceptance;
- A18 HMAC rotation acceptance;
- A1 token authentication;
- A2 Pix create/get emulator;
- A3 paid-ledger/balance;
- A4 merchant webhook delivery;
- A6 dashboard authorization;
- A7 webhook endpoint management;
- A8 API credential management;
- A9 merchant transaction operations.

A19 therefore does not regress the previously proven executable path.

## 6. Database regression GREEN

Database workflow: `32217137442` — GREEN.

- pgTAP: **43 files / 1326 assertions PASS**;
- K5 deterministic sandbox fixtures: PASS;
- K6 runtime topology: PASS.

A19 adds no migration and changes no database capability. The canonical hosted Supabase project receives no A19 deployment.

## 7. Authority and side-effect review

A19 introduces:

- no new environment authority;
- no secret authority;
- no database migration or privilege;
- no Data API change;
- no worker authority;
- no provider networking;
- no A10 activation promotion;
- no Payment, ProviderAttempt, ledger, job or webhook transition.

Fastify internal request logging remains disabled; A12 remains SwiftPay's safe structured HTTP logging authority.

## 8. Trade-off

A19 deliberately does not upgrade Fastify. Combining framework-version migration with the deprecated-option repair would widen the behavioral delta and weaken attribution if regression occurred.

A future Fastify major-version upgrade remains a separately testable dependency change. The specific `disableRequestLogging` compatibility debt tracked by SwiftPay is closed.

## 9. Closure

A19 is **DONE**.

The known `FSTDEP023` compatibility debt is removed through Fastify's stock `LogController` path, with clean TDD provenance, 358/358 application contracts, complete real-runtime regression and unchanged database/provider/financial authority.
