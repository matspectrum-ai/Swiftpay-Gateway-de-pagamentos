# SwiftPay V2 — A8 API Credential Management Problem Analysis

Date: 2026-08-16
Status: **FROZEN PROBLEM ANALYSIS**

## Problem

A1 proves machine `client_credentials` authentication, but merchants still cannot safely create, inspect, rotate or revoke those credentials through the dashboard. The existing `app.api_credentials` table is private and the trusted API role deliberately has no direct table DML. A6/K4 now provide a reusable dashboard-user merchant/environment/role boundary, but A1 explicitly deferred credential administration until a stronger step-up contract existed.

Credential administration is more sensitive than ordinary dashboard reads. A newly created or rotated Production secret can become authority for future monetary routes, and revocation must invalidate already-issued machine JWTs immediately through the A1 `secret_version`/status revalidation contract. A normal `aal1` dashboard session therefore must not be sufficient for credential mutation.

## Current proven foundation

- Canonical dashboard identity is the Supabase `auth.users.id` returned only after server-side Auth validation.
- K4 provides `app.require_dashboard_merchant_context(user_id, merchant_id, environment, required_role)` through the trusted API role.
- A1 stores only `scrypt-v1` secret verifiers; plaintext machine secrets are never persisted.
- A1 bearer revalidation checks credential status, secret version, merchant and environment on every protected request.
- `app.api_credentials` already stores `merchant_id`, `environment`, `name`, `public_key`, `secret_verifier`, `secret_version`, `status`, `ip_allowlist`, usage timestamps and revoke/rotate timestamps.
- `app.request_idempotency` and append-only `app.audit_events` are existing proven primitives and must be reused rather than duplicated.
- `swiftpay_api` currently has exactly 16 trusted routine capabilities and no direct credential-table privileges.
- `swiftpay_worker` must gain no credential-management authority.

## Step-up decision

A8 introduces a distinct privileged dashboard-session verifier for credential mutations.

The privileged verifier must:

1. parse exactly one Bearer token using the same strict dashboard realm syntax;
2. validate that token online against the configured Supabase Auth project before trusting any token claim;
3. only after successful Auth validation, decode the already-validated JWT payload and cross-check `sub` against the returned user ID;
4. require the JWT `aal` claim to equal `aal2` for privileged mutation authority;
5. treat a missing/`aal1` assurance claim as `step_up_required`, not as an invalid session;
6. never use `service_role`, `sb_secret`, the legacy JWT secret, or local signature trust as a substitute for online Auth validation;
7. never fall back to A1 machine credentials.

This is intentionally separate from A6. A6 remains frozen as the ordinary dashboard session boundary returning only `userId`; A8 does not weaken or retrofit its principal contract.

Official Supabase Auth documentation identifies `aal1` as conventional first-factor authentication and `aal2` as a session additionally verified with an MFA factor, with `aal` represented in the access-token JWT.

References:

- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/jwt-fields

## HTTP scope

Dashboard-only resource family:

`/dashboard/v1/merchants/:merchantId/environments/:environment/api-credentials`

V0 operations:

- `GET /api-credentials` — list, current member authority;
- `GET /api-credentials/:credentialId` — detail, current member authority;
- `POST /api-credentials` — create, step-up + mutation role;
- `POST /api-credentials/:credentialId/rotate-secret` — rotate, step-up + mutation role;
- `POST /api-credentials/:credentialId/revoke` — revoke, step-up + mutation role.

No update/rename/IP-policy mutation and no DELETE are included in V0. A credential is immutable except for secret rotation and terminal revocation.

## Mutation role policy

Risk is environment-sensitive:

- Sandbox create/rotate/revoke requires current `admin` or `owner` membership plus AAL2.
- Production create/rotate/revoke requires current `owner` membership plus AAL2.
- List/get require current `member` authority and do not require AAL2.

Production credential creation remains decoupled from KYC approval. A machine credential is an authentication artifact, not monetary capability; Production financial routes must enforce their own KYC/capability gates.

## Credential material

New credentials use opaque high-entropy values compatible with A1's existing request contract:

- public key: `pk_sandbox_<base64url(18 bytes)>` or `pk_production_<base64url(18 bytes)>`;
- secret key: `sk_sandbox_<base64url(32 bytes)>` or `sk_production_<base64url(32 bytes)>`.

Both are generated with a CSPRNG in the trusted API application boundary. The public key is persisted. The secret key is converted immediately to the frozen A1 `scrypt-v1` verifier and the plaintext is returned only on the winning create/rotation response.

Plaintext secret material must never enter PostgreSQL, logs, audit metadata, idempotency snapshots or error objects.

## Public credential projection

List/get/mutation responses may expose only:

- `id`
- `merchantId`
- `environment`
- `name`
- `publicKey`
- `status`
- `secretVersion`
- `revision`
- `ipAllowlist`
- `lastUsedAt`
- `createdAt`
- `rotatedAt`
- `revokedAt`

`secretKey` is additional one-time response material only for a winning create or rotate operation. Replay returns `secretAvailable: false` and `secretKey: null`.

## Optimistic concurrency

A8 adds `revision bigint not null default 1` to `app.api_credentials`.

- create starts at revision 1 / secret version 1;
- each successful secret rotation increments both revision and secret version exactly once;
- successful revoke increments revision exactly once;
- revoked credentials cannot rotate or be un-revoked in V0.

Rotation/revoke commands require positive `expectedRevision`.

Completed idempotency replay is evaluated before revision/status fencing, so an exact replay after the first successful mutation returns the stored public projection rather than becoming a false stale-revision conflict. A new idempotency key with a stale revision must conflict.

## Idempotency

Every mutation requires `Idempotency-Key` and reuses `app.request_idempotency`.

