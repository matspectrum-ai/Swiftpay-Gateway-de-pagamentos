# SwiftPay V2 — A25 Hosted Runtime Identity + Sandbox DB E2E Problem Analysis

Status: PROBLEM_ANALYSIS / FROZEN FOR SPEC
Date: 2026-08-21 (America/Santarem)

## Problem

A23/A24 are deployed in the canonical hosted Supabase project and the hosted capability groups are exact at 30 `swiftpay_api` routines and 6 `swiftpay_worker` routines. However, the first controlled attempt to close the positive hosted Sandbox E2E exposed a more fundamental deployment gap:

- hosted `swiftpay_api_runtime` LOGIN role: absent;
- hosted `swiftpay_worker_runtime` LOGIN role: absent;
- only the NOLOGIN capability groups `swiftpay_api` and `swiftpay_worker` exist;
- the local K6 helper provisions the LOGIN identities only on fixed loopback Postgres and intentionally refuses a remote target.

Therefore there is no canonical hosted runtime identity that can satisfy `verifyRuntimeBoundary()` or support a real API/worker database connection. Running the positive checkout flow as hosted `postgres`, `service_role`, or a Data API role would bypass the intended least-privilege boundary and cannot be accepted as runtime E2E evidence.

## Evidence

Hosted inspection on canonical project `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`) returned:

```text
current_user               = postgres
postgres member swiftpay_api = true
swiftpay_api_runtime        = absent
swiftpay_worker_runtime     = absent
```

Repository evidence:

- `packages/db/src/core.ts::verifyRuntimeBoundary()` requires exact `current_user` `swiftpay_api_runtime` or `swiftpay_worker_runtime` and group membership without direct Payment DML authority.
- `scripts/provision-local-runtime-identities` creates those LOGIN roles only against `127.0.0.1:54322` with synthetic local passwords and explicitly rejects production/managed targeting.
- `scripts/seed-local-sandbox` and `supabase/seeds/local-sandbox.sql` are explicitly local-only and must not become a remote seed path.
- A23 checkout DB routines are executable only through `swiftpay_api`; Data API/PUBLIC roles remain denied.

## Decision boundary

A25 will establish hosted-safe runtime identity objects and prove the hosted Sandbox database lifecycle under the exact API runtime identity. It will not smuggle production credentials into migrations, source, docs, CI output, or browser code.

A25 is allowed to:

1. create `swiftpay_api_runtime` and `swiftpay_worker_runtime` as LOGIN roles with no password credential installed by the migration;
2. grant only their matching NOLOGIN capability group;
3. revoke the opposite capability group and any direct `app` schema/table/sequence/routine authority from the LOGIN roles;
4. keep the K6 local helper loopback-only and let it install only its known synthetic local passwords after migrations;
5. add database contracts proving exact role attributes, memberships and inherited capability counts;
6. after repository GREEN, apply the migration hosted;
7. run a bounded hosted smoke in one PostgreSQL transaction that temporarily grants the administrative smoke session SET authority to `swiftpay_api_runtime`, changes `current_user` to that runtime role, exercises the A23 Sandbox Payment Link → prepare → claim → resolve → replay path, and rolls the transaction back;
8. prove Production remains fail-closed, a foreign merchant/user cannot administer the fixture link, and no fixture/financial/provider state survives rollback.

A25 is not allowed to:

- set or persist a hosted runtime password in Git/migrations/docs;
- reuse or relax K5/K6 local-only guards;
- create AkkadPag/FlevoPay hosted authority or change A10 activation;
- grant direct protected-table DML to runtime LOGIN roles;
- grant Data API roles new `app` EXECUTE/table authority;
- expose provider/runtime/service credentials to browser code;
- call a retained PSP;
- mark a Payment paid or post ledger state;
- claim that a database-role smoke is an HTTP deployment E2E.

## Hosted smoke fixture

The hosted smoke fixture is transaction-scoped and synthetic. It contains only:

- two synthetic active merchants for tenant-isolation checks;
- two synthetic Auth users/memberships;
- one platform Sandbox `swiftpay_emulator` provider and provider account;
- one A23 fixed-amount Payment Link;
- the Payment/ProviderAttempt/idempotency rows created by the A23 path.

It must not create AkkadPag/FlevoPay rows, payout/refund/ledger state, durable credentials, or a production Payment.

All smoke DML and temporary role membership are rolled back. Post-smoke row counts must equal their pre-smoke values for the fixture namespace and financial objects touched by A23.

## Acceptance layers

### Layer 1 — repository/CI

Fail-first pgTAP proves runtime LOGIN identities are missing before implementation. GREEN requires:

- both LOGIN roles exist;
- `LOGIN + INHERIT` are true;
- `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS` are false;
- API LOGIN inherits only `swiftpay_api` among SwiftPay workload groups;
- worker LOGIN inherits only `swiftpay_worker`;
- neither LOGIN has direct `app` object grants;
- inherited function capability counts remain exactly API 30 / worker 6;
- existing K5/K6/application/runtime suites remain GREEN.

### Layer 2 — canonical hosted database/runtime-role smoke

After deployment, a transaction-only acceptance must prove:

- `current_user = swiftpay_api_runtime` during the application DB operations;
- Payment Link creation succeeds only in Sandbox for an authorized owner/admin;
- public link projection is available without leaking private identifiers;
- checkout prepare creates exactly one `source='payment_link'` Payment and one ProviderAttempt;
- claim is single-winner;
- deterministic Sandbox success resolution moves only `creating -> pending` and records Pix projection;
- completed replay returns the original Payment and creates no duplicate Payment/ProviderAttempt;
- same idempotency key with a different request hash conflicts;
- Production create remains forbidden;
- foreign tenant administration is denied;
- no ledger/job/webhook/payout/refund state is created;
- rollback removes every synthetic fixture and smoke-created row.

## HTTP deployment boundary

A25 does not close the public HTTP deployment proof. The repository API process requires runtime database credentials plus server-only signing/HMAC/wrapping configuration. Those credentials do not currently have an approved hosted secret-bootstrap/deployment contract and the existing Vercel projects are unrelated older applications.

After A25 GREEN/HOSTED, the next slice must freeze the deploy/runtime secret contract and exercise the actual Fastify API + checkout HTTP surface without overwriting unrelated Vercel projects.

## Risk

Creating cluster LOGIN roles is security-sensitive even without passwords. The repair is safe only if the LOGIN roles remain credentialless at schema deployment, inherit one exact capability group, carry no direct object grants, and future credential installation occurs through a separate server-side secret/bootstrap operation.
