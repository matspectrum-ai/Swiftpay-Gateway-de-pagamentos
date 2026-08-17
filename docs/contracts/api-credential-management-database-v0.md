# SwiftPay V2 — A8 API Credential Management Database Contract

Status: **FROZEN FOR TDD**  
Date: 2026-08-17  
Parent contract: `docs/contracts/api-credential-management-v0.md`

## Trusted routine signatures

The A8 database boundary uses the existing dashboard-resource RPC shape established by A7. These signatures are exact.

```text
app.list_dashboard_api_credentials(
  actor_user_id uuid,
  merchant_id uuid,
  environment text
)

app.get_dashboard_api_credential(
  actor_user_id uuid,
  merchant_id uuid,
  environment text,
  credential_id uuid
)

app.create_dashboard_api_credential(
  actor_user_id uuid,
  merchant_id uuid,
  environment text,
  idempotency_key text,
  request_hash text,
  command jsonb
)

app.rotate_dashboard_api_credential_secret(
  actor_user_id uuid,
  merchant_id uuid,
  environment text,
  credential_id uuid,
  idempotency_key text,
  request_hash text,
  command jsonb
)

app.revoke_dashboard_api_credential(
  actor_user_id uuid,
  merchant_id uuid,
  environment text,
  credential_id uuid,
  idempotency_key text,
  request_hash text,
  command jsonb
)
```

No overloads are part of V0.

## Command shapes

Create command is strict and contains only trusted application output plus normalized caller input:

```text
{
  credentialId: UUID,
  name: string,
  publicKey: string,
  secretVerifier: scrypt-v1 string,
  ipAllowlist: null | exact-IP string[]
}
```

Rotate command:

```text
{
  expectedRevision: positive integer,
  secretVerifier: scrypt-v1 string
}
```

Revoke command:

```text
{
  expectedRevision: positive integer
}
```

Plaintext `secretKey`, dashboard Bearer token and machine access token are forbidden in every routine argument and command.

## Return contract

Read routines return only the public credential projection.

Mutation routines return one JSON result with a discriminated `kind` from:

```text
created | ok | resource_not_found | resource_conflict |
idempotency_conflict | idempotency_in_progress |
credential_limit_reached | validation_error | internal_error
```

Winning/replayed mutation results may contain only the public credential projection and `replayed` boolean. They never return or persist plaintext Secret Key or verifier through the public result snapshot.

## Authorization contract

Each routine receives the server-verified Supabase user UUID as `actor_user_id` and independently re-checks current K4 membership.

- list/get: `member`
- Sandbox mutations: `admin`
- Production mutations: `owner`

`swiftpay_api` receives EXECUTE on exactly these five new routines. `swiftpay_worker`, PUBLIC, anon, authenticated and service_role receive no EXECUTE. Private `_a8_*` helpers are inaccessible to both runtime identities.

## Transaction contract

Create/rotate/revoke perform idempotency resolution, optimistic-concurrency/status checks, credential mutation and audit append in one PostgreSQL transaction.

Exact completed replay is resolved before status/revision fencing. Secret candidate material supplied by a replaying API process has no authority to overwrite the original mutation.

Create serializes the active-credential limit by locking the merchant row before counting/inserting, preventing concurrent creates from exceeding 10 active credentials per merchant/environment.
