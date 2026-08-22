# SwiftPay V2 — A25 Hosted Runtime Identity + Sandbox DB E2E Contract v0

Status: Frozen for TDD
Date: 2026-08-21 (America/Santarem)

## Purpose

A25 closes the missing hosted database LOGIN identity boundary required by the existing SwiftPay API/worker runtime and proves the A23 Sandbox Payment Link lifecycle in the canonical hosted database while executing application database capabilities as the exact API runtime identity.

This contract does **not** authorize a retained PSP, install hosted runtime passwords, or claim that the Fastify HTTP application is deployed.

## 1. Runtime identity topology

The PostgreSQL cluster must contain exactly these SwiftPay workload LOGIN identities:

```text
swiftpay_api_runtime
swiftpay_worker_runtime
```

Both roles MUST be:

- `LOGIN`;
- `INHERIT`;
- `NOSUPERUSER`;
- `NOCREATEDB`;
- `NOCREATEROLE`;
- `NOREPLICATION`;
- `NOBYPASSRLS`.

The schema migration MUST NOT set a usable password. Runtime credential installation is a separate operational/deployment concern.

Membership is exact:

```text
swiftpay_api_runtime    -> swiftpay_api
swiftpay_worker_runtime -> swiftpay_worker
```

The API LOGIN MUST NOT be a member of `swiftpay_worker`. The worker LOGIN MUST NOT be a member of `swiftpay_api`.

## 2. Authority source

LOGIN roles receive capability only by inheritance from the existing NOLOGIN workload groups.

The LOGIN roles MUST receive no direct grant on:

- schema `app` beyond authority inherited from their workload group;
- `app` tables;
- `app` sequences;
- `app` routines.

At A25 the effective inherited routine counts remain:

```text
swiftpay_api_runtime    30 app EXECUTE capabilities
swiftpay_worker_runtime  6 app EXECUTE capabilities
```

A25 adds zero API/worker application capabilities.

## 3. Local K6 identity provisioning

`scripts/provision-local-runtime-identities` remains fixed to the loopback Supabase database and MUST NOT accept a remote URL/project ref/override.

Because A25 migrations now create credentialless LOGIN identities before K6 runs, the local helper MAY set only the synthetic local passwords:

```text
local_api_runtime_only
local_worker_runtime_only
```

on its fixed `127.0.0.1:54322` database after validating the role attributes. Those values are test fixtures, never hosted credentials.

The helper then reasserts matching group membership and zero direct `app` object grants.

## 4. Hosted smoke administration

Hosted acceptance runs in a single PostgreSQL transaction through the managed administrative SQL channel.

Administrative authority is allowed only for:

1. recording pre-smoke counts;
2. creating synthetic transaction-scoped fixture rows;
3. temporarily granting `postgres` SET authority to `swiftpay_api_runtime` inside that transaction;
4. switching to `swiftpay_api_runtime` for the application capability calls;
5. resetting role for inspection;
6. rolling back all fixture DML and temporary membership.

A successful smoke MUST prove `current_user = 'swiftpay_api_runtime'` while exercising the application DB routines. Application behavior executed as `postgres` is not acceptable runtime evidence.

The temporary administrative membership MUST disappear on rollback.

## 5. Synthetic hosted fixture

All fixture identities use the A25 UUID namespace and exist only inside the smoke transaction.

Required fixture shape:

- merchant A: active;
- merchant B: active;
- auth user A: owner/admin member of merchant A;
- auth user B: owner/admin member of merchant B;
- one platform provider with code `swiftpay_emulator`, active;
- exactly one platform Sandbox provider account for that emulator, active, with only `create_pix_charge=true` required by A2/A23.

The fixture MUST NOT insert:

- AkkadPag;
- FlevoPay;
- retained-provider credentials;
- Production provider accounts;
- API credentials;
- webhook secrets;
- ledger entries/transactions;
- payout/refund state.

## 6. Payment Link creation

As `swiftpay_api_runtime`, authorized user A creates a link for merchant A through:

```sql
app.create_dashboard_payment_link(uuid, uuid, text, text, text, jsonb)
```

Frozen input:

```json
{
  "amount": 1250,
  "currency": "BRL",
  "description": "A25 hosted Sandbox E2E",
  "pixExpirationMinutes": 30,
  "publicToken": "<valid dedicated A25 token>"
}
```

Expected first result:

```text
kind=created
replayed=false
environment=sandbox
amount=1250
currency=BRL
```