Scope: merchant + environment + operation + normalized key.

Canonical request hashing excludes server-generated public/secret material. It includes only authoritative caller inputs and resource identity. This allows a retry to generate a throwaway candidate locally while PostgreSQL returns the already-completed durable response snapshot.

Completed idempotency snapshots contain only the public credential projection. They never contain plaintext secret, secret verifier or generated candidate material.

Response-loss behavior is explicit:

- winning create/rotate response: secret shown exactly once;
- exact completed replay: public projection returned, `secretAvailable=false`, no secret redisclosure;
- merchant can recover from a lost create secret by rotating the created credential;
- merchant can recover from a lost rotation secret by fetching the current revision and rotating again with a new idempotency key.

## Audit

Every winning create/rotate/revoke mutation appends exactly one audit event in the same trusted database transaction.

Audit does not occur for:

- read operations;
- invalid/aal1 sessions;
- insufficient role;
- validation failures;
- idempotency replay;
- idempotency conflict;
- stale revision;
- resource-not-found.

Audit metadata may include revision/version/status transitions and IP-policy cardinality, but never key material or verifiers.

## IP allowlist

Create accepts either `null`/omitted or an array of canonical exact IP strings using the existing A1 semantics.

- empty array normalizes to unrestricted `null`;
- wildcard and CIDR are rejected;
- malformed/duplicate entries are rejected;
- maximum 32 exact addresses in V0;
- policy cannot be edited in-place in A8 V0; create a replacement credential or use a later dedicated update slice.

This preserves the A1 exact-IP evaluator without adding a second policy grammar.

## Database boundary

A8 adds five trusted API routines only:

1. `app.list_dashboard_api_credentials`
2. `app.get_dashboard_api_credential`
3. `app.create_dashboard_api_credential`
4. `app.rotate_dashboard_api_credential_secret`
5. `app.revoke_dashboard_api_credential`

The database mutation routines re-check K4 membership using the environment-sensitive required role. They receive a verifier and generated public key, never a plaintext secret.

Expected post-A8 runtime capability counts:

- `swiftpay_api`: 21 exact EXECUTE capabilities;
- `swiftpay_worker`: unchanged at 6.

No runtime role gets direct SELECT/INSERT/UPDATE/DELETE on `api_credentials`, `api_credential_token_windows`, `request_idempotency` or `audit_events`.

Private `_a8_*` helpers are executable by neither runtime role.

## Credential-count policy

V0 permits at most 10 active credentials per merchant/environment. The limit is enforced transactionally in PostgreSQL while locking the merchant row so concurrent creates cannot exceed the limit.

Revoked credentials do not count toward the active limit and are retained as immutable historical authentication/audit evidence.

## Revocation and A1 compatibility

Revocation sets `status='revoked'`, records `revoked_at` and increments `revision`.

It does not delete the row or public key. The existing A1 token exchange and bearer revalidation behavior remains authoritative:

- revoked credentials cannot issue new machine tokens;
- existing machine tokens are rejected on the next protected request because current credential status no longer matches active;
- secret rotation increments `secret_version`, immediately invalidating machine tokens carrying the old version.

A8 must not alter the public `/v1/auth/token` contract.

## Security invariants

- No browser/Data API credential DML.
- No service-role or Supabase secret key in the API runtime.
- No machine-token fallback for dashboard administration.
- Mutation requires both AAL2 and current K4 role.
- Secret generation uses CSPRNG only.
- Secret hashing uses the existing frozen A1 scrypt parameters.
- Plaintext secret exists only in trusted application memory and winning response serialization.
- Secret verifier never appears in public projection, logs, audit or idempotency response snapshots.
- No provider credential, Payment, ledger, payout/refund, job or webhook state mutation.
- Production credential creation does not itself authorize a Production monetary call.

## Clean RED requirements

Before implementation:

- existing 209 application contracts remain green;
- existing 38 / 1282 pgTAP database suite remains green except new A8 structural assertions;
- K7/A1/A2/A3/A4/A6/A7 runtime acceptance remains green before the A8 checkpoint;
- A8 failures are assertion-level behavior/structure absence, not module resolution, parser, typecheck or harness failures;
- no A8 migration is applied to the hosted canonical project before local RED -> GREEN proof.

## Planned acceptance

A real isolated-Postgres acceptance must prove:

- member can list/get but cannot mutate;
- `aal1` admin/owner receives `step_up_required` before secret generation or DB mutation;
- AAL2 admin can mutate Sandbox but not Production;
- AAL2 owner can mutate both environments;
- create returns one public/secret pair and persists only the scrypt verifier;
- exact create replay returns no plaintext secret and creates no duplicate credential/audit event;
- changed request with same idempotency key conflicts;
- rotation increments secret version/revision, returns one new plaintext secret and invalidates a token issued with the old version on A1 bearer revalidation;
- exact completed rotation replay succeeds without another secret;
- new-key stale rotation conflicts;
- revoke is terminal, increments revision and immediately blocks token exchange/revalidation;
- exact revoke replay is safe;
- public projection contains no verifier/secret material;
- audit and idempotency snapshots contain no key authority beyond the public key;
- API/worker least privilege is unchanged except the five explicit API routines;
- Payment/ledger/provider/payout/refund/job/webhook counts remain invariant.

## Out of scope

- MFA enrollment/challenge UI itself; A8 only consumes an already-established Supabase AAL2 session.
- Reauthentication nonce/password-change flows.
- Credential name editing.
- IP allowlist editing after create.
- Un-revoke.
- Hard delete.
- JWT signing-key rotation.
- CIDR/wildcard IP policy.
- Provider account credentials.
- Production monetary capability/KYC policy.
- Live PSP calls.
