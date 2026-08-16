# SwiftPay V2 — A6 Dashboard Session Authentication — Evidence

Date: 2026-08-16
Status: **DONE — reusable dashboard authentication/authorization boundary; no dashboard business route added**

Problem Analysis: `docs/design/a6-dashboard-session-authentication-problem-analysis.md`
Spec: `docs/specs/dashboard-session-authentication-v0.yaml`
Implementation:

- `packages/auth/src/dashboard.ts`
- `packages/db/src/dashboard.ts`
- `apps/api/src/runtime.ts`
- `packages/config/src/index.ts`

Contracts:

- `tests/application/032_a6_dashboard_session_verifier.contract.test.mjs`
- `tests/application/033_a6_dashboard_context_store.contract.test.mjs`
- `tests/application/034_a6_dashboard_authorization_service.contract.test.mjs`
- `tests/application/035_a6_dashboard_runtime_wiring.contract.test.mjs`
- `tests/application/036_a6_dashboard_authorization_runtime_driver.mjs`
- `tests/application/036_a6_dashboard_authorization_runtime_acceptance.sh`

## Scope accepted

A6 makes the previously database-only K3/K4 dashboard authorization boundary executable from the trusted Fastify API runtime without weakening the separate SwiftPay machine-authentication realm.

The accepted sequence is:

```text
Supabase Auth user access token
  -> strict Bearer parsing
  -> one server-side Supabase Auth user verification request
  -> verified auth.users user id only
  -> app.require_dashboard_merchant_context(...)
  -> current merchant / environment / membership-role authorization
```

A6 intentionally adds no `/dashboard/v1/**` business resource. It creates the reusable trusted boundary required before later merchant-administration surfaces such as webhook endpoint management, API-credential management and KYC operations.

## Realm separation

Two authentication realms remain explicitly independent:

```text
/v1/**
  SwiftPay machine client_credentials Bearer token

/dashboard/v1/**
  Supabase Auth user session (future routes only)
```

There is no fallback in either direction. A token rejected by the dashboard verifier is not retried as a SwiftPay machine token, and a machine token never becomes dashboard administrative authority.

## Supabase Auth verification contract

The default verifier performs exactly one request per authentication decision:

```http
GET <SWIFTPAY_SUPABASE_URL>/auth/v1/user
Accept: application/json
apikey: <SWIFTPAY_SUPABASE_PUBLISHABLE_KEY>
Authorization: Bearer <user-access-token>
```

Frozen properties:

- exact Bearer syntax; scheme comparison is case-insensitive;
- no extra token, leading/trailing whitespace or alternate auth scheme;
- total timeout: 5 seconds;
- redirects are not followed;
- no automatic retry;
- only HTTP 200 with a valid UUID user id authenticates;
- HTTP 401/403 maps to `invalid_session`;
- redirect, 429, other 4xx, 5xx, timeout, DNS/TLS/network failure and malformed 200 map to `authentication_unavailable`;
- upstream response bodies, access tokens, Authorization headers and publishable keys do not cross the result boundary.

Only `{ userId }` from the verified Auth response becomes identity authority. User/app metadata never grants merchant, role or environment authority.

## Configuration boundary

The API now requires:

```text
SWIFTPAY_SUPABASE_URL
SWIFTPAY_SUPABASE_PUBLISHABLE_KEY
```

The URL must be an HTTPS origin without credentials, path, query or fragment. The key must use the modern `sb_publishable_...` form.

A6 does not introduce or require:

- `service_role`;
- `sb_secret_...`;
- the Supabase JWT secret;
- direct access to Auth signing private material.

The existing SwiftPay access-token signing key remains separate and continues to serve only the machine-authentication realm.

## K4 composition

`packages/db` adds `createDashboardMerchantContextStore`, which performs one query only through the already-frozen K4 routine:

```text
app.require_dashboard_merchant_context(uuid, uuid, text, text)
```

The adapter does not select `auth.users` or `app.merchant_members` directly and performs no DML.

Mapped outcomes:

- SQLSTATE `42501` -> `forbidden`;
- SQLSTATE `23514` -> `validation_error`;
- every other database failure -> `internal_error`.

