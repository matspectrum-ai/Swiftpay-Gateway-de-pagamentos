# SwiftPay V2 — Merchant API Credentials

Status: Phase 1 foundational contract

## Boundary

Dashboard users authenticate with Supabase Auth. Machine integrations use separate SwiftPay API credentials.

A valid machine token never implies Production KYC approval.

## Credential

```text
id
merchant_id
name
public_key
secret_verifier
secret_version
environment
status = active | revoked
ip_allowlist
created_at
last_used_at?
revoked_at?
```

Secret material is generated with a CSPRNG, returned only once on create/rotation, and never stored/read back as plaintext. Verification uses constant-time comparison of the approved verifier representation.

## Rotation and revocation

Multiple credentials are allowed within an explicit limit for zero-downtime migration.

Secret rotation normally keeps the credential/public identity stable:

```text
replace verifier atomically
increment secret_version
invalidate older issued tokens
return new plaintext secret once
```

Revocation immediately blocks token issuance and existing tokens fail the next server-side credential/version validation.

## Token exchange

Preserve the compatibility concept:

```text
POST /v1/auth/token
client_credentials
```

Before issuing a token, verify credential active, merchant valid, secret correct, environment fixed, IP policy and abuse/rate controls.

Token carries at least:

```text
merchant_id
credential_id
environment
secret_version
jti
iat/exp
```

Protected requests revalidate credential status/version where required. Production payment/payout/refund additionally runs the merchant/KYC capability gate.

## Environment and IP

Credential belongs to exactly one environment; Sandbox cannot cross into Production.

Use explicit validated IP allowlist semantics. If CIDR is supported, normalize and test CIDR correctly. If first release supports exact IP only, name it exact IP allowlist. Invalid entries fail configuration.

## Sensitive management operations

Create, rotate and revoke use one canonical dashboard workflow with step-up authorization. No direct endpoint may bypass it.

Step-up uses recent re-auth/MFA/OTP according to final Supabase Auth policy.

If a challenge is used, it is bound to actor + merchant + action + target credential, expires quickly, has bounded failed attempts, is rate-limited and is atomically consumed once.

Two concurrent confirmations cannot perform the sensitive action twice.

## Audit/secrets

Create/rotate/revoke is append-audited with actor, credential, action, time and request context.

Never log plaintext secret, verifier, Authorization header or access token.

Browser/RLS roles cannot read verifier/service-only fields.

## Internal simplification

Do not recreate a broad `/v1/internal/*` surface protected by one global key when modules live in one modular monolith.

Use in-process module calls and PostgreSQL outbox for worker handoff. Any future separate workload receives its own rotatable, scoped workload identity.

## Fail-first tests

1. plaintext secret is returned once and cannot be read back;
2. wrong secret fails deterministically;
3. revoked credential cannot issue token;
4. token issued before revocation fails on next protected request;
5. rotation increments version and invalidates old token/secret;
6. new secret works after rotation;
7. Sandbox credential cannot operate in Production;
8. allowlist match succeeds and mismatch fails closed;
9. invalid IP/CIDR configuration is rejected;
10. valid credential cannot bypass unapproved KYC for Production financial action;
11. concurrent step-up confirmation consumes one challenge once;
12. challenge expiry/attempt limit prevents reuse/brute-force loop;
13. multiple credentials support bounded zero-downtime migration;
14. browser cannot access verifier/service-only fields;
15. audit/log payload contains no plaintext secrets/tokens.