The same idempotency key and request hash MUST return `replayed=true` and MUST NOT create a second Payment Link.

A Production create attempt MUST return `kind=forbidden` and create no row.

User B attempting to administer merchant A MUST be denied by `require_dashboard_merchant_context`; no cross-tenant link is created.

## 7. Public checkout read

As `swiftpay_api_runtime`, the dedicated public token is passed to:

```sql
app.get_public_payment_link(text)
```

The result MUST expose only the A23 public projection:

- merchant name;
- amount;
- currency;
- description;
- environment;
- Pix expiration.

It MUST NOT expose merchant ID, internal Payment Link ID, provider account ID, provider credentials, or private membership data.

## 8. Checkout prepare and idempotency

As `swiftpay_api_runtime`, checkout creation uses:

```sql
app.prepare_payment_link_pix_payment(text, text, text)
```

The first same-key/same-hash call MUST return `kind=prepared` and create exactly:

- one `request_idempotency` owner for the Payment Link create-payment operation;
- one `app.payments` row;
- one `app.provider_attempts` row.

The Payment MUST have:

```text
environment=sandbox
source=payment_link
source_resource_id=<A25 link id>
collection_status=creating
amount_cents=1250
currency=BRL
pricing_version=sandbox-zero-fee-v0
merchant_fee_cents=0
merchant_net_cents=1250
routing_policy_version=sandbox-emulator-v0
```

The ProviderAttempt MUST target the synthetic `swiftpay_emulator` account and begin `prepared`.

A same-key/same-hash prepare replay before resolution MUST return the same Payment/ProviderAttempt and create no duplicate.

A same key with another request hash MUST return a conflict result and create no duplicate.

## 9. Claim and resolution

The first call to:

```sql
app.claim_api_pix_attempt(merchant, 'sandbox', payment, attempt)
```

MUST return `claimed=true` and a UUID execution token. A second claim of the same attempt MUST return `claimed=false`.

The smoke then passes one contract-valid deterministic Sandbox success projection to:

```sql
app.resolve_api_pix_attempt(merchant, 'sandbox', payment, attempt, execution_token, resolution)
```

The success resolution is fixture evidence only; it represents the already-frozen deterministic emulator output shape and MUST contain exactly:

- `certainty=success`;
- `providerPaymentId`;
- `txId`;
- `copyAndPaste`;
- `qrCode`;
- `expiresAt`.

Expected result/state:

```text
Payment creating -> pending
ProviderAttempt executing -> succeeded
idempotency in_progress -> completed
Pix projection populated
```

A25 MUST NOT transition the Payment to `paid`, create ledger postings, or invoke an external provider.

## 10. Completed replay

After successful resolution, the same checkout idempotency key/hash MUST return the same completed Payment with HTTP snapshot semantics from A23 and MUST NOT create another Payment or ProviderAttempt.

A different hash with that same key MUST conflict.

## 11. Side-effect boundary

Across A25 smoke execution before rollback:

- Payment Links may increase only by the one synthetic A25 link;
- Payments may increase only by the one A25 checkout Payment;
- ProviderAttempts may increase only by one A25 create attempt;
- ledger transactions delta = 0;
- jobs delta = 0;
- retained-provider network calls = 0;
- payouts/refunds delta = 0.

## 12. Rollback/cleanup

The smoke MUST issue `ROLLBACK`, not manual best-effort deletes.

After rollback, all of these must equal pre-smoke state:

- synthetic A25 merchants/users/memberships;
- synthetic emulator/provider account;
- A25 Payment Link;
- A25 request idempotency rows;
- A25 Payment;
- A25 ProviderAttempt;
- temporary `postgres -> swiftpay_api_runtime` membership.

## 13. Security invariants after hosted deployment

Post-deploy attestation must remain:

```text
swiftpay_api group app EXECUTE       30
swiftpay_worker group app EXECUTE     6
Data API effective app EXECUTE        0
retained PSP production authority     0
```

The new LOGIN roles do not alter A10 provider activation state.

## 14. Explicit non-claim

A25 GREEN/HOSTED proves the canonical hosted PostgreSQL runtime identity and A23 database lifecycle. It does not prove:

- deployed Fastify process configuration;
- HTTP routing/CORS/TLS;
- Vercel or other compute deployment;
- hosted server-side secret injection;
- browser checkout rendering against the deployed API.

Those are the next deployment/HTTP E2E gate and must use the actual V2 application rather than an unrelated historical Vercel project.
