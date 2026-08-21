# K4 — Trusted Runtime Database Boundary Evidence

Date: 2026-08-15

Canonical project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)

Branch: `agent/foundation-phase-0`

## Scope

K4 establishes explicit PostgreSQL capability roles for the trusted SwiftPay API and worker without exposing the private `app` schema to browser/Data API roles or granting broad table/function access.

Capability roles:

- `swiftpay_api` — `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`.
- `swiftpay_worker` — same role attributes.

The roles are capability containers. Production LOGIN identities/passwords are deployment concerns and are not committed in database migrations.

## Frozen capability surface

`swiftpay_api` receives:

1. `USAGE` on schema `app`;
2. `EXECUTE` only on `app.require_dashboard_merchant_context(uuid,uuid,text,text)`.

`swiftpay_worker` receives:

1. `USAGE` on schema `app`;
2. `EXECUTE` on `app.claim_jobs(text,integer,integer)`;
3. `EXECUTE` on `app.complete_job(uuid,uuid)`;
4. `EXECUTE` on `app.reschedule_job(uuid,uuid,text,text,integer)`.

Both roles remain denied direct access to `app` tables and sequences. Financial/provider/reconciliation/audit primitives remain outside the K4 allowlist.

## Context contract

`app.require_dashboard_merchant_context(...)`:

- accepts only `sandbox` or `production` environment values;
- delegates canonical membership/role authorization to K3 `app.require_merchant_membership(...)`;
- returns the canonical merchant ID, requested environment and actual active membership role;
- does not read custom GUCs as authorization input;
- does not mix merchant lifecycle/KYC financial eligibility into dashboard membership authorization;
- produces no audit/domain/ledger/job/webhook side effects.

## Repository TDD evidence

Structural spec commit: `465c1ab`.

Structural RED:

- test: `supabase/tests/database/028_trusted_runtime_database_boundary_schema.test.sql`;
- valid RED after harness correction: GitHub Actions run #117;
- 28 files / 938 tests, failures restricted to missing K4 capabilities.

Structural GREEN:

- migration: `20260815031330_trusted_runtime_database_boundary_foundation.sql`;
- GitHub Actions run #118;
- 28 files / 938 tests / PASS.

Behavioral RED:

- test: `supabase/tests/database/029_trusted_runtime_database_boundary_behavior.test.sql`;
- harness role-switching correction commit: `589b2ada1bface43c874986e0f6cce2f86a3e489`;
- GitHub Actions run #120;
- 29 files / 973 tests;
- exactly assertions 1–12 failed because the context helper was still the deliberate `0A000` stub;
- remaining 23 assertions already passed, proving blast-radius and worker lease capability structure before behavioral implementation.

Behavioral GREEN:

- migration: `20260815032700_trusted_runtime_database_boundary_behavior.sql`;
- implementation commit: `74c75ca802e66cb293bb2ccc69709ed253425d96`;
- GitHub Actions run #121 (`31861783216`);
- job `94956335540`;
- `All tests successful.`;
- `Files=29, Tests=973`;
- `Result: PASS`.

## Managed Supabase deployment evidence

Both K4 migrations were applied successfully to the canonical managed project.

Supabase MCP initially assigned execution-time migration versions; migration history was then normalized to the repository filenames without reapplying DDL. Canonical remote history now contains 29 entries through:

- `20260815031330_trusted_runtime_database_boundary_foundation`;
- `20260815032700_trusted_runtime_database_boundary_behavior`.

## Managed transactional proof

A `BEGIN ... ROLLBACK` proof exercised the actual managed roles and database objects.

Observed results:

- API executable grant count: `1`.
- Worker executable grant count: `3`.
- valid API context: canonical merchant + `sandbox` + actual role `admin`.
- spoofed merchant/environment custom GUC values were ignored; canonical context remained unchanged.
- cross-merchant attempt: SQLSTATE `42501`.
- invalid environment: SQLSTATE `23514`.
- `swiftpay_api` direct table read: SQLSTATE `42501`.
- `swiftpay_api` financial ledger primitive execution: SQLSTATE `42501`.
- `swiftpay_worker` dashboard context execution: SQLSTATE `42501`.
- `swiftpay_worker` direct `app.jobs` table read: SQLSTATE `42501`.
- worker `claim_jobs` + lease fencing token + `complete_job` succeeded and the durable job reached `completed` inside the proof transaction.
- context resolution left payment, ledger, job, audit and merchant-webhook counts unchanged.
- `service_role` still has no `USAGE` on `app`.

The proof transaction was rolled back. Verification merchant/Auth/job fixtures did not persist.

## PostgreSQL role-creator membership note

PostgreSQL/Supabase retains creator memberships from `postgres` to the two new capability roles. Managed inspection showed:

- `admin_option = true`;
- `inherit_option = false`;
- `set_option = false`;
- grantor `supabase_admin`.

The test-only transactional `SET TRUE` memberships used to exercise the roles were therefore successfully rolled back; no runtime role switching privilege was left enabled for `postgres` by the proof.

## Security Advisor

Supabase Security Advisor after K4: **0 security lints**.

## Conclusion

K4 is `DONE`.

The trusted runtime database boundary is now explicit, least-privilege and proven in both isolated pgTAP CI and the canonical managed Supabase project. This does **not** mean the production API/worker application exists yet: K4 provides the database capability boundary that K6 and the first executable Pix vertical slice will consume.