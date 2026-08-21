# SwiftPay V2 — A8 API Credential Management Contracts

Status: **FROZEN FOR TDD**  
Date: 2026-08-17  
Specification: `docs/specs/api-credential-management-v0.yaml`

## 1. Realm contract

All A8 routes live only under:

`/dashboard/v1/merchants/{merchantId}/environments/{environment}/api-credentials`

Machine `/v1/**` credentials MUST NOT authorize this resource family.

Reads use the existing A6 online Supabase session verifier and require current K4 `member` authority.

Mutations use a distinct privileged dashboard verifier. It MUST first validate the Bearer token online with the configured Supabase Auth project, then cross-check the JWT `sub` with the returned Auth user id, then require JWT `aal === "aal2"`.

A missing or `aal1` assurance level is `step_up_required`, not `invalid_session`.

## 2. Privileged session types

```text
PrivilegedDashboardPrincipal = {
  userId: UUID
  assuranceLevel: "aal2"
}

PrivilegedDashboardSessionResult =
  | { kind: "authenticated", principal: PrivilegedDashboardPrincipal }
  | { kind: "invalid_session" }
  | { kind: "step_up_required" }
  | { kind: "authentication_unavailable" }
```

No local JWT-signature trust, service-role secret, legacy JWT secret or machine credential is an alternative authority.

## 3. Public credential projection

```text
ApiCredential = {
  id: UUID
  merchantId: UUID
  environment: "sandbox" | "production"
  name: string
  publicKey: string
  status: "active" | "revoked"
  secretVersion: positive integer
  revision: positive integer
  ipAllowlist: null | canonical exact-IP string[]
  lastUsedAt: RFC3339 | null
  createdAt: RFC3339
  rotatedAt: RFC3339 | null
  revokedAt: RFC3339 | null
}
```

The projection MUST NEVER contain `secret_verifier`, secret plaintext, access tokens, database credentials or provider credentials.

## 4. One-time secret response

Winning create and winning rotate return:

```text
{
  credential: ApiCredential
  secretKey: "sk_<environment>_<opaque>"
  secretAvailable: true
  replayed: false
}
```

Exact completed idempotency replay returns:

```text
{
  credential: ApiCredential
  secretKey: null
  secretAvailable: false
  replayed: true
}
```

Plaintext Secret Key exists only in trusted API memory and winning HTTP serialization. PostgreSQL, audit metadata, idempotency snapshots and logs MUST NOT contain it.

## 5. Key generation and verifier contract

Public key:

`pk_sandbox_<base64url(18 CSPRNG bytes)>` or `pk_production_<base64url(18 CSPRNG bytes)>`

Secret key:

`sk_sandbox_<base64url(32 CSPRNG bytes)>` or `sk_production_<base64url(32 CSPRNG bytes)>`

The stored verifier uses the already-frozen A1 `scrypt-v1` parameters. A8 MUST reuse A1 semantics rather than introduce another verifier format.

## 6. HTTP operation contract

- `GET /api-credentials` → member, `200`, deterministic list.
- `GET /api-credentials/{credentialId}` → member, `200`; foreign/missing are identical `404 resource_not_found`.
- `POST /api-credentials` → AAL2 + mutation role + `Idempotency-Key`; first success `201`.
- `POST /api-credentials/{credentialId}/rotate-secret` → AAL2 + mutation role + positive `expectedRevision` + `Idempotency-Key`; success `200`.
- `POST /api-credentials/{credentialId}/revoke` → AAL2 + mutation role + positive `expectedRevision` + `Idempotency-Key`; success `200`.

There is no rename, IP-policy update, un-revoke, DELETE or hard delete in V0.

## 7. Environment-sensitive mutation authority

Sandbox mutation: current role `admin` or `owner` plus AAL2.

Production mutation: current role `owner` plus AAL2.

The database mutation routines MUST re-check current K4 membership; application authorization is not sufficient by itself.

## 8. Optimistic concurrency

`app.api_credentials.revision bigint not null default 1 check (revision > 0)`.

Create starts with `revision=1`, `secret_version=1`.

Successful rotation increments `revision` and `secret_version` exactly once.

Successful revoke increments `revision` exactly once and is terminal.

Exact completed replay is evaluated before stale-revision/status fencing. A new idempotency key with stale `expectedRevision` returns `409 resource_conflict`.

## 9. Idempotency contract

Every mutation requires a normalized `Idempotency-Key` and reuses `app.request_idempotency`.

Canonical request hash includes operation, merchant, environment, target credential when present, expected revision when present, normalized name and normalized exact-IP allowlist where applicable. It excludes generated key material and verifier material.

Same key + same completed request MUST NOT mutate, audit or disclose a secret again.

Same key + different request → `409 idempotency_conflict`.

Same key still in progress → `409 idempotency_in_progress`.

## 10. IP allowlist contract

Create accepts omitted/null or at most 32 unique exact canonical IP strings.

`[]` normalizes to unrestricted `null`.

CIDR, wildcard, malformed and duplicate values are rejected. A8 does not edit the allowlist after creation.

## 11. Database capability contract

A8 adds exactly these trusted API routines:

1. `app.list_dashboard_api_credentials`
2. `app.get_dashboard_api_credential`
3. `app.create_dashboard_api_credential`
4. `app.rotate_dashboard_api_credential_secret`
5. `app.revoke_dashboard_api_credential`

Expected post-A8 execute allowlist: `swiftpay_api = 21`, `swiftpay_worker = 6` unchanged.

Neither runtime role receives direct SELECT/INSERT/UPDATE/DELETE on `app.api_credentials`, `app.api_credential_token_windows`, `app.request_idempotency` or `app.audit_events`.

Private `_a8_*` helpers are executable by neither runtime role.

## 12. Credential-count contract

At most 10 active credentials may exist per merchant/environment. The limit is enforced transactionally under concurrent creates. Revoked credentials remain historical records and do not count toward the active limit.

## 13. A1 compatibility contract

A8 MUST NOT change `POST /v1/auth/token`.

Rotation invalidates existing machine Bearer tokens on their next protected request because `secret_version` changes.

Revocation prevents new token exchange and invalidates existing machine Bearer tokens on their next protected request because credential status is no longer active.

## 14. Audit contract

Each winning create/rotate/revoke appends exactly one audit event in the same trusted database transaction.

No audit event is created for reads, invalid/AAL1 sessions, insufficient roles, validation failures, exact replays, idempotency conflicts, stale revisions or resource-not-found.

Audit metadata may include ids, operation, status/version/revision transitions and IP-policy cardinality. It MUST NOT include secret plaintext or secret verifier.

## 15. Financial invariance

A8 cannot create or mutate Payments, provider attempts/events, ledger transactions/entries, balances, payouts, refunds, jobs, merchant webhook endpoints/events/deliveries or provider credentials.

Production credential creation is authentication administration only. It grants no implicit monetary capability.

## 16. Fail-first acceptance

The RED suite must fail because A8 behavior/structure is absent, while all existing A1–A7 tests remain GREEN. Failures must be assertion-level contract failures rather than parser, typecheck, module-resolution or harness failures.
