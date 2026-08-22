# SwiftPay V2 — A25 Hosted Runtime Identity + Sandbox DB E2E Problem Analysis

Status: FROZEN FOR TDD
Date: 2026-08-21 (America/Santarem)

## Problem

A23/A24 are deployed in canonical hosted Supabase with exact NOLOGIN capability groups: 30 `swiftpay_api` routines and 6 `swiftpay_worker` routines. The first controlled hosted-E2E investigation found that the deployment LOGIN identities do not exist:

- `swiftpay_api_runtime`: absent hosted;
- `swiftpay_worker_runtime`: absent hosted;
- `scripts/provision-local-runtime-identities` creates them only on fixed loopback Postgres.

Without those identities, a hosted API/worker cannot satisfy `packages/db/src/core.ts::verifyRuntimeBoundary()`. Running A23 checkout operations as `postgres`, `service_role`, or a Data API role is not acceptable runtime evidence.

## Existing boundary discovered during Problem Analysis

K4 explicitly freezes `swiftpay_api` and `swiftpay_worker` as NOLOGIN capability roles and states that production LOGIN identities/passwords are **deployment concerns that must not be committed in migrations** (`20260815031330_trusted_runtime_database_boundary_foundation.sql`).

Therefore the initial idea of creating A25 LOGIN identities in a Supabase migration is rejected before implementation. A25 must preserve K4 and introduce an explicit operational bootstrap artifact outside `supabase/migrations`.

## Decision

A25 will add one versioned, credentialless deployment bootstrap SQL artifact under `ops/` that:

1. idempotently creates `swiftpay_api_runtime` and `swiftpay_worker_runtime` when absent;
2. validates any pre-existing same-name roles and fails closed if attributes are unsafe;
3. uses `LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`;
4. installs no password/secret;
5. grants only the matching NOLOGIN capability group;
6. removes opposite workload-group membership;
7. removes direct `app` schema/table/sequence/routine grants from the LOGIN identities.

The existing K6 local helper remains fixed to `127.0.0.1:54322`. It will execute the same credentialless bootstrap artifact first, then install only its synthetic local passwords so existing real-connection K6 acceptance remains executable.

Hosted application passwords remain a later secret/deployment operation and must never appear in repository artifacts, CI output, browser code, evidence docs, or migration history.

## TDD boundary

A25 RED is not a migration pgTAP. Existing K6 already proves the role topology after local provisioning. The missing behavior is a reusable hosted-safe deployment bootstrap artifact and K6 reuse of that exact topology source.

Fail-first application contract therefore requires:

- `ops/sql/bootstrap-hosted-runtime-identities.sql` to exist;
- zero runtime password literals in that artifact;
- safe role attributes and exact workload memberships in that artifact;
- explicit revocation of direct `app` authority;
- no `swiftpay_*_runtime` creation in `supabase/migrations`;
- `scripts/provision-local-runtime-identities` to execute the shared bootstrap artifact before adding local-only passwords;
- its fixed loopback guard to remain unchanged.

K5/K6 and all A1-A24 application/database/runtime tests must remain GREEN after implementation.

## Hosted execution proof

After repository GREEN, the credentialless bootstrap artifact is applied deliberately to `swiftpay v2` through the administrative SQL channel. Hosted attestation must show both LOGIN roles exist with exact safe attributes and group memberships while effective capability counts remain API 30 / worker 6 and Data API authority remains unchanged.

A transaction-only Sandbox smoke then:

1. records pre-smoke counts;
2. creates two synthetic active merchants/users/memberships and one synthetic `swiftpay_emulator` platform Sandbox account;
3. temporarily grants the administrative smoke session SET authority to `swiftpay_api_runtime` inside the transaction;
4. executes the A23 application DB calls with `current_user = swiftpay_api_runtime`;
5. creates one Payment Link and proves same-key replay;
6. proves Production create is forbidden and foreign-tenant administration is denied;
7. reads the public link projection;
8. prepares one `source='payment_link'` Payment and ProviderAttempt;
9. proves prepare replay creates no duplicate;
10. claims the attempt exactly once;
11. resolves a contract-valid Sandbox emulator success to `pending` only;
12. proves completed replay and conflicting-hash behavior;
13. proves ledger/jobs/payout/refund deltas remain zero;
14. issues `ROLLBACK` so all fixture/business DML disappears and the administrative session's runtime `SET` authority returns to its exact pre-smoke state.

No AkkadPag/FlevoPay row, credential, activation or network call is allowed.

## PostgreSQL 17 creator-admin membership semantics

The managed hosted `postgres` role is `NOSUPERUSER + CREATEROLE`. PostgreSQL 17 automatically grants a newly created role back to a non-superuser `CREATEROLE` creator with the equivalent membership options `ADMIN TRUE, SET FALSE, INHERIT FALSE`.

Therefore an administrative `pg_auth_members` row from `swiftpay_*_runtime` to the role creator is expected after bootstrap and is **not** runtime authority. A25 must distinguish that creator-admin relationship from usable workload authority:

- before the smoke, `postgres` MUST have `SET=false` and `INHERIT=false` for both runtime roles;
- the smoke may temporarily enable API runtime SET authority inside its transaction;
- after `ROLLBACK`, `SET=false` and `INHERIT=false` MUST be restored;
- the creator-admin row may remain exactly as PostgreSQL created it;
- application capability still comes only from `swiftpay_api_runtime -> swiftpay_api` and `swiftpay_worker_runtime -> swiftpay_worker`.

The cleanup invariant is therefore restoration of effective SET/INHERIT authority and all business state, not physical absence of PostgreSQL's automatic ADMIN-only creator membership row.

## Explicit non-claim

A25 proves hosted PostgreSQL deployment identity topology and the A23 database/runtime-role lifecycle. It does not prove the Fastify application is deployed over HTTP.

The subsequent deployment slice must define server-side runtime database credential injection, deploy the actual V2 API/checkout surfaces, and exercise HTTP/CORS/TLS without overwriting the unrelated historical Vercel projects already present in the account.

## Risk controls

- LOGIN identities are operational bootstrap, not schema migration.
- Bootstrap creates them credentialless.
- Runtime authority comes only from K4 NOLOGIN groups.
- PostgreSQL creator ADMIN-only membership is not treated as workload SET/INHERIT authority.
- Local synthetic passwords remain local-only.
- Hosted secret installation is deferred to a dedicated deployment contract.
- All hosted A25 business fixture state is transaction-scoped and rolled back.