A successful projection is strictly checked for one row, exact merchant/environment echo, a valid UUID and one of `member | admin | owner`.

K3/K4 therefore remain the canonical live authorization truth for:

- current `auth.users` existence;
- anonymous/deleted identity denial;
- exact merchant membership;
- membership status;
- role hierarchy `owner > admin > member`;
- current environment selection.

JWT metadata is not authorization truth and membership changes do not wait for token refresh.

## RED evidence

Clean RED head: `948f5369802dfe682e8c8c0aaeeb8cfa908f3ece`.

Application workflow: `31928177006`.
Database workflow: `31928177032`.

The RED gate proved:

- frozen dependency installation: PASS;
- TypeScript typecheck: PASS;
- build: PASS;
- **186 application tests executed**;
- **152 pre-A6 tests PASS**;
- **exactly 34 A6 tests FAIL** because dashboard verifier/store/service/config/wiring behavior was absent;
- no parser, module-resolution, SQL or harness error remained;
- K7/A1/A2/A3/A4 real-runtime acceptance reached A6 successfully and then failed exactly with `behavior_not_implemented:createDashboardAuthorizationService`;
- independent Database Contracts were completely GREEN.

This is the clean fail-first proof authorizing the A6 implementation.

## GREEN evidence

Final GREEN head: `4ac4e0b53776e55361f90d5589e5f72bcbdce49c`.

Application workflow: `31928641553` — **GREEN**.

Accepted application/runtime evidence:

- frozen dependency install: PASS;
- typecheck: PASS;
- build: PASS;
- **186/186 application contracts PASS**;
- all 34 A6 contracts PASS;
- K7 real runtime database acceptance: PASS;
- A1 machine token authentication acceptance: PASS;
- A2 Pix create/get acceptance: PASS;
- A3 paid/ledger/balance acceptance: PASS;
- A4 merchant webhook runtime acceptance: PASS;
- A6 dashboard authorization real-database acceptance: PASS.

Database workflow: `31928641539` — **GREEN**.

Accepted database evidence:

- pgTAP: PASS;
- K5 deterministic sandbox fixture contracts: PASS;
- K6 runtime topology / least privilege: PASS;
- API runtime identity check: PASS;
- worker runtime identity check: PASS.

No A6 migration or database grant was introduced, so no hosted Supabase schema synchronization is required for this slice.

## Real-database acceptance

The A6 runtime acceptance uses the real isolated PostgreSQL/K4 functions and a deterministic injected session verifier; it deliberately does not contact hosted Supabase Auth from CI.

It proves:

- member/admin/owner hierarchy;
- insufficient-role denial;
- disabled membership denial;
- anonymous user denial;
- soft-deleted user denial;
- missing identity denial;
- metadata spoof resistance;
- immediate role downgrade visibility on the next request;
- immediate membership disablement visibility on the next request;
- exact merchant/environment scope;
- zero changes to audit, Payment, ledger, jobs or webhook-event counts.

## Canonical hosted project observation

The canonical Supabase project remains `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`). During A6 planning it exposed a modern publishable key and also retained the legacy anon key. At that checkpoint `auth.users` and `auth.sessions` both contained zero rows.

A6 does not infer a future Auth JWT signing algorithm from this state. Online Auth verification is intentionally independent of whether a future user access token is signed through legacy or asymmetric Supabase signing keys.

No hosted user, session, Auth setting, migration or key was created/changed by A6.

## Security conclusion

A6 closes the identity gap that previously prevented safe merchant-administration APIs. The trusted API can now compose server-confirmed Supabase user identity with current K3/K4 membership truth without granting direct browser access, broad database access, privileged Supabase keys or machine-token administrative authority.

This does **not** solve webhook signing-secret key custody by itself. Merchant webhook endpoint create/rotation still requires a separately frozen key-management design before implementation.

## Closure decision

**A6 dashboard session authentication: DONE.**

The next unblocked planning target is merchant webhook endpoint management, now with the identity/authorization prerequisite closed but the signing-secret encryption/custody boundary still requiring explicit Problem Analysis and specification before RED tests or implementation.
