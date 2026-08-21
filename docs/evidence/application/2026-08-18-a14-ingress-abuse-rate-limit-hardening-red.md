# A14 — Trusted Ingress, Abuse & Rate-Limit Hardening — RED Evidence

Date: 2026-08-18  
Status: **TDD RED — implementation authorized next**  
Branch: `agent/foundation-phase-0`

## Frozen authority before tests

Problem Analysis:

- `docs/design/a14-ingress-abuse-rate-limit-hardening-problem-analysis.md`
- commit `16471ac874bacafe9c1934af7a3dff697570b8a2`

Specification:

- `docs/specs/ingress-abuse-rate-limit-hardening-v0.yaml`
- commit `2ea42ef92f33c2ac1432af4f88f7bac8606be8b9`

Contracts:

- `docs/contracts/ingress-abuse-rate-limit-hardening-v0.md`
- commit `25fbf58725608bd05fa80aa98d8797e8de05f9a4`
- `docs/contracts/ingress-abuse-rate-limit-hardening-database-v0.md`
- commit `b53b43b33ee568d1e9c1af28dfe844678cb3d57f`

No implementation authority existed before those artifacts were frozen.

## Fail-first tests

Application behavior/wiring:

- `tests/application/054_a14_ingress_abuse_rate_limit_hardening.contract.test.mjs`
- commit `997345aae40e1c2340e4dd204f57ae3ec1b86842`

Database adapter:

- `tests/application/055_a14_abuse_database_adapter.contract.test.mjs`
- commit `2651760ab19f06e4aaacecb0831e34913d1fbba6`

Real PostgreSQL behavior acceptance:

- `tests/application/056_a14_ingress_abuse_runtime_driver.mjs`
- commit `752050610290233b454b86b23725f051ae2a24e7`
- `tests/application/056_a14_ingress_abuse_runtime_acceptance.sh`
- commit `44ef6b4665ac27343515dd0f8ac66346a51e9ee5`

Database structural contract:

- `supabase/tests/database/041_ingress_abuse_rate_limit_hardening.test.sql`

Workflow wiring for real acceptance:

- `.github/workflows/application-contracts.yml`
- RED head `57277ed187c830a7b78fc7172a28687d1c5a2298`

## RED proof

### Application workflow

Run `32095966149`.

Application-contract job:

- frozen dependency installation: GREEN;
- typecheck: GREEN;
- build: GREEN;
- total tests: **306**;
- prior A1-A13 tests passing: **289**;
- A14 fail-first tests failing: **17**;
- unexpected prior-feature regression: **0**.

The A14 failures are attributable to deliberately absent capabilities: `@swiftpay/abuse`, trusted-ingress/config/wiring, route admission behavior, and `createApiAbuseRateLimitStore`.

Runtime-database-acceptance job:

- K7 real runtime database acceptance: GREEN;
- A1 real token authentication acceptance: GREEN;
- A2 real Pix runtime acceptance: GREEN;
- A3 real paid/ledger/balance acceptance: GREEN;
- A4 real merchant webhook runtime acceptance: GREEN;
- A6 dashboard authorization acceptance: GREEN;
- A7 webhook endpoint management acceptance: GREEN;
- A8 API credential management acceptance: GREEN;
- A9 merchant transaction operations acceptance: GREEN;
- **A14 real database acceptance: RED only**.

The A14 runtime driver stopped at its first deliberate fail-first assertion because `createApiAbuseRateLimitStore` was still undefined. No A14 database behavior executed accidentally.

### Database workflow

Run `32095966152`.

- K5 deterministic sandbox fixtures: GREEN;
- K6 runtime topology: GREEN;
- existing database files `001` through `040`: GREEN;
- new A14 file `041`: RED;
- total pgTAP files: 41;
- total planned assertions: 1298;
- A14 `041` failures: **5 of 6**, exactly for missing table/index/function/API privilege;
- unexpected prior database regression: **0**.

The sixth negative privilege assertion remained satisfied because no A14 function existed yet.

## What RED proves

1. Existing A1-A13 application behavior remains intact before A14 implementation.
2. Existing K5/K6 and database contracts remain intact.
3. The missing behavior is specifically the A14 contract rather than unrelated breakage.
4. A1 still proves its existing successful token-issuance quota and invalid-credential/IP semantics.
5. A14 has no hidden implementation, migration, hosted Supabase change, provider call, financial side effect or provider-activation change at RED.
6. GREEN implementation is now authorized, but only within the frozen A14 V0 scope.

## GREEN constraints

Implementation must not weaken these tests or alter the frozen contract merely to obtain GREEN. In particular:

- do not set generic Fastify `trustProxy`;
- do not trust forwarded identity from an untrusted direct peer;
- do not consume A1's successful credential issuance quota for invalid secrets;
- do not use in-process memory as authoritative rate-limit state;
- do not persist raw IP/token/secret/principal identity in abuse-window state;
- do not admit machine mutation after Payment/idempotency side effects have begun;
- do not add provider/network/financial authority;
- do not bridge A5 retained adapters to A11.
