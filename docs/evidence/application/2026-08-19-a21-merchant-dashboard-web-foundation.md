# A21 — Merchant Dashboard Web Foundation Evidence

Date: 2026-08-19  
Branch: `agent/foundation-phase-0`  
Status: `DONE / GREEN / HOSTED`

## Authority

- Problem Analysis: `docs/design/a21-merchant-dashboard-web-foundation-problem-analysis.md`
- Specification: `docs/specs/merchant-dashboard-web-foundation-v0.yaml`
- Contract: `docs/contracts/merchant-dashboard-web-foundation-v0.md`
- Application contract: `tests/application/064_a21_merchant_dashboard_web_foundation.contract.test.mjs`
- Database contract: `supabase/tests/database/044_dashboard_context_discovery.test.sql`
- Repository migration: `supabase/migrations/20260819093000_dashboard_context_discovery.sql`
- Canonical runtime capability manifest: `ops/security/runtime-capabilities-v0.json`

A21 is the first merchant-facing web-application slice. It deliberately reuses the already accepted A6 dashboard-session authority and A9 transaction-read authority rather than creating a browser database boundary.

## Frozen scope

A21 implements:

- a TypeScript React/Vite SPA in `apps/dashboard`;
- Supabase Auth for browser login/logout/session persistence and refresh only;
- same-origin SwiftPay API access below `/api`;
- trusted merchant-context discovery through `GET /dashboard/v1/contexts`;
- merchant and Sandbox/Production context selection;
- transaction list and transaction detail UI through the existing A9 read surface;
- explicit loading, empty, service-failure, unauthorized and session-expired states;
- a responsive merchant-facing dashboard shell.

A21 does not implement API-credential administration UI, webhook-endpoint administration UI, KYC, payout/refund operations, hosted checkout, Payment Links, analytics, provider ingress, provider activation or live PSP traffic.

The browser holds only the Supabase user session and publishable project configuration. It receives no service-role secret, database credential, SwiftPay API Secret Key, provider credential, webhook private key, access-token signing key or cursor/HMAC authority. Direct browser access to the private `app` schema is forbidden.

## RED evidence

### Application

The fail-first A21 application contract initially produced **363/369 PASS**, with exactly six A21 capability/artifact failures while the previously accepted application surface remained GREEN.

The contract was subsequently strengthened to execute the new context store/service/HTTP behavior as well as structural browser-authority checks before final GREEN.

### Database

Fail-first database contract: `supabase/tests/database/044_dashboard_context_discovery.test.sql`.

RED workflow `32234844367`, pgTAP job `96015623944`:

- plan: 14;
- 11 intended failures because `app.list_dashboard_merchant_contexts(uuid)` did not yet exist;
- 3 financial non-mutation assertions remained GREEN;
- K5/K6 and the pre-A21 database surface remained GREEN.

The test freezes exact function identity, SECURITY DEFINER/STABLE properties, explicit safe search path, API-only EXECUTE authority, deterministic context projection, active-membership filtering, identity fail-closed semantics and financial/provider non-mutation.

## GREEN implementation

A21 adds a single trusted read RPC:

`app.list_dashboard_merchant_contexts(uuid)`

Properties:

- `STABLE`;
- `SECURITY DEFINER`;
- `search_path=pg_catalog, app, auth`;
- validates that the supplied verified Supabase user exists, is non-anonymous and is not deleted;
- returns active merchant memberships only;
- delegates role authority to `app.require_merchant_membership(..., 'member')`;
- deterministically orders merchants by lower-cased name and merchant ID;
- grants EXECUTE only to `swiftpay_api`;
- adds no direct relation privileges and performs no financial/provider mutation.

The application path is layered as:

`Supabase browser session -> SwiftPay API -> A6 session verifier -> A21 context service -> A21 DB store -> trusted A21 RPC`

The browser then uses A9 dashboard transaction reads for list/detail. No machine-auth fallback exists for dashboard context discovery.

## GREEN CI evidence

Accepted behavior/fix head before evidence documentation: `98b7b24073e8291a16984492236b4bf1339c0d6f`.

Application workflow `32257443845`:

