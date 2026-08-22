# SwiftPay V2 — A25 Hosted Runtime Identity + Sandbox DB E2E Contract v0

Status: Frozen for TDD
Date: 2026-08-21 (America/Santarem)

## Purpose

A25 closes the missing hosted PostgreSQL LOGIN identity boundary required by the existing SwiftPay API/worker runtime and proves the A23 Sandbox Payment Link lifecycle while application database capabilities execute as the exact API runtime identity.

This contract does **not** authorize a retained PSP, store hosted runtime credentials, or claim that the Fastify HTTP application is deployed.

## 1. K4 boundary remains authoritative

K4 defines `swiftpay_api` and `swiftpay_worker` as NOLOGIN capability roles and explicitly leaves production LOGIN identities and credentials to deployment concerns rather than Supabase migrations.

A25 therefore MUST NOT add `swiftpay_api_runtime` or `swiftpay_worker_runtime` creation to `supabase/migrations`.

The canonical deployment artifact is:

```text
ops/sql/bootstrap-hosted-runtime-identities.sql
```

It is operational SQL, not migration history.

## 2. Runtime identity topology

The bootstrap idempotently establishes:

```text
swiftpay_api_runtime
swiftpay_worker_runtime
```

Both roles MUST be `LOGIN INHERIT` and MUST be `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.

The bootstrap MUST install no hosted credential. If a same-name role already exists with unsafe attributes, bootstrap MUST fail closed instead of silently normalizing a potentially compromised identity.

Membership is exact:

```text
swiftpay_api_runtime    -> swiftpay_api
swiftpay_worker_runtime -> swiftpay_worker
```

The API LOGIN MUST NOT be a member of `swiftpay_worker`. The worker LOGIN MUST NOT be a member of `swiftpay_api`.

## 3. Authority source

LOGIN roles receive capability only by inheritance from their existing NOLOGIN workload groups.

The bootstrap explicitly removes direct grants on:

- schema `app`;
- `app` tables;
- `app` sequences;
- `app` routines.

Effective inherited routine counts remain exactly:

```text
swiftpay_api_runtime    30 app EXECUTE capabilities
swiftpay_worker_runtime  6 app EXECUTE capabilities
```

A25 adds zero application capabilities.

## 4. Local K6 reuse

`scripts/provision-local-runtime-identities` remains fixed to its existing loopback Supabase database and MUST NOT accept a remote target or project reference.

A25 changes the helper so it first executes the shared credentialless bootstrap SQL, then installs only the existing synthetic local LOGIN credentials needed by K6 real-connection tests. Those local test credentials are not hosted deployment credentials and MUST NOT move into the shared bootstrap artifact.

K6 remains responsible for proving:

- both LOGIN roles exist;
- safe role attributes;
- exact matching workload memberships;
- zero direct `app` object ACL entries;
- API/worker real connections use their own LOGIN identities;
- effective capability allowlist remains exact.

## 5. A25 RED/GREEN evidence

The fail-first application contract requires the shared bootstrap artifact and local-helper reuse. Before implementation it fails because the artifact is absent and K6 local provisioning is still self-contained.

GREEN requires:

- application contracts GREEN;
- all database pgTAP GREEN with no A25 schema migration;
- K5 GREEN;
- K6 GREEN using the shared bootstrap artifact;
- K7/A14/A18/A1-A9 real PostgreSQL runtime acceptance GREEN.

## 6. Hosted bootstrap execution

After repository GREEN, `ops/sql/bootstrap-hosted-runtime-identities.sql` is applied deliberately to canonical `swiftpay v2` through an administrative SQL channel.

Hosted attestation must prove:

- both runtime LOGIN roles exist with exact safe attributes;
- exact group memberships;
- no direct `app` object grants;
- effective API/worker function counts remain 30/6;
- Data API authority remains unchanged;
- no retained-provider activation changes.

## 7. Hosted smoke administration

Hosted acceptance runs in one PostgreSQL transaction.

Administrative authority is used only for fixture setup, temporary SET-role authority, inspection, and rollback. Inside the transaction, the administrative session may temporarily receive membership allowing:

```sql
SET LOCAL ROLE swiftpay_api_runtime
```

Every A23 application database operation used as runtime evidence MUST execute with:

```text
current_user = swiftpay_api_runtime
```

Application behavior executed as `postgres` is not accepted as runtime evidence. The temporary administrative membership must disappear on rollback.

## 8. Synthetic hosted fixture

The transaction-scoped fixture contains only:

- merchant A: active;
- merchant B: active;
- Auth user A: owner/admin member of merchant A;
- Auth user B: owner/admin member of merchant B;
- one active platform `swiftpay_emulator` provider;
- exactly one active platform Sandbox emulator account with `create_pix_charge=true`.

The fixture MUST NOT insert AkkadPag, FlevoPay, retained-provider credentials, Production provider accounts, API credentials, webhook secrets, ledger postings, payouts, or refunds.

## 9. Payment Link creation

As `swiftpay_api_runtime`, authorized user A calls:

```sql
app.create_dashboard_payment_link(uuid, uuid, text, text, text, jsonb)
```

with Sandbox, BRL 1250, 30-minute Pix expiration, a dedicated valid A25 public token and stable idempotency/request-hash values.

Expected first result: `kind=created`, `replayed=false`.

Same key + same hash MUST replay the same link with no duplicate. Production MUST return `kind=forbidden`. User B administering merchant A MUST be denied with no cross-tenant row.

## 10. Public checkout read

`app.get_public_payment_link(text)` must return only the A23 public projection: merchant name, amount, currency, description, environment and Pix expiration. It must not leak internal merchant/link/provider identifiers or private membership data.

## 11. Checkout prepare and idempotency

`app.prepare_payment_link_pix_payment(text,text,text)` first call MUST return `kind=prepared` and create exactly one checkout idempotency owner, one Payment and one ProviderAttempt.

The Payment must remain:

```text
environment=sandbox
source=payment_link
collection_status=creating
amount_cents=1250
currency=BRL
pricing_version=sandbox-zero-fee-v0
merchant_fee_cents=0
merchant_net_cents=1250
routing_policy_version=sandbox-emulator-v0
```

The ProviderAttempt targets the synthetic emulator and starts `prepared`.

Same key + same hash before resolution returns the same Payment/ProviderAttempt. Same key + different hash conflicts without duplication.

## 12. Claim and resolution

First `app.claim_api_pix_attempt(...)` returns `claimed=true` with one execution token. A second claim returns `claimed=false`.

The smoke passes one contract-valid Sandbox emulator success projection to `app.resolve_api_pix_attempt(...)`, containing exactly certainty, providerPaymentId, txId, copyAndPaste, qrCode and expiresAt.

Expected state:

```text
Payment creating -> pending
ProviderAttempt executing -> succeeded
checkout idempotency in_progress -> completed
Pix projection populated
```

A25 MUST NOT transition to paid, create ledger postings, or perform external provider I/O.

## 13. Completed replay

After resolution, same checkout key/hash returns the same completed Payment and creates no duplicate Payment/ProviderAttempt. Different hash with the same key conflicts.

## 14. Side-effect boundary and rollback

Before rollback the only allowed A25 business deltas are one synthetic Payment Link, one checkout Payment and one ProviderAttempt plus their idempotency state. Ledger transactions, jobs, payouts and refunds remain unchanged.

The smoke MUST issue `ROLLBACK`, not best-effort manual deletes. After rollback all A25 fixture/business rows and temporary administrative membership must equal pre-smoke state.

## 15. Post-bootstrap security invariants

```text
swiftpay_api effective app EXECUTE       30
swiftpay_worker effective app EXECUTE     6
Data API effective app EXECUTE            0
retained PSP production authority         0
```

A25 changes no A10 provider activation state.

## 16. Explicit non-claim

A25 GREEN/HOSTED proves hosted PostgreSQL deployment identity topology and the A23 database/runtime-role lifecycle. It does not prove deployed Fastify configuration, HTTP routing/CORS/TLS, Vercel compute, hosted server-side credential injection, or browser checkout against a deployed API.

Those belong to the next deployment/HTTP E2E slice and must use the actual V2 application, not unrelated historical Vercel projects.