- typecheck: GREEN;
- build: GREEN;
- application contracts: **372/372 PASS**;
- A21 application contracts: GREEN;
- final runtime-database acceptance rerun job `96084137179`: K7, A14, A18, A1, A2, A3, A4, A6, A7, A8 and A9 all GREEN.

Database workflow `32257443899`:

- pgTAP: **44 files / 1340 assertions PASS**;
- `044_dashboard_context_discovery.test.sql`: GREEN;
- K5 deterministic sandbox fixtures: GREEN;
- K6 production-like runtime topology: GREEN.

## A18 concurrency defect discovered during A21 regression

The first A21 full regression exposed an intermittent pre-existing A18 concurrency defect rather than an A21 behavior failure.

The A18 quota RPC previously materialized the active pseudonym first and the previous pseudonym second, then acquired ordered row locks. Two concurrent rotation calls using reversed alias order could therefore acquire unique-index conflicts in opposite order before the ordered `FOR UPDATE`, producing a PostgreSQL deadlock.

The repair is versioned separately in:

- repository migration: `supabase/migrations/20260819102500_abuse_subject_hmac_rotation_canonical_insert_order.sql`;
- commit: `98b7b24073e8291a16984492236b4bf1339c0d6f`.

The repair inserts active/previous aliases in one lexically ordered statement before the existing ordered row locks. It changes no quota value, fixed-window duration, API contract, worker authority, public error contract or financial/provider authority. A18 real-database reversed-alias concurrency acceptance is GREEN after the repair.

One A8 concurrency acceptance in the first post-repair run was transiently RED (`concurrent_limit_created_4`). Re-running the same runtime job on the same commit with no source/test change passed A8 and the entire runtime suite. The strict A8 10-winner/1-limit-rejection acceptance was retained unchanged.

## Hosted canonical Supabase evidence

Canonical project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

Hosted migrations applied successfully:

- `20260819132759_dashboard_context_discovery`;
- `20260819132824_abuse_subject_hmac_rotation_canonical_insert_order`.

Post-DDL exact attestation:

- `swiftpay_api` `app` EXECUTE set: **25 expected / 25 actual**;
- API missing signatures: **0**;
- API extra signatures: **0**;
- `swiftpay_worker` `app` EXECUTE set: **6 expected / 6 actual**;
- worker missing signatures: **0**;
- worker extra signatures: **0**;
- `app.list_dashboard_merchant_contexts(uuid)`: SECURITY DEFINER, STABLE, `search_path=pg_catalog, app, auth`;
- `app.consume_api_abuse_quota(text,text,text)`: SECURITY DEFINER, VOLATILE, `search_path=''`;
- effective EXECUTE on the two touched routines for `PUBLIC`, `anon`, `authenticated`, and `service_role`: **0 / 0 / 0 / 0**;
- direct protected `app` relation DML privileges for `swiftpay_api` / `swiftpay_worker`: **0 / 0**;
- hosted Payments / ProviderAttempts: **0 / 0**;
- Supabase Security Advisor: **0 lints**.

A21 is therefore hosted without widening the Data API boundary or creating financial/provider state.

## Runtime capability delta

A20's canonical manifest changes from 24 API / 6 worker signatures to exactly **25 API / 6 worker** signatures.

The only A21 API addition is:

`app.list_dashboard_merchant_contexts(uuid)`

Worker authority is unchanged.

## Product result

The repository now contains an actual merchant web application rather than only dashboard backend primitives. A merchant can reach a real login/session surface, discover authorized merchant contexts, switch environment, inspect the transaction list and open transaction details through trusted existing APIs.

This is a foundation slice, not the complete merchant product. API credential settings, webhook settings, KYC/payout/refund operations, checkout/payment links, analytics and launch operations remain separate work.

## Provider and monetary safety

- retained A5 adapters remain fixture-only;
- A10 repository defaults still authorize zero retained-provider operations;
- A11 remains unbound from retained A5 adapters;
- A21 caused no retained PSP network call;
- A21 caused no provider activation promotion;
- A21 browser code has no financial mutation surface;
- exact current provider-contract and authenticated-sandbox evidence gates remain unchanged.

## Acceptance

A21 is accepted as `DONE / GREEN / HOSTED` for its frozen first dashboard vertical slice.